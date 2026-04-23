# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1]

- light theme
- finder integration: open with → mzTad.app
- recent files list in File menu and welcome screen
- fixed search not being focused on cmd+f

## [0.1.0]

### Added
- Initial release.
- Open **Parquet, CSV, TSV, JSON** (including newline-delimited) directly via DuckDB — no import step.
- File open via **drag-and-drop, File → Open (⌘O / Ctrl+O), Finder double-click, and CLI argument** (`mzTad path.parquet`); opens the empty focused window in-place when available, otherwise a new window.
- Virtualized grid (AG Grid Community) with **infinite row model**: server-side sort, filter, pagination; scales to multi-GB files.
- **Per-column filter popover**: `=`, `≠`, `contains` / `doesn't contain`, `starts with`, `ends with`, `>`, `≥`, `<`, `≤`, `between`, `is null`, `is not null`. Case-sensitive toggle for LIKE-family ops.
- **Filter chips** above the grid — removable individually or all at once.
- **Sort** via column-header click, driven entirely by my own state → DuckDB `ORDER BY`. Shift-click for multi-sort.
- **⌘F / Ctrl+F find** across all columns — highlights matches with `<mark>`, jumps between them with `↵` and `⇧↵`; up to 50k matches reported with row-by-row navigation.
- **Detail panel** (bottom, resizable) opens on double-click; shows formatted JSON for struct/list values, copy button.
- **Cell-range selection**: click, shift-click for range, ⌘/Ctrl-click toggles individual cells, click-drag expands rectangle.
- **Row ID column** (#) pinned-left; click = select row, shift-click = row range, ⌘/Ctrl-click = toggle row.
- **Clipboard**: ⌘C / Ctrl+C copies selection as TSV (single cell = plain value, multi-cell = tabs/newlines); ⌘⌥C / Ctrl+Alt+C adds a header row.
- **SQL editor** — prefilled with the current effective query; runs arbitrary SQL against the loaded file as a new view. "Reset to file" reverts.
- **Columns menu** with per-column show/hide, name filter, and an expandable tree of nested struct fields with compact type labels (e.g. `STRUCT(5)` instead of the full signature).
- **Light / dark / auto theme** toggle in the toolbar. `auto` reacts to system `prefers-color-scheme` changes live; persisted to localStorage; applied before first paint to avoid flash.
- **Platform-aware hotkey labels** throughout the UI (⌘ on macOS, Ctrl/Alt on Windows/Linux).
- **Loading overlay** with spinner during file open and SQL execution.
- **Per-window table lifecycle** — DuckDB views are dropped on window close and on file/SQL replacement, keeping in-memory state bounded across long sessions.
- **About dialog** linking out to [zona.media](https://zona.media); also configured as the native About panel info.
- **Localized README** in English and Russian with install, build, and usage sections.

### Build & distribution
- **macOS**: `.dmg` + `.zip` (arm64) via electron-builder. Ad-hoc signed (`identity: "-"`) so Gatekeeper reports "unidentified developer" rather than "damaged" on first launch.
- **Windows**: NSIS installer + portable `.zip` (x64). `scripts/install-duckdb-binding.mjs` fetches the Windows DuckDB binary via `npm pack` to work around npm's OS/CPU filtering when cross-building from macOS.
- `asarUnpack` carves out `@duckdb/**` so the native `.node` binary can be `dlopen`'d at runtime.
- Custom icon (`public/icon.png`) used for both macOS and Windows bundles.

### Known issues
- macOS bundle is unsigned for Apple's purposes — users see "unidentified developer" on first run and need right-click → Open, or `xattr -cr /Applications/mzTad.app`. Transparent distribution requires an Apple Developer ID and notarization.
- JSON files with mixed-type columns rely on `ignore_errors=true` in `read_json_auto`; pathological records are silently skipped.
