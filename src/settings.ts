/**
 * settings.ts
 * -----------
 * Defines the shape of the plugin's persisted configuration and its defaults.
 * All user-configurable behaviour lives here so the rest of the codebase can
 * import a single source of truth.
 */

export interface PhotoJournalSettings {
	/**
	 * Folder (relative to vault root) that contains daily notes.
	 * Trailing slash is optional — the code normalises it.
	 * Default: "Dailies"
	 */
	dailyNotesFolder: string;

	/**
	 * Date format used for daily-note file names (without the .md extension).
	 * Uses the same tokens as Moment.js / Obsidian's core daily-notes plugin.
	 * Default: "YYYY-MM-DD"
	 */
	dailyNoteDateFormat: string;

	/**
	 * Header text (without the ## prefix) under which image links are inserted.
	 * The plugin will create this header if it doesn't already exist in the note.
	 * Default: "Pics"
	 */
	picsHeader: string;

	/**
	 * Front-matter property name used to store the array of GPS coordinates.
	 * Each entry is stored as a "lat,lng" string so it is human-readable YAML.
	 * Default: "location"
	 */
	locationsProperty: string;

	/**
	 * Minimum distance (in meters) between two points before a new location
	 * is considered distinct enough to be added to front-matter.
	 * Default: 50
	 */
	locationDedupeRadiusMeters: number;

	/**
	 * When true, the plugin will create the daily note if it doesn't exist yet.
	 * When false, it only links into existing notes.
	 * Default: true
	 */
	createDailyNoteIfMissing: boolean;

	/**
	 * When true, write MapView-compatible inline geolocations in the note body.
	 * When false, keep writing coordinates to front-matter.
	 * Default: false
	 */
	useInlineGeolocations: boolean;
}

export const DEFAULT_SETTINGS: PhotoJournalSettings = {
	dailyNotesFolder: "Dailies",
	dailyNoteDateFormat: "YYYY-MM-DD",
	picsHeader: "Pics",
	locationsProperty: "location",
	locationDedupeRadiusMeters: 50,
	createDailyNoteIfMissing: true,
	useInlineGeolocations: false,
};
