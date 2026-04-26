# Photo Journal — Obsidian Plugin

Automatically weave your photos into your daily notes using their EXIF metadata.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [How It Works](#how-it-works)
- [Daily Note Format](#daily-note-format)
- [GPS & Locations](#gps--locations)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

---

## What It Does

Photo Journal bridges your image files and your daily notes. When you drag a
photo into your vault, the plugin reads its EXIF metadata, finds (or creates)
the daily note for the date the photo was taken, and inserts an inline image
link under a `## Pics` section. If the image has GPS data, the coordinates are
either appended to front-matter or added inline as MapView geo links,
depending on your settings.

The Photo Journal plugin is designed to work in tandem with the map view plugin 
(https://github.com/esm7/obsidian-map-view) and uses the same tags and front matter
parameters.

A side-panel lets you inspect the full metadata of any open image without
leaving Obsidian.

---

## Features

### Feature 1 — Auto-link images into daily notes

When a new image file lands in your vault (drag-and-drop, file copy, etc.):

1. The plugin reads the image's EXIF metadata.
2. It looks for the capture date (`DateTimeOriginal` → `DateTime` → `CreateDate`).
3. It finds the matching daily note in your configured folder (e.g.
   `Dailies/2024-03-15.md`).
4. If that note already contains an `![[image.jpg]]` link for this file, nothing
   happens (idempotent).
5. Otherwise it inserts the link under the `## Pics` header and keeps that
   section ordered from oldest image to newest image. If the header doesn't
   exist, it is appended to the end of the note.
6. If the daily note itself doesn't exist, it is created (configurable).

### Feature 2 — Image metadata side-panel

Opening any image file in Obsidian reveals a side-panel (right sidebar) that
displays:

- **Date & Time** — capture date, raw EXIF string
- **GPS Location** — latitude, longitude, altitude, and a one-click
  OpenStreetMap link
- **Camera** — make, model, lens, software
- **Exposure** — shutter speed, aperture, ISO, focal length, flash, white
  balance, metering mode
- **Image** — pixel dimensions, colour space, orientation
- **All Fields** — every raw EXIF key/value extracted from the file
  (collapsible)

The panel updates automatically as you navigate between images.

### Feature 3 — GPS coordinates (front-matter or inline)

Whenever an image link is added to a daily note (Feature 1), the plugin also
checks for GPS coordinates in the image.

By default, the coordinate pair is appended to the `location` YAML array in the
note's front-matter:

```yaml
---
location:
  - "37.774929,-122.419418"
  - "37.807998,-122.475000"
---
```

This format is compatible with [Obsidian Leaflet](https://github.com/javalent/obsidian-leaflet)
and similar mapping plugins.

If **Use inline geolocations (MapView)** is enabled in plugin settings:

1. The plugin ensures your front-matter contains an empty `locations` key so
  MapView knows to scan the note.
2. It writes an inline geo link directly below each newly inserted image link,
  for example:

```markdown
![[IMG_4201.jpg]]
[location name](geo:37.774929,-122.419418)
```

The label is intentionally a stub (`location name`) so you can rename it later.

---

## Requirements

- **Obsidian** v1.4.0 or later (desktop or mobile)
- **Node.js** v16+ and **npm** (for building from source only)

---

## Installation

### Option A — Manual install (recommended until community approval)

1. Download or clone this repository.
2. Run the build:
   ```bash
   npm install
   npm run build
   ```
3. Copy the three output files into your vault's plugins folder:
   ```
   <vault>/.obsidian/plugins/photo-journal/main.js
   <vault>/.obsidian/plugins/photo-journal/manifest.json
   <vault>/.obsidian/plugins/photo-journal/styles.css
   ```
4. In Obsidian, go to **Settings → Community plugins**, disable Safe Mode if
   prompted, and enable **Photo Journal**.

### Option B — BRAT (Beta Reviewers Auto-update Tester)

If you have the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) installed:

1. Open BRAT settings and click **Add Beta Plugin**.
2. Enter the repository URL: `https://github.com/your-username/obsidian-photo-journal`
3. Click **Add Plugin**, then enable it in **Community plugins**.

---

## Configuration

Open **Settings → Photo Journal** to configure:

| Setting | Default | Description |
|---|---|---|
| Daily notes folder | `Dailies` | Vault-relative path to your daily notes |
| Date format | `YYYY-MM-DD` | Moment.js format for daily note filenames |
| Pics section header | `Pics` | The `##` heading under which image links are placed |
| Locations property | `location` | Front-matter key for the GPS coordinate array |
| Use inline geolocations (MapView) | `false` | Writes `[location name](geo:LAT,LONG)` under images and keeps front-matter `locations: []` present |
| Create note if missing | `true` | Auto-create a daily note when none exists for the image date |

> **Tip:** The date format uses [Moment.js tokens](https://momentjs.com/docs/#/displaying/format/).
> `YYYY-MM-DD` → `2024-03-15`, `DD/MM/YYYY` → `15/03/2024`, etc.

---

## How It Works

### Image detection

The plugin listens to Obsidian's `vault.on('create')` event. Every time a file
is created in the vault it checks whether the file extension is a known image
type (`jpg`, `jpeg`, `png`, `heic`, `heif`, `tiff`, `webp`, `gif`, `avif`).

### EXIF parsing

Image bytes are read via `vault.readBinary()` and passed to the
[exifr](https://github.com/MikeKovarik/exifr) library, which runs entirely
in-process (no external requests). `exifr` supports EXIF, XMP, IPTC, and ICC
segments across all common formats.

### Daily note resolution

The capture date is formatted using the configured Moment.js pattern and
combined with the folder path to produce a normalised vault path such as
`Dailies/2024-03-15.md`. Obsidian's `vault.getAbstractFileByPath()` checks
whether the note exists. If it does not and `createDailyNoteIfMissing` is
enabled, the plugin creates it with a minimal template including the front-matter
`location: []` key.

### Link insertion

The plugin reads the full note content as a string and uses a regular expression
to locate the `## Pics` heading. It then reorders plain image embeds in that
section by their effective image timestamp so older images stay at the top and
newer images are added below them. When EXIF capture time is missing, the file
creation time is used as a fallback. If the heading is absent it is appended
with the link below it. The file is then written back with `vault.modify()`.

### Coordinates output modes

GPS coordinates extracted by `exifr` are formatted with 6 decimal places.

- **Front-matter mode (default):** writes `"lat,lng"` strings into the configured
  front-matter property (default `location`).
- **Inline mode (MapView):** keeps `locations: []` in front-matter and writes
  `[location name](geo:LAT,LONG)` directly under the related image embed.

In both modes, the plugin uses a distance threshold to avoid adding near-duplicate
points.

---

## Daily Note Format

A typical daily note managed by this plugin looks like:

```markdown
---
location:
  - "37.774929,-122.419418"
---

# 2024-03-15

## Morning Pages
...

## Pics
![[IMG_4201.jpg]]
![[IMG_4205.jpg]]
```

The plugin only writes to the `## Pics` section and the `location` front-matter
property. Everything else in your daily note template is preserved.

---

## GPS & Locations

Coordinates are stored as either `"lat,lng"` strings in front-matter or inline
`geo:` links in the note body.

This is the format expected by **Obsidian Leaflet**. To render a map in any
note, install Obsidian Leaflet and add:

````
```leaflet
id: my-map
lat: 37.774929
long: -122.419418
height: 300px
marker: default, 37.774929, -122.419418
```
````

---

## Troubleshooting

**Images are not being linked into daily notes**
- Check that the image has EXIF date metadata. Open the image in Obsidian and
  look at the metadata panel — if "Date & Time" is absent, the image has no
  embedded date.
- Verify your **Daily notes folder** setting matches the actual folder name
  (case-sensitive on macOS/Linux).
- Make sure **Create note if missing** is enabled if the daily note doesn't exist.

**The metadata panel doesn't appear**
- Click the camera icon in the left ribbon to open it manually.
- The panel only auto-opens when an image is the active leaf.

**Locations are not being added**
- GPS data is only present in photos taken with a device that had location
  services enabled at the time.
- Check the metadata panel — if "GPS Location" is absent, the image has no
  embedded coordinates.

**Build errors**
- Make sure you are running Node.js v16 or later: `node --version`
- Delete `node_modules` and re-run `npm install`.

---

## Development

```bash
# Clone the repo
git clone https://github.com/your-username/obsidian-photo-journal
cd obsidian-photo-journal

# Install dependencies
npm install

# Start the dev watcher (outputs main.js with source maps)
npm run dev

# Build for production (minified, no source maps)
npm run build
```

Symlink the plugin folder into your test vault for fast iteration:

```bash
ln -s "$(pwd)" "/path/to/test-vault/.obsidian/plugins/photo-journal"
```

Then in Obsidian use **Ctrl/Cmd+R** to reload the app after each build.

### Project structure

```
obsidian-photo-journal/
├── main.ts               # Plugin entry point; registers views and events
├── src/
│   ├── settings.ts       # Settings interface and defaults
│   ├── settingsTab.ts    # Settings UI rendered inside Obsidian Settings
│   ├── imageDropHandler.ts  # Features 1 & 3: EXIF → daily note linking
│   ├── exifReader.ts     # Thin wrapper around the exifr library
│   └── metadataView.ts   # Feature 2: metadata side-panel view
├── styles.css            # Panel styles (uses Obsidian CSS variables)
├── manifest.json         # Plugin metadata read by Obsidian
├── package.json
├── tsconfig.json
└── esbuild.config.mjs
```

---

## License

MIT — see [LICENSE](LICENSE) for details.
