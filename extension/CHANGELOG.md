# Changelog

All notable changes to the **EnvStash** extension will be documented in this file.

## [1.1.1] - 2026-07-03

### Added
- Dedicated **Environment Notes** section with autosave (debounced at 800ms) and secure Keychain backup/restore support.
- Live **Markdown preview** tab for notes with a formatting helper toolbar (Bold, Italic, Code, List, Link).
- Support for **multi-line environment variables** (e.g. certificates and private keys) via a toggleable textarea field in the UI.
- Stateful dotenv parser in the bulk importer to correctly parse multi-line quoted values and resolve escaped newlines.

### Fixed
- Fixed webview injection bug by escaping regex substitution patterns (such as `$'` in code) inside the HTML injection process.
- Removed the environment count badge from the home screen project rows for a cleaner interface.

## [1.1.0] - 2026-06-30

### Added
- Runbook stage reordering via drag-and-drop with a draggable handle.
- Visual feedback during drag-and-drop actions (drop indicator borders and dragging opacity).

### Refactored
- Extracted inline HTML, CSS, JavaScript, and SVG assets from `extension.ts` into dedicated webview files (`webview/index.html`, `webview/style.css`, `webview/script.js`, and `src/svgs.ts`) for cleaner architecture and improved maintainability.

## [1.0.2] - 2026-06-29

### Added
- Collapsible/collapsing stages feature inside environment runbooks (collapsed by default).
- Search/filter functionality in the variables tab for quick navigation of credentials.
- Added view icon `$(lock)` contribution inside VS Code view registry to clean up VS Code panel warning.
- Configured `.vscodeignore` file to optimize production package size.

### Fixed
- Fixed topbar layout and dimensions of the lock logo to prevent the header panel from being vertically stretched.
- Fixed the three-dot vertical action menu icon alignment and solid rendering.

## [1.0.1] - 2026-06-29

### Fixed
- Fixed secure credentials storage and UI styling.

## [1.0.0] - 2026-06-29

### Added
- Initial release of EnvStash.
