import { App, PluginSettingTab, Setting } from "obsidian";
import PhotoJournalPlugin from "../main";

/**
 * PhotoJournalSettingTab
 * ----------------------
 * Renders the plugin's settings page inside Obsidian's Settings modal.
 * Each Setting widget automatically saves changes via plugin.saveSettings().
 */
export class PhotoJournalSettingTab extends PluginSettingTab {
	plugin: PhotoJournalPlugin;

	constructor(app: App, plugin: PhotoJournalPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── Daily notes folder ────────────────────────────────────────────────
		new Setting(containerEl)
			.setName("Daily notes folder")
			.setDesc(
				"Path to the folder containing your daily notes, relative to the vault root (e.g. Dailies or Journal/Daily)."
			)
			.addText((text) =>
				text
					.setPlaceholder("Dailies")
					.setValue(this.plugin.settings.dailyNotesFolder)
					.onChange(async (value) => {
						this.plugin.settings.dailyNotesFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		// ── Date format ───────────────────────────────────────────────────────
		new Setting(containerEl)
			.setName("Daily note date format")
			.setDesc(
				"Moment.js format string for daily note file names (without .md). Default: YYYY-MM-DD."
			)
			.addText((text) =>
				text
					.setPlaceholder("YYYY-MM-DD")
					.setValue(this.plugin.settings.dailyNoteDateFormat)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteDateFormat = value.trim();
						await this.plugin.saveSettings();
					})
			);

		// ── Pics header ───────────────────────────────────────────────────────
		new Setting(containerEl)
			.setName("Pics section header")
			.setDesc(
				'The ## header under which image links are placed. Do not include the "##" prefix.'
			)
			.addText((text) =>
				text
					.setPlaceholder("Pics")
					.setValue(this.plugin.settings.picsHeader)
					.onChange(async (value) => {
						this.plugin.settings.picsHeader = value.trim();
						await this.plugin.saveSettings();
					})
			);

		// ── Locations property ────────────────────────────────────────────────
		new Setting(containerEl)
			.setName("Locations front-matter property")
			.setDesc(
				"The YAML front-matter key used to store GPS coordinates as an array of lat,lng strings."
			)
			.addText((text) =>
				text
					.setPlaceholder("location")
					.setValue(this.plugin.settings.locationsProperty)
					.onChange(async (value) => {
						this.plugin.settings.locationsProperty = value.trim();
						await this.plugin.saveSettings();
					})
			);

		// ── Location dedupe radius ────────────────────────────────────────────
		new Setting(containerEl)
			.setName("Location dedupe radius (meters)")
			.setDesc(
				"A new GPS coordinate is added only if it is farther than this distance from every existing location in the note front-matter."
			)
			.addText((text) =>
				text
					.setPlaceholder("50")
					.setValue(String(this.plugin.settings.locationDedupeRadiusMeters))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (!Number.isFinite(parsed) || parsed < 0) return;
						this.plugin.settings.locationDedupeRadiusMeters = parsed;
						await this.plugin.saveSettings();
					})
			);

		// ── Geolocation output mode ───────────────────────────────────────────
		new Setting(containerEl)
			.setName("Use inline geolocations (MapView)")
			.setDesc(
				"When enabled, adds [location name](geo:LAT,LONG) under images and keeps an empty front-matter 'locations' key for MapView scanning. When disabled, coordinates are stored in front-matter."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useInlineGeolocations)
					.onChange(async (value) => {
						this.plugin.settings.useInlineGeolocations = value;
						await this.plugin.saveSettings();
					})
			);

		// ── Auto-create daily note ─────────────────────────────────────────────
		new Setting(containerEl)
			.setName("Create daily note if missing")
			.setDesc(
				"When enabled, a new daily note will be created if none exists for the image date."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.createDailyNoteIfMissing)
					.onChange(async (value) => {
						this.plugin.settings.createDailyNoteIfMissing = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
