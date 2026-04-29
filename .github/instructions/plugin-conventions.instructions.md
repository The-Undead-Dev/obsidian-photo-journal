---
description: "Use when writing, modifying, or extending any TypeScript source file in this Obsidian plugin. Covers Obsidian API conventions, adding features (commands, settings, views), code quality, documentation, and build/lint workflow."
applyTo: "**/*.ts"
---

# Obsidian Photo Journal — Plugin Conventions

## Code Quality & Style

- **Descriptive names**: All functions, variables, parameters, and classes must have clear, self-explanatory names. Avoid single-letter names (except loop counters) and abbreviations that are not universally understood.
- **Modular design**: Keep each source file focused on a single responsibility. Prefer extracting helpers into the appropriate `src/` module rather than embedding logic in `main.ts`.
- **Linter compliance**: All code must pass `npm run lint` (`eslint . --ext .ts`) with zero errors or warnings. Avoid patterns that commonly trigger lint errors: unused variables, implicit `any`, non-null assertions without justification.
- **TypeScript strict mode**: Respect `strictNullChecks`. Never silently cast to `any`. Use explicit `undefined` checks rather than non-null assertions (`!`) unless the value is provably non-null.

## Documentation

- **File-level header**: Every `.ts` file must start with a JSDoc block describing the file's purpose:
  ```ts
  /**
   * featureName.ts
   * ----------
   * One or two sentences describing what this module does and why it exists.
   */
  ```
- **Function JSDoc**: All exported functions and non-trivial private methods require a JSDoc block with `@param` and `@returns` tags.
- **Interface field comments**: Document each field of exported interfaces with an inline JSDoc comment (`/** ... */`).
- **Section dividers**: Use ASCII dividers to group related logic within longer files:
  ```ts
  // ── Section name ────────────────────────────────────────────────
  ```

## Obsidian API Conventions

- **Event registration**: Always use `this.registerEvent(...)` to subscribe to vault/workspace events. Never call `.on()` directly — `registerEvent` ensures automatic cleanup on plugin unload.
- **DOM manipulation**: Use Obsidian's `createEl()` / `createDiv()` helpers on `contentEl` inside views. Avoid raw `document.createElement` in views.
- **Icons**: Use `setIcon()` and `addIcon()` from the Obsidian API. Do not embed SVG strings inline.
- **Notices**: Use `new Notice(message)` for user-facing feedback. Never use `console.log` for user messages.
- **File paths**: Always normalise file paths with `normalizePath()` before passing them to vault APIs.
- **Moment.js**: Use the `moment` export from `"obsidian"` — do not import a separate `moment` package.

## Adding New Features

### New Command
Register commands in `onload()` in `main.ts`:
```ts
this.addCommand({
  id: "unique-command-id",
  name: "Human readable name",
  callback: () => { /* implementation */ },
});
```

### New Setting
1. Add the typed field to the `PhotoJournalSettings` interface in `src/settings.ts`.
2. Add a default value to `DEFAULT_SETTINGS` in the same file.
3. Add a `new Setting(containerEl)` widget inside `display()` in `src/settingsTab.ts`.
4. Call `await plugin.saveSettings()` in the `onChange` handler.

### New Side Panel View
1. Create a new file in `src/` extending `ItemView`.
2. Implement `getViewType()`, `getDisplayText()`, `getIcon()`, `onOpen()`, and `onClose()`.
3. Export a `VIEW_TYPE_*` constant for the view type string.
4. Register in `main.ts` with `this.registerView(VIEW_TYPE_*, leaf => new MyView(leaf, this))`.

### New Helper Module
- Create a file in `src/` named after the feature it supports.
- Accept `App` and `PhotoJournalSettings` via constructor (dependency injection) — do not import global state.
- Export only what is needed by `main.ts` or other modules.

## Build & Lint Workflow

| Task | Command | When to Run |
|------|---------|-------------|
| Development | `npm run dev` | Active development (watch + inline sourcemaps) |
| Type check + build | `npm run build` | Before committing — runs `tsc -noEmit` then bundles |
| Lint | `npm run lint` | Before committing — must report zero errors |
| Version bump | `npm run version` | Release only — updates `manifest.json` and `versions.json` |

- **No test runner is configured.** Manual testing inside Obsidian is the current verification method.
- `main.js` is a generated file (do not edit it directly; it is overwritten by the build).
- Mark `main.js` as auto-generated in commit messages or ignore for code review.

## Import Organization

Order imports as follows:
1. Obsidian API: `import { ... } from "obsidian";`
2. External libraries: `import * as exifr from "exifr";`
3. Local modules: `import { ... } from "./src/moduleName";`

Use bare module specifiers for local imports (no `.js` extension needed with `ESNext` modules + esbuild).
