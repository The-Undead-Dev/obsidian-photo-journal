import {
	Editor,
	MarkdownView,
	Menu,
	Notice,
	Plugin,
	TFile,
	WorkspaceLeaf,
	addIcon,
} from "obsidian";
import { PhotoJournalSettings, DEFAULT_SETTINGS } from "./src/settings";
import { PhotoJournalSettingTab } from "./src/settingsTab";
import { ImageDropHandler } from "./src/imageDropHandler";
import { readImageMetadata } from "./src/exifReader";
import { MetadataView, METADATA_VIEW_TYPE } from "./src/metadataView";

/**
 * PhotoJournalPlugin — the root class that Obsidian instantiates.
 * Responsibilities:
 *  - Register the metadata side-panel view (Feature 2)
 *  - Attach the vault "create" event listener for new images (Feature 1 & 3)
 *  - Expose plugin settings via a settings tab
 */
export default class PhotoJournalPlugin extends Plugin {
	settings!: PhotoJournalSettings;

	async onload() {
		// ── Load persisted settings (or defaults) ────────────────────────────
		await this.loadSettings();

		// ── Register the metadata panel view ─────────────────────────────────
		// Obsidian identifies view types by a string key; we keep it in a const.
		this.registerView(
			METADATA_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new MetadataView(leaf, this)
		);

		// ── Add a ribbon icon that opens the metadata panel ───────────────────
		addIcon(
			"photo-journal",
			`<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <rect x="10" y="20" width="80" height="60" rx="6" fill="none" stroke="currentColor" stroke-width="8"/>
        <circle cx="50" cy="50" r="18" fill="none" stroke="currentColor" stroke-width="8"/>
        <circle cx="78" cy="28" r="6" fill="currentColor"/>
      </svg>`
		);

		this.addRibbonIcon("photo-journal", "Photo Journal", () => {
			void this.activateMetadataView();
		});

		// ── Listen for newly created vault files ──────────────────────────────
		// The ImageDropHandler handles Features 1 and 3 when an image lands
		// in the vault (either by drag-drop or any other creation path).
		const dropHandler = new ImageDropHandler(this.app, this.settings);

		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (!(file instanceof TFile)) return;
				if (dropHandler.isImage(file)) {
					dropHandler.handleNewImage(file).catch((err) => {
						console.error(`PhotoJournal: failed to process ${file.path}`, err);
					});
				}
			})
		);

		// ── Open the metadata panel whenever the active leaf changes ──────────
		// This keeps the panel in sync as the user navigates between images.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (!leaf) return;
				const view = leaf.view;
				// Only react when an image file is opened in the active leaf.
				if (view?.getViewType() === "image") {
					void this.activateMetadataView();
				}
			})
		);

		// ── Add editor context action for embedded images ─────────────────────
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				this.addInlineGeoFromMetadataMenuItem(menu, editor, view, dropHandler);
			})
		);

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file, _source, leaf) => {
				this.addInlineGeoFromMetadataFileMenuItem(menu, file, leaf, dropHandler);
			})
		);

		// ── Settings tab ──────────────────────────────────────────────────────
		this.addSettingTab(new PhotoJournalSettingTab(this.app, this));

		console.debug("PhotoJournal plugin loaded.");
	}

	onunload() {
		// Obsidian automatically detaches registered views; nothing extra needed.
		console.debug("PhotoJournal plugin unloaded.");
	}

	// ── Settings helpers ──────────────────────────────────────────────────────

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// ── View helpers ──────────────────────────────────────────────────────────

	/**
	 * Opens (or focuses) the metadata side-panel in the right sidebar.
	 */
	async activateMetadataView() {
		const { workspace } = this.app;

		// If the view is already open somewhere, just reveal it.
		const existing = workspace.getLeavesOfType(METADATA_VIEW_TYPE);
		if (existing.length > 0) {
			workspace.revealLeaf(existing[0]);
			return;
		}

		// Otherwise open a new leaf in the right sidebar.
		const leaf = workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: METADATA_VIEW_TYPE, active: true });
			workspace.revealLeaf(leaf);
		}
	}

	private addInlineGeoFromMetadataMenuItem(
		menu: Menu,
		editor: Editor,
		view: { file: TFile | null },
		dropHandler: ImageDropHandler
	): void {
		const note = view.file;
		if (!(note instanceof TFile)) return;

		const embedInfo = this.getEmbeddedImageAtCursor(editor, note, dropHandler);
		if (!embedInfo) return;

		menu.addItem((item) => {
			item
				.setTitle("Add inline geolocation from metadata")
				.setIcon("map-pin")
				.onClick(() => {
					this.insertInlineGeoFromMetadataInEditor(editor, embedInfo).catch((err) => {
						console.error("PhotoJournal: failed to add inline geolocation", err);
						new Notice("Could not add inline geolocation from image metadata.");
					});
				});
		});
	}

	private addInlineGeoFromMetadataFileMenuItem(
		menu: Menu,
		file: unknown,
		leaf: WorkspaceLeaf | undefined,
		dropHandler: ImageDropHandler
	): void {
		if (!(file instanceof TFile)) return;
		if (!dropHandler.isImage(file)) return;

		const markdownView =
			leaf?.view instanceof MarkdownView
				? leaf.view
				: this.app.workspace.getActiveViewOfType(MarkdownView);

		const note = markdownView?.file;
		if (!(note instanceof TFile)) return;

		menu.addItem((item) => {
			item
				.setTitle("Add inline geolocation from metadata")
				.setIcon("map-pin")
				.onClick(() => {
					this.insertInlineGeoFromMetadataInFile(note, file, file.path).catch((err) => {
						console.error("PhotoJournal: failed to add inline geolocation", err);
						new Notice("Could not add inline geolocation from image metadata.");
					});
				});
		});
	}

	private getEmbeddedImageAtCursor(
		editor: Editor,
		note: TFile,
		dropHandler: ImageDropHandler
	): { line: number; imageFile: TFile } | null {
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);

		const candidates: Array<{ start: number; end: number; linkPath: string }> = [];

		const wikiEmbedRegex = /!\[\[([^\]#|]+)(?:#[^\]|]+)?(?:\|[^\]]*)?\]\]/g;
		let match: RegExpExecArray | null;
		while ((match = wikiEmbedRegex.exec(lineText)) !== null) {
			candidates.push({
				start: match.index,
				end: match.index + match[0].length,
				linkPath: match[1].trim(),
			});
		}

		const markdownImageRegex = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
		while ((match = markdownImageRegex.exec(lineText)) !== null) {
			candidates.push({
				start: match.index,
				end: match.index + match[0].length,
				linkPath: match[1].replace(/^<|>$/g, "").trim(),
			});
		}

		if (candidates.length === 0) return null;

		const selectedCandidate =
			candidates.find((candidate) =>
				cursor.ch >= candidate.start && cursor.ch <= candidate.end
			) ?? (candidates.length === 1 ? candidates[0] : null);

		if (!selectedCandidate) return null;

		const resolved = this.app.metadataCache.getFirstLinkpathDest(
			selectedCandidate.linkPath,
			note.path
		);

		if (!(resolved instanceof TFile)) return null;
		if (!dropHandler.isImage(resolved)) return null;

		return {
			line: cursor.line,
			imageFile: resolved,
		};
	}

	private async insertInlineGeoFromMetadataInEditor(
		editor: Editor,
		embedInfo: { line: number; imageFile: TFile }
	): Promise<void> {
		const imageBuffer = await this.app.vault.readBinary(embedInfo.imageFile);
		const metadata = await readImageMetadata(imageBuffer);

		if (metadata.latitude == null || metadata.longitude == null) {
			new Notice("No GPS metadata found in this image.");
			return;
		}

		if (!isValidCoordinate(metadata.latitude, metadata.longitude)) {
			new Notice("Image GPS metadata is invalid.");
			return;
		}

		const coordStr = `${metadata.latitude.toFixed(6)},${metadata.longitude.toFixed(6)}`;
		const geoLine = `[location name](geo:${coordStr})`;

		const originalContent = normalizeLineEndings(editor.getValue());
		const lines = originalContent.split("\n");

		if (embedInfo.line >= lines.length) {
			new Notice("Could not locate the embedded image line in the editor.");
			return;
		}

		const nextLine = lines[embedInfo.line + 1];
		if (nextLine?.trim() !== geoLine) {
			if (nextLine && /\(geo:\s*-?\d/.test(nextLine)) {
				new Notice("This image already has an inline geolocation below it.");
				return;
			}

			lines.splice(embedInfo.line + 1, 0, geoLine);
		}

		const withInlineGeo = lines.join("\n");
		const finalContent = ensureLocationsFrontMatter(withInlineGeo);

		if (finalContent === originalContent) {
			new Notice("Inline geolocation already exists.");
			return;
		}

		editor.setValue(finalContent);
		new Notice("Added inline geolocation from image metadata.");
	}

	private async insertInlineGeoFromMetadataInFile(
		note: TFile,
		imageFile: TFile,
		embedLinkPath: string
	): Promise<void> {
		const imageBuffer = await this.app.vault.readBinary(imageFile);
		const metadata = await readImageMetadata(imageBuffer);

		if (metadata.latitude == null || metadata.longitude == null) {
			new Notice("No GPS metadata found in this image.");
			return;
		}

		if (!isValidCoordinate(metadata.latitude, metadata.longitude)) {
			new Notice("Image GPS metadata is invalid.");
			return;
		}

		const coordStr = `${metadata.latitude.toFixed(6)},${metadata.longitude.toFixed(6)}`;
		const geoLine = `[location name](geo:${coordStr})`;

		const originalContent = normalizeLineEndings(await this.app.vault.read(note));
		const lines = originalContent.split("\n");
		const lineIndex = findImageEmbedLineIndex(lines, imageFile, embedLinkPath);

		if (lineIndex === -1) {
			new Notice("Could not find the embedded image line in this note.");
			return;
		}

		const nextLine = lines[lineIndex + 1];
		if (nextLine?.trim() !== geoLine) {
			if (nextLine && /\(geo:\s*-?\d/.test(nextLine)) {
				new Notice("This image already has an inline geolocation below it.");
				return;
			}

			lines.splice(lineIndex + 1, 0, geoLine);
		}

		const withInlineGeo = lines.join("\n");
		const finalContent = ensureLocationsFrontMatter(withInlineGeo);

		if (finalContent === originalContent) {
			new Notice("Inline geolocation already exists.");
			return;
		}

		await this.app.vault.modify(note, finalContent);
		new Notice("Added inline geolocation from image metadata.");
	}
}

function normalizeEmbedLinkPath(input: string): string {
	const trimmed = input.trim().replace(/^<|>$/g, "");
	const decoded = safeDecodeURIComponent(trimmed);
	const withoutAlias = decoded.split("|")[0];
	return withoutAlias.split("#")[0].trim();
}

function safeDecodeURIComponent(input: string): string {
	try {
		return decodeURIComponent(input);
	} catch {
		return input;
	}
}

function findImageEmbedLineIndex(
	lines: string[],
	imageFile: TFile,
	embedLinkPath: string
): number {
	const normalizedLinkPath = normalizeEmbedLinkPath(embedLinkPath);
	const candidates = new Set<string>([
		normalizedLinkPath,
		imageFile.path,
		imageFile.name,
		imageFile.basename,
	]);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		for (const candidate of candidates) {
			if (!candidate) continue;
			if (line.includes(`![[${candidate}`)) return i;
			if (line.includes(`](${candidate})`)) return i;
			if (line.includes(`](<${candidate}>)`)) return i;
			if (line.includes(`](${encodeURI(candidate)})`)) return i;
		}
	}

	return -1;
}

function ensureLocationsFrontMatter(content: string): string {
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	const locationsKeyRegex = /^locations\s*:/m;

	if (fmMatch) {
		const fmBody = fmMatch[1];
		if (locationsKeyRegex.test(fmBody)) return content;

		const updatedFmBody = fmBody.length > 0
			? `${fmBody}\nlocations: []`
			: "locations: []";

		return content.replace(/^---\n[\s\S]*?\n---/, `---\n${updatedFmBody}\n---`);
	}

	return `---\nlocations: []\n---\n\n${content}`;
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

function normalizeLineEndings(input: string): string {
	return input.replace(/\r\n/g, "\n");
}
