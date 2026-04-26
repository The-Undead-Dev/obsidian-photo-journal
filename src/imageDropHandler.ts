/**
 * imageDropHandler.ts
 * -------------------
 * Implements Feature 1 (link image into daily note) and
 * Feature 3 (add GPS coordinates to note front-matter).
 *
 * This module is intentionally side-effect free: it exports a single class
 * that receives all its dependencies via the constructor so it is easy to test.
 */

import { App, TFile, normalizePath, moment } from "obsidian";
import { PhotoJournalSettings } from "./settings";
import { ImageMetadata, readImageMetadata } from "./exifReader";

// Image extensions that this plugin will process.
const IMAGE_EXTENSIONS = new Set([
	"jpg",
	"jpeg",
	"png",
	"heic",
	"heif",
	"tiff",
	"tif",
	"webp",
	"gif",
	"avif",
]);

export class ImageDropHandler {
	private app: App;
	private settings: PhotoJournalSettings;
	private noteQueues: Map<string, Promise<void>>;
	private imageDateCache: Map<string, number | null>;

	constructor(app: App, settings: PhotoJournalSettings) {
		this.app = app;
		this.settings = settings;
		this.noteQueues = new Map();
		this.imageDateCache = new Map();
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/** Returns true if the file has an image extension we care about. */
	isImage(file: TFile): boolean {
		return IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
	}

	/**
	 * Main entry point called when a new image file is detected in the vault.
	 * Steps:
	 *   1. Read EXIF metadata from the image.
	 *   2. If a date is found, link the image into the corresponding daily note
	 *      under the ## Pics header (Feature 1).
	 *   3. If GPS coordinates are found, update location metadata based on
	 *      plugin settings (front-matter or inline geo links) (Feature 3).
	 */
	async handleNewImage(file: TFile): Promise<void> {
		const meta = await this.readMetadataWithRetry(file);

		const noteDate = this.resolveProcessingDate(file, meta.date);
		if (!noteDate) {
			console.log(
				`PhotoJournal: no usable date metadata found for ${file.name}, skipping.`
			);
			return;
		}

		const notePath = this.buildDailyNotePath(noteDate).notePath;

		await this.runWithNoteLock(notePath, async () => {
			const dailyNote = await this.resolveDailyNote(noteDate);
			if (!dailyNote) return; // Could not create and does not exist

			// Feature 1: insert image link under ## Pics
			await this.insertImageLink(dailyNote, file);

			// Feature 3: update locations front-matter
			if (
				meta.latitude != null &&
				meta.longitude != null &&
				isValidCoordinate(meta.latitude, meta.longitude)
			) {
				await this.upsertLocation(
					dailyNote,
					meta.latitude,
					meta.longitude,
					file.name
				);
			}
		});
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	/**
	 * Returns the TFile for the daily note matching `date`, creating the note
	 * first if the setting allows it and the note does not yet exist.
	 */
	private async resolveDailyNote(date: Date): Promise<TFile | null> {
		// Build the expected file path from the configured folder + format.
		const { folder, dateStr, notePath } = this.buildDailyNotePath(date);

		const existing = this.app.vault.getAbstractFileByPath(notePath);
		if (existing instanceof TFile) return existing;

		// Note doesn't exist — create it if the setting allows.
		if (!this.settings.createDailyNoteIfMissing) {
			console.log(
				`PhotoJournal: daily note ${notePath} not found and auto-create is disabled.`
			);
			return null;
		}

		// Ensure the folder exists before creating the file.
		await this.ensureFolder(folder);

		// Re-check after folder creation in case another task created the note.
		const rechecked = this.app.vault.getAbstractFileByPath(notePath);
		if (rechecked instanceof TFile) return rechecked;

		try {
			// Create the daily note with an empty front-matter block so we can
			// safely add properties later without special-casing the "no front-matter" case.
			const initialLocationKey = this.settings.useInlineGeolocations
				? "locations"
				: this.settings.locationsProperty;
			const content = `---\n${initialLocationKey}: []\n---\n\n# ${dateStr}\n\n## ${this.settings.picsHeader}\n`;
			return await this.app.vault.create(notePath, content);
		} catch (err) {
			// Another concurrent write may have created the note between recheck and create.
			const existingAfterError = this.app.vault.getAbstractFileByPath(notePath);
			if (existingAfterError instanceof TFile) return existingAfterError;

			console.error(`PhotoJournal: could not create daily note ${notePath}`, err);
			return null;
		}
	}

	private buildDailyNotePath(date: Date): {
		folder: string;
		dateStr: string;
		notePath: string;
	} {
		const folder = this.settings.dailyNotesFolder.replace(/\/$/, "");
		const dateStr = moment(date).format(this.settings.dailyNoteDateFormat);
		const notePath = normalizePath(`${folder}/${dateStr}.md`);
		return { folder, dateStr, notePath };
	}

	private resolveProcessingDate(file: TFile, exifDate?: Date): Date | undefined {
		if (exifDate) return exifDate;

		const ctime = file.stat?.ctime;
		if (typeof ctime === "number" && Number.isFinite(ctime) && ctime > 0) {
			return new Date(ctime);
		}

		return undefined;
	}

	private async readMetadataWithRetry(file: TFile) {
		const maxAttempts = 5;
		let lastMeta: ImageMetadata = {
			date: undefined,
			dateRaw: undefined,
			latitude: undefined,
			longitude: undefined,
			altitude: undefined,
			make: undefined,
			model: undefined,
			software: undefined,
			lensModel: undefined,
			exposureTime: undefined,
			fNumber: undefined,
			iso: undefined,
			focalLength: undefined,
			focalLengthIn35mm: undefined,
			flash: undefined,
			whiteBalance: undefined,
			exposureMode: undefined,
			meteringMode: undefined,
			imageWidth: undefined,
			imageHeight: undefined,
			orientation: undefined,
			colorSpace: undefined,
			raw: {},
		};

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const buffer = await this.app.vault.readBinary(file);
				lastMeta = await readImageMetadata(buffer);
			} catch (err) {
				if (attempt === maxAttempts) {
					console.error(`PhotoJournal: could not read image ${file.path}`, err);
					break;
				}
			}

			if (
				lastMeta.date ||
				(lastMeta.latitude != null && lastMeta.longitude != null) ||
				Object.keys(lastMeta.raw).length > 0
			) {
				return lastMeta;
			}

			if (attempt < maxAttempts) {
				await delay(attempt * 150);
			}
		}

		return lastMeta;
	}

	private async runWithNoteLock<T>(notePath: string, task: () => Promise<T>): Promise<T> {
		const previous = this.noteQueues.get(notePath) ?? Promise.resolve();
		let releaseQueue!: () => void;
		const current = new Promise<void>((resolve) => {
			releaseQueue = resolve;
		});
		const queueTail = previous.then(() => current);
		this.noteQueues.set(notePath, queueTail);

		await previous;
		try {
			return await task();
		} finally {
			releaseQueue();
			if (this.noteQueues.get(notePath) === queueTail) {
				this.noteQueues.delete(notePath);
			}
		}
	}

	/**
	 * Inserts an inline image link (`![[filename]]`) into the daily note under
	 * the configured ## Pics header.  Does nothing if the link already exists.
	 */
	private async insertImageLink(note: TFile, image: TFile): Promise<void> {
		let content = normalizeLineEndings(await this.app.vault.read(note));

		// The wikilink we want to add.
		const link = `![[${image.name}]]`;

		// If the link is already present anywhere in the note, bail out early.
		if (content.includes(link)) return;

		const header = `## ${this.settings.picsHeader}`;

		if (content.includes(header)) {
			// Match the header line and everything until the next same-level heading.
			const sectionRegex = new RegExp(
				`(${escapeRegex(header)}[^\n]*\n)((?:(?!##)[^\n]*\n?)*)`,
				""
			);
			const sectionMatch = content.match(sectionRegex);

			if (sectionMatch) {
				const headerLine = sectionMatch[1];
				const existingBody = sectionMatch[2] ?? "";
				const sortedBody = await this.buildPicsSectionBody(
					note,
					existingBody,
					image,
					link
				);

				if (sortedBody != null) {
					content = content.replace(sectionRegex, `${headerLine}${sortedBody}`);
				} else {
					// Fallback: preserve existing behavior when section body has custom lines.
					const separator = existingBody.endsWith("\n") ? "" : "\n";
					content = content.replace(
						sectionRegex,
						`${headerLine}${existingBody}${separator}${link}\n`
					);
				}
			}
		} else {
			// ── Header doesn't exist: append it at the end of the file ───────────
			const separator = content.endsWith("\n") ? "" : "\n";
			content = `${content}${separator}\n${header}\n${link}\n`;
		}

		await this.app.vault.modify(note, content);
		console.log(`PhotoJournal: linked ${image.name} into ${note.path}`);
	}

	private async buildPicsSectionBody(
		note: TFile,
		existingBody: string,
		newImage: TFile,
		newLink: string
	): Promise<string | null> {
		const existingEntries = this.extractStandaloneEmbedLines(existingBody);
		if (!existingEntries) return null;

		const datedExisting = await Promise.all(
			existingEntries.map(async (entry) => ({
				...entry,
				timestamp: await this.getEmbedCaptureTimestamp(note, entry.target),
			}))
		);

		const newTimestamp = await this.getImageCaptureTimestamp(newImage);
		const sortable = [
			...datedExisting,
			{
				line: newLink,
				target: imagePathFromFile(newImage),
				order: datedExisting.length,
				timestamp: newTimestamp,
			},
		];

		sortable.sort((a, b) => {
			const aHasDate = a.timestamp != null;
			const bHasDate = b.timestamp != null;

			if (aHasDate && bHasDate && a.timestamp !== b.timestamp) {
				return (a.timestamp as number) - (b.timestamp as number);
			}

			if (aHasDate && !bHasDate) return -1;
			if (!aHasDate && bHasDate) return 1;

			return a.order - b.order;
		});

		if (sortable.length === 0) return "";
		return `${sortable.map((entry) => entry.line).join("\n")}\n`;
	}

	private extractStandaloneEmbedLines(
		sectionBody: string
	): Array<{ line: string; target: string; order: number }> | null {
		if (!sectionBody.trim()) return [];

		const lines = sectionBody.split("\n");
		const entries: Array<{ line: string; target: string; order: number }> = [];

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			const match = trimmed.match(/^!\[\[([^\]]+)\]\]$/);
			if (!match) {
				return null;
			}

			const target = normalizeWikilinkTarget(match[1]);
			if (!target) return null;

			entries.push({
				line: trimmed,
				target,
				order: entries.length,
			});
		}

		return entries;
	}

	private async getEmbedCaptureTimestamp(
		note: TFile,
		target: string
	): Promise<number | null> {
		const file = this.app.metadataCache.getFirstLinkpathDest(target, note.path);
		if (!(file instanceof TFile)) {
			return null;
		}

		return this.getImageCaptureTimestamp(file);
	}

	private async getImageCaptureTimestamp(file: TFile): Promise<number | null> {
		const cacheKey = imagePathFromFile(file);
		if (this.imageDateCache.has(cacheKey)) {
			return this.imageDateCache.get(cacheKey) ?? null;
		}

		const meta = await this.readMetadataWithRetry(file);
		const effectiveDate = this.resolveProcessingDate(file, meta.date);
		const timestamp = effectiveDate?.getTime();
		const normalized =
			typeof timestamp === "number" && Number.isFinite(timestamp)
				? timestamp
				: null;

		this.imageDateCache.set(cacheKey, normalized);
		return normalized;
	}

	/**
	 * Adds location metadata to the daily note if that coordinate pair is
	 * not already present within the configured dedupe radius.
	 *
	 * Depending on settings, coordinates are stored either in front-matter
	 * or as inline MapView geo links under image embeds.
	 */
	private async upsertLocation(
		note: TFile,
		lat: number,
		lng: number,
		imageName: string
	): Promise<void> {
		if (!isValidCoordinate(lat, lng)) {
			console.warn(
				`PhotoJournal: skipping invalid coordinates ${lat},${lng} for ${note.path}`
			);
			return;
		}

		if (this.settings.useInlineGeolocations) {
			await this.upsertInlineLocation(note, lat, lng, imageName);
			return;
		}

		await this.upsertFrontMatterLocation(note, lat, lng);
	}

	private async upsertFrontMatterLocation(
		note: TFile,
		lat: number,
		lng: number
	): Promise<void> {

		const content = normalizeLineEndings(await this.app.vault.read(note));
		const coordStr = `${lat.toFixed(6)},${lng.toFixed(6)}`;
		const prop = this.settings.locationsProperty;
		const radiusMeters = Math.max(0, this.settings.locationDedupeRadiusMeters);

		// ── Case 1: front-matter block exists ────────────────────────────────
		const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);

		if (fmMatch) {
			const fmBody = fmMatch[1];

			// Skip insert if the new coordinate is close to any existing location.
			const existingCoords = this.extractLocationsFromFrontMatter(fmBody, prop);
			const tooClose = existingCoords.some((existing) => {
				const distance = haversineDistanceMeters(
					lat,
					lng,
					existing.lat,
					existing.lng
				);
				return distance <= radiusMeters;
			});
			if (tooClose) return;

			// ── Sub-case A: property array already exists ─────────────────────
			const arrayPropRegex = new RegExp(
				`(${escapeRegex(prop)}:\\s*\\[)([^\\]]*)(\\])`,
				"m"
			);
			const inlineMatch = fmBody.match(arrayPropRegex);

			if (inlineMatch) {
				// Inline array: locations: [a,b] — append the new coord
				const existing = inlineMatch[2].trim();
				const newValue = existing.length > 0
					? `${existing}, "${coordStr}"`
					: `"${coordStr}"`;
				const newContent = content.replace(
					arrayPropRegex,
					`$1${newValue}$3`
				);
				await this.app.vault.modify(note, newContent);
				return;
			}

			// Block-style array: locations:\n  - "lat,lng"
			const blockPropRegex = new RegExp(
				`(${escapeRegex(prop)}:\\s*\n)((?:[ \\t]+-[^\\n]*\n?)*)`,
				"m"
			);
			const blockMatch = fmBody.match(blockPropRegex);

			if (blockMatch) {
				// Append a new list item
				const newContent = content.replace(
					blockPropRegex,
					`$1$2  - "${coordStr}"\n`
				);
				await this.app.vault.modify(note, newContent);
				return;
			}

			// ── Sub-case B: property doesn't exist yet — add it ───────────────
			const newFmBody = `${fmBody}\n${prop}:\n  - "${coordStr}"`;
			const newContent = content.replace(
				/^---\n[\s\S]*?\n---/,
				`---\n${newFmBody}\n---`
			);
			await this.app.vault.modify(note, newContent);
			return;
		}

		// ── Case 2: no front-matter — prepend one ─────────────────────────────
		const newContent = `---\n${prop}:\n  - "${coordStr}"\n---\n\n${content}`;
		await this.app.vault.modify(note, newContent);

		console.log(`PhotoJournal: added location ${coordStr} to ${note.path}`);
	}

	private async upsertInlineLocation(
		note: TFile,
		lat: number,
		lng: number,
		imageName: string
	): Promise<void> {
		const coordStr = `${lat.toFixed(6)},${lng.toFixed(6)}`;
		const radiusMeters = Math.max(0, this.settings.locationDedupeRadiusMeters);

		const originalContent = normalizeLineEndings(await this.app.vault.read(note));
		let content = this.ensureInlineLocationsFrontMatter(originalContent);

		const dedupeCoords = this.extractInlineModeDedupeCoords(content);
		const tooClose = dedupeCoords.some((existing) => {
			const distance = haversineDistanceMeters(
				lat,
				lng,
				existing.lat,
				existing.lng
			);
			return distance <= radiusMeters;
		});

		if (tooClose) {
			if (content !== originalContent) {
				await this.app.vault.modify(note, content);
			}
			return;
		}

		const updatedContent = this.insertInlineGeoTagBelowImage(
			content,
			imageName,
			coordStr
		);

		if (updatedContent !== originalContent) {
			await this.app.vault.modify(note, updatedContent);
			console.log(`PhotoJournal: added inline geo ${coordStr} to ${note.path}`);
		}
	}

	/**
	 * Extracts all parseable lat/lng pairs from the configured location
	 * front-matter property, supporting both inline and block arrays.
	 */
	private extractLocationsFromFrontMatter(
		fmBody: string,
		prop: string
	): Array<{ lat: number; lng: number }> {
		const points: Array<{ lat: number; lng: number }> = [];

		const inlineRegex = new RegExp(
			`${escapeRegex(prop)}:\\s*\\[([^\\]]*)\\]`,
			"m"
		);
		const inlineMatch = fmBody.match(inlineRegex);
		if (inlineMatch) {
			points.push(...parseLatLngPairs(inlineMatch[1]));
		}

		const blockRegex = new RegExp(
			`${escapeRegex(prop)}:\\s*\\n((?:[ \\t]+-[^\\n]*\\n?)*)`,
			"m"
		);
		const blockMatch = fmBody.match(blockRegex);
		if (blockMatch) {
			points.push(...parseLatLngPairs(blockMatch[1]));
		}

		return points;
	}

	private extractInlineModeDedupeCoords(content: string): Array<{ lat: number; lng: number }> {
		const points: Array<{ lat: number; lng: number }> = [];
		const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);

		if (fmMatch) {
			const fmBody = fmMatch[1];
			points.push(
				...this.extractLocationsFromFrontMatter(
					fmBody,
					this.settings.locationsProperty
				)
			);

			if (this.settings.locationsProperty !== "locations") {
				points.push(...this.extractLocationsFromFrontMatter(fmBody, "locations"));
			}
		}

		points.push(...extractInlineGeoPairs(content));
		return points;
	}

	private ensureInlineLocationsFrontMatter(content: string): string {
		const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
		const locationsKeyRegex = /^locations\s*:/m;

		if (fmMatch) {
			const fmBody = fmMatch[1];
			if (locationsKeyRegex.test(fmBody)) return content;

			const newFmBody = fmBody.length > 0
				? `${fmBody}\nlocations: []`
				: "locations: []";

			return content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFmBody}\n---`);
		}

		return `---\nlocations: []\n---\n\n${content}`;
	}

	private insertInlineGeoTagBelowImage(
		content: string,
		imageName: string,
		coordStr: string
	): string {
		const lines = content.split("\n");
		const imageLink = `![[${imageName}]]`;
		const geoLine = `[location name](geo:${coordStr})`;

		const imageIndex = lines.findIndex((line) => line.includes(imageLink));
		if (imageIndex === -1) return content;

		const nextLine = lines[imageIndex + 1];
		if (nextLine?.trim() === geoLine) return content;
		if (nextLine && /\(geo:\s*-?\d/.test(nextLine)) return content;

		lines.splice(imageIndex + 1, 0, geoLine);
		return lines.join("\n");
	}

	/**
	 * Creates a folder (and any required parent folders) if it doesn't exist.
	 */
	private async ensureFolder(folderPath: string): Promise<void> {
		const parts = folderPath.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const exists = this.app.vault.getAbstractFileByPath(current);
			if (!exists) {
				await this.app.vault.createFolder(current);
			}
		}
	}
}

/** Escapes special regex characters in a string. */
function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeWikilinkTarget(target: string): string {
	const withoutAlias = target.split("|")[0];
	const withoutHeading = withoutAlias.split("#")[0].trim();
	return withoutHeading;
}

function imagePathFromFile(file: TFile): string {
	return normalizePath(file.path).toLowerCase();
}

function parseLatLngPairs(input: string): Array<{ lat: number; lng: number }> {
	const coords: Array<{ lat: number; lng: number }> = [];
	const pairRegex = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g;

	let match: RegExpExecArray | null;
	while ((match = pairRegex.exec(input)) !== null) {
		const lat = Number(match[1]);
		const lng = Number(match[2]);
		if (isValidCoordinate(lat, lng)) {
			coords.push({ lat, lng });
		}
	}

	return coords;
}

function extractInlineGeoPairs(input: string): Array<{ lat: number; lng: number }> {
	const coords: Array<{ lat: number; lng: number }> = [];
	const geoRegex = /\(geo:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/gi;

	let match: RegExpExecArray | null;
	while ((match = geoRegex.exec(input)) !== null) {
		const lat = Number(match[1]);
		const lng = Number(match[2]);
		if (isValidCoordinate(lat, lng)) {
			coords.push({ lat, lng });
		}
	}

	return coords;
}

function haversineDistanceMeters(
	lat1: number,
	lng1: number,
	lat2: number,
	lng2: number
): number {
	const earthRadiusMeters = 6371000;
	const dLat = toRadians(lat2 - lat1);
	const dLng = toRadians(lng2 - lng1);

	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(toRadians(lat1)) *
			Math.cos(toRadians(lat2)) *
			Math.sin(dLng / 2) *
			Math.sin(dLng / 2);

	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return earthRadiusMeters * c;
}

function toRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function isValidCoordinate(lat: number, lng: number): boolean {
	return (
		Number.isFinite(lat) &&
		Number.isFinite(lng) &&
		lat >= -90 &&
		lat <= 90 &&
		lng >= -180 &&
		lng <= 180
	);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLineEndings(input: string): string {
	return input.replace(/\r\n/g, "\n");
}
