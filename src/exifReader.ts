/**
 * exifReader.ts
 * -------------
 * Thin wrapper around the `exifr` library for reading JPEG/PNG/HEIC/TIFF
 * metadata entirely in-browser (no native binaries required).
 *
 * `exifr` is a lightweight, tree-shakeable EXIF parser that works in both
 * Node.js and browser environments, which makes it ideal for Obsidian plugins.
 *
 * Installation: `npm install exifr`
 */

import * as exifr from "exifr";

/**
 * Normalised metadata returned by the reader.
 * All fields are optional because any one of them may be absent from a given image.
 */
export interface ImageMetadata {
	// ── Date/time ─────────────────────────────────────────────────────────────
	/** Best available capture date (DateTimeOriginal → DateTime → undefined) */
	date: Date | undefined;
	/** Raw date string as stored in EXIF, for display purposes */
	dateRaw: string | undefined;

	// ── GPS ───────────────────────────────────────────────────────────────────
	latitude: number | undefined;
	longitude: number | undefined;
	altitude: number | undefined;

	// ── Camera ────────────────────────────────────────────────────────────────
	make: string | undefined;
	model: string | undefined;
	software: string | undefined;
	lensModel: string | undefined;

	// ── Exposure ──────────────────────────────────────────────────────────────
	exposureTime: number | undefined;
	fNumber: number | undefined;
	iso: number | undefined;
	focalLength: number | undefined;
	focalLengthIn35mm: number | undefined;
	flash: string | undefined;
	whiteBalance: string | undefined;
	exposureMode: string | undefined;
	meteringMode: string | undefined;

	// ── Image dimensions ──────────────────────────────────────────────────────
	imageWidth: number | undefined;
	imageHeight: number | undefined;
	orientation: number | undefined;
	colorSpace: string | undefined;

	// ── Full raw EXIF dump (for the panel's "all fields" section) ─────────────
	raw: Record<string, unknown>;
}

/**
 * Reads EXIF / XMP / IPTC metadata from an image file buffer.
 *
 * @param buffer - ArrayBuffer of the image file contents
 * @returns Normalised ImageMetadata object (all fields optional)
 */
export async function readImageMetadata(
	buffer: ArrayBuffer
): Promise<ImageMetadata> {
	let raw: Record<string, unknown> = {};

	try {
		// Parse everything exifr can extract: EXIF, GPS, IPTC, XMP, ICC.
		const parsed = await exifr.parse(buffer, {
			tiff: true,
			xmp: true,
			iptc: true,
			icc: true,
			gps: true,
			translateValues: true, // Human-readable enum strings (e.g. "Auto" for white balance)
			reviveValues: true, // Convert numeric dates to JS Date objects where possible
		});

		if (parsed) raw = parsed as Record<string, unknown>;
	} catch (err) {
		// If exifr can't parse the file (e.g. a PNG with no metadata) we return
		// an empty metadata object rather than crashing.
		console.warn("PhotoJournal: could not parse EXIF metadata", err);
	}

	// ── Helper: safely pull a string from raw ─────────────────────────────────
	const str = (...keys: string[]): string | undefined => {
		for (const k of keys) {
			if (raw[k] != null) return String(raw[k]);
		}
		return undefined;
	};

	// ── Helper: safely pull a number from raw ─────────────────────────────────
	const num = (...keys: string[]): number | undefined => {
		for (const k of keys) {
			const v = raw[k];
			if (v != null && !isNaN(Number(v))) return Number(v);
		}
		return undefined;
	};

	// ── Derive the best capture date ──────────────────────────────────────────
	// Priority: DateTimeOriginal (shutter press) > DateTime (file write) > CreateDate
	let date: Date | undefined;
	let dateRaw: string | undefined;

	for (const key of ["DateTimeOriginal", "DateTime", "CreateDate"]) {
		const v = raw[key];
		if (!v) continue;
		if (v instanceof Date) {
			date = v;
			dateRaw = v.toISOString();
			break;
		}
		if (typeof v === "string") {
			// EXIF dates look like "2024:03:15 14:22:01" — normalise to ISO-ish
			const iso = v.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
			const d = new Date(iso);
			if (!isNaN(d.getTime())) {
				date = d;
				dateRaw = v;
				break;
			}
		}
	}

	// ── GPS coordinates (exifr exposes these as top-level keys after parsing) ──
	const latitude = num("latitude");
	const longitude = num("longitude");

	return {
		date,
		dateRaw,
		latitude,
		longitude,
		altitude: num("GPSAltitude"),
		make: str("Make"),
		model: str("Model"),
		software: str("Software"),
		lensModel: str("LensModel"),
		exposureTime: num("ExposureTime"),
		fNumber: num("FNumber"),
		iso: num("ISO"),
		focalLength: num("FocalLength"),
		focalLengthIn35mm: num("FocalLengthIn35mmFormat"),
		flash: str("Flash"),
		whiteBalance: str("WhiteBalance"),
		exposureMode: str("ExposureMode"),
		meteringMode: str("MeteringMode"),
		imageWidth: num("ExifImageWidth", "ImageWidth"),
		imageHeight: num("ExifImageHeight", "ImageHeight"),
		orientation: num("Orientation"),
		colorSpace: str("ColorSpace"),
		raw,
	};
}

/**
 * Formats an exposure time fraction as a human-readable string.
 * e.g. 0.001 → "1/1000s"   0.5 → "1/2s"   2 → "2s"
 */
export function formatExposureTime(seconds: number): string {
	if (seconds >= 1) return `${seconds}s`;
	const denom = Math.round(1 / seconds);
	return `1/${denom}s`;
}
