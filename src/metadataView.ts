/**
 * metadataView.ts
 * ---------------
 * Implements Feature 2: a side-panel that displays all metadata for the
 * currently open image.
 *
 * The view is registered as a custom Obsidian view type.  It watches for the
 * active file to change and re-renders whenever an image is focused.
 */

import {
	ItemView,
	WorkspaceLeaf,
	TFile,
	setIcon,
} from "obsidian";
import PhotoJournalPlugin from "../main";
import { readImageMetadata, formatExposureTime, ImageMetadata } from "./exifReader";

/** Obsidian view-type identifier. Must be unique across all plugins. */
export const METADATA_VIEW_TYPE = "photo-journal-metadata";

export class MetadataView extends ItemView {
	private plugin: PhotoJournalPlugin;
	/** Reference to the unsubscribe function for the active-leaf-change event. */
	private activeLeafListener: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: PhotoJournalPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return METADATA_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Image Metadata";
	}

	getIcon(): string {
		return "photo-journal";
	}

	async onOpen(): Promise<void> {
		this.renderContainer();

		// Re-render whenever the user switches to a different file.
		this.activeLeafListener = this.app.workspace.on(
			"active-leaf-change",
			() => this.refresh()
		) as unknown as () => void;

		// Register the event so it's cleaned up when the view closes.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.refresh())
		);

		// Render immediately for any already-open image.
		await this.refresh();
	}

	async onClose(): Promise<void> {
		// Registered events are automatically cleaned up by Obsidian via
		// ItemView.registerEvent(); nothing extra needed here.
	}

	// ── Rendering ─────────────────────────────────────────────────────────────

	/** Clears the panel and renders the skeleton chrome. */
	private renderContainer(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("photo-journal-panel");

		// Panel header
		const header = contentEl.createDiv("pj-header");
		const iconSpan = header.createSpan("pj-header-icon");
		setIcon(iconSpan, "image");
		header.createEl("h4", { text: "Image Metadata", cls: "pj-header-title" });

		// Content area (populated by refresh())
		contentEl.createDiv("pj-content");
	}

	/**
	 * Inspects the currently active file. If it's an image, reads and displays
	 * its metadata. Otherwise shows a placeholder.
	 */
	async refresh(): Promise<void> {
		const contentEl = this.containerEl.querySelector(".pj-content") as HTMLElement;
		if (!contentEl) return;

		contentEl.empty();

		const activeFile = this.app.workspace.getActiveFile();

		if (!activeFile) {
			this.renderPlaceholder(contentEl, "No file open.");
			return;
		}

		const ext = activeFile.extension.toLowerCase();
		const imageExts = ["jpg", "jpeg", "png", "heic", "heif", "tiff", "tif", "webp", "gif", "avif"];

		if (!imageExts.includes(ext)) {
			this.renderPlaceholder(contentEl, "Open an image to see its metadata.");
			return;
		}

		// Show a loading state while we parse the file.
		contentEl.createDiv({ cls: "pj-loading", text: "Reading metadata…" });

		let buffer: ArrayBuffer;
		try {
			buffer = await this.app.vault.readBinary(activeFile);
		} catch {
			contentEl.empty();
			this.renderPlaceholder(contentEl, "Could not read image file.");
			return;
		}

		const meta = await readImageMetadata(buffer);

		contentEl.empty();
		this.renderFileName(contentEl, activeFile);
		this.renderMetadata(contentEl, meta);
	}

	/** Renders the image filename at the top of the panel. */
	private renderFileName(container: HTMLElement, file: TFile): void {
		const el = container.createDiv("pj-filename");
		setIcon(el.createSpan("pj-fn-icon"), "file-image");
		el.createSpan({ text: file.name, cls: "pj-fn-name" });
	}

	/** Renders all metadata sections. */
	private renderMetadata(container: HTMLElement, meta: ImageMetadata): void {
		// ── Date & time ───────────────────────────────────────────────────────
		if (meta.date) {
			const section = this.createSection(container, "Date & Time", "calendar");
			this.addRow(section, "Captured", meta.date.toLocaleString());
			if (meta.dateRaw) this.addRow(section, "Raw EXIF date", meta.dateRaw);
		}

		// ── GPS location ──────────────────────────────────────────────────────
		if (meta.latitude != null && meta.longitude != null) {
			const section = this.createSection(container, "GPS Location", "map-pin");
			this.addRow(section, "Latitude", meta.latitude.toFixed(6));
			this.addRow(section, "Longitude", meta.longitude.toFixed(6));
			if (meta.altitude != null)
				this.addRow(section, "Altitude", `${meta.altitude.toFixed(1)} m`);

			// Convenience link to view on a map
			const mapUrl = `https://www.openstreetmap.org/?mlat=${meta.latitude}&mlon=${meta.longitude}#map=15/${meta.latitude}/${meta.longitude}`;
			const linkRow = section.createDiv("pj-row pj-map-link");
			const a = linkRow.createEl("a", {
				text: "View on OpenStreetMap ↗",
				href: mapUrl,
				cls: "pj-ext-link",
			});
			a.setAttr("target", "_blank");
			a.setAttr("rel", "noopener");
		}

		// ── Camera ────────────────────────────────────────────────────────────
		const hasCamera = meta.make || meta.model || meta.software || meta.lensModel;
		if (hasCamera) {
			const section = this.createSection(container, "Camera", "camera");
			if (meta.make) this.addRow(section, "Make", meta.make);
			if (meta.model) this.addRow(section, "Model", meta.model);
			if (meta.lensModel) this.addRow(section, "Lens", meta.lensModel);
			if (meta.software) this.addRow(section, "Software", meta.software);
		}

		// ── Exposure ──────────────────────────────────────────────────────────
		const hasExposure =
			meta.exposureTime != null ||
			meta.fNumber != null ||
			meta.iso != null ||
			meta.focalLength != null;

		if (hasExposure) {
			const section = this.createSection(container, "Exposure", "aperture");
			if (meta.exposureTime != null)
				this.addRow(section, "Shutter speed", formatExposureTime(meta.exposureTime));
			if (meta.fNumber != null)
				this.addRow(section, "Aperture", `f/${meta.fNumber}`);
			if (meta.iso != null)
				this.addRow(section, "ISO", String(meta.iso));
			if (meta.focalLength != null)
				this.addRow(section, "Focal length", `${meta.focalLength} mm`);
			if (meta.focalLengthIn35mm != null)
				this.addRow(section, "35 mm equiv.", `${meta.focalLengthIn35mm} mm`);
			if (meta.flash) this.addRow(section, "Flash", meta.flash);
			if (meta.whiteBalance) this.addRow(section, "White balance", meta.whiteBalance);
			if (meta.exposureMode) this.addRow(section, "Exposure mode", meta.exposureMode);
			if (meta.meteringMode) this.addRow(section, "Metering", meta.meteringMode);
		}

		// ── Image ─────────────────────────────────────────────────────────────
		const hasImage = meta.imageWidth != null || meta.colorSpace;
		if (hasImage) {
			const section = this.createSection(container, "Image", "image");
			if (meta.imageWidth != null && meta.imageHeight != null)
				this.addRow(section, "Dimensions", `${meta.imageWidth} × ${meta.imageHeight}`);
			if (meta.colorSpace) this.addRow(section, "Color space", meta.colorSpace);
			if (meta.orientation != null)
				this.addRow(section, "Orientation", String(meta.orientation));
		}

		// ── All raw fields ────────────────────────────────────────────────────
		const rawKeys = Object.keys(meta.raw);
		if (rawKeys.length > 0) {
			const section = this.createSection(container, "All Fields", "list", true);
			for (const key of rawKeys.sort()) {
				const val = meta.raw[key];
				if (val == null) continue;
				let display = val instanceof Date ? val.toLocaleString() : String(val);
				if (display.length > 80) display = display.slice(0, 77) + "…";
				this.addRow(section, key, display);
			}
		}

		// ── Empty state ───────────────────────────────────────────────────────
		if (rawKeys.length === 0 && !meta.date && meta.latitude == null) {
			this.renderPlaceholder(container, "No metadata found in this image.");
		}
	}

	// ── DOM helpers ───────────────────────────────────────────────────────────

	/** Creates a collapsible section with a heading. */
	private createSection(
		parent: HTMLElement,
		title: string,
		icon: string,
		collapsed = false
	): HTMLElement {
		const section = parent.createDiv({ cls: "pj-section" });

		const toggle = section.createDiv({ cls: "pj-section-header" });
		const iconEl = toggle.createSpan("pj-section-icon");
		setIcon(iconEl, icon);
		toggle.createSpan({ text: title, cls: "pj-section-title" });
		const chevron = toggle.createSpan({ cls: "pj-chevron" });
		setIcon(chevron, "chevron-down");

		const body = section.createDiv({ cls: "pj-section-body" });

		if (collapsed) {
			body.addClass("pj-collapsed");
			chevron.addClass("pj-chevron-collapsed");
		}

		toggle.addEventListener("click", () => {
			body.toggleClass("pj-collapsed", !body.hasClass("pj-collapsed"));
			chevron.toggleClass("pj-chevron-collapsed", body.hasClass("pj-collapsed"));
		});

		return body;
	}

	/** Renders a label/value row inside a section. */
	private addRow(parent: HTMLElement, label: string, value: string): void {
		const row = parent.createDiv("pj-row");
		row.createSpan({ text: label, cls: "pj-row-label" });
		row.createSpan({ text: value, cls: "pj-row-value" });
	}

	/** Renders a centred placeholder message. */
	private renderPlaceholder(container: HTMLElement, message: string): void {
		const el = container.createDiv("pj-placeholder");
		const iconEl = el.createDiv("pj-placeholder-icon");
		setIcon(iconEl, "image-off");
		el.createDiv({ text: message, cls: "pj-placeholder-text" });
	}
}
