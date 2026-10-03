# Changelog

All notable changes to the **EnvStash** extension will be documented in this file.

## [Unreleased]

### Added
- **Encrypted backups**: exports can be protected with a passphrase (scrypt + AES-256-GCM). Existing plain JSON backups still import.
- Copied variable values are **cleared from the clipboard** after `envstash.clipboardClearSeconds` (default 30).
- Revealed variable values **hide themselves** after `envstash.autoHideSeconds` (default 30) and whenever the panel is hidden.
- **Status bar environment switcher**: the status bar shows the environment last opened in this workspace; click it (or run `EnvStash: Switch Environment`) to pick another and open it in the panel.
- **Compare environments**: see which variables differ, or exist on only one side, between the open environment and any other, and copy missing ones across.
- **Duplicate an environment** with its variables, runbook and notes.
- **Edit a variable in place**: change its value or rename its key without deleting and re-adding it.
- **Reorder commands inside a runbook stage** by dragging the handle on each command.
- Redesigned **Notes** tab: icon toolbar, checklists, quotes, numbered and nested lists, word count.

### Security
- The webview now runs under a strict **Content Security Policy**; inline event handlers were replaced with delegated listeners.
- Project, environment and variable names are no longer embedded in inline scripts, and environment colours are validated.

### Fixed
- Storage requests from the panel are processed one at a time, so a read can no longer overtake the save before it.
- Notes typed just before leaving an environment or switching tabs are no longer dropped.
- Shell detection no longer mistakes the extension's own "EnvStash" terminal (or any name containing "sh") for a POSIX shell, which made `export-env` emit `export …` in PowerShell on Windows.

### Refactored
- Split the single `extension.ts` into layers: storage (`VaultStore`), services (projects, environment data, backup, terminal, clipboard), a backup controller for the export/import dialogs, and a webview layer with one handler per message type. Shell-specific command syntax is now a strategy per shell.
- Split `webview/script.js` into ordered files under `webview/js/`.

### Tests
- Added a unit and feature test suite (`npm test`) covering the `.env` parser, backup encryption, shell detection, the Markdown renderer, every host message, and the panel UI driven through jsdom.

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
