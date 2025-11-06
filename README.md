# Per-Ankh

Old World save game analyzer and visualizer built with Tauri, Rust, SvelteKit, and DuckDB.

## Project Overview

Per-Ankh imports Old World game save files and provides data visualizations and analytics. The application parses save files (ZIP archives containing XML), extracts game state into a DuckDB database, and presents interactive visualizations through a desktop UI.

## Development

### Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).

### Testing Save File Imports

#### CLI Import Tool

The fastest way to test save file imports is using the standalone CLI tool:

```bash
cd src-tauri
cargo run --example import_save -- path/to/savefile.zip
```

This will create a database (`per-ankh.db`) in the current directory and import the save file, showing detailed statistics about what was imported.

**Options:**

```bash
# Use custom database location
cargo run --example import_save -- path/to/savefile.zip --db /path/to/database.db

# Test all saves in the test-data directory
for save in test-data/saves/*.zip; do
  cargo run --example import_save -- "$save"
done
```

#### Integration Tests

Run the full integration test suite:

```bash
cd src-tauri

# Test importing a single save file
cargo test test_import_babylonia_save --release -- --nocapture

# Test reimporting the same save (update-and-replace)
cargo test test_reimport_same_save --release -- --nocapture

# Test importing multiple different saves
cargo test test_import_multiple_saves --release -- --nocapture

# Run all tests
cargo test --release -- --nocapture
```

### Database Schema

The database schema is defined in `docs/schema.sql`. The parser implements Milestones 1-6 as documented in:
- `docs/plans/xml-parser-implementation.md`
- `docs/plans/xml-parser-milestone-4-6-updates.md`
