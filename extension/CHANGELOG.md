# Changelog

All notable changes to the **EnvStash** extension will be documented in this file.

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
