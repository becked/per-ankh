# Per-Ankh

Old World save game analyzer and visualizer built with Tauri, Rust, SvelteKit, and DuckDB.

## Project Overview

Per-Ankh imports Old World game save files and provides data visualizations and analytics. The application parses save files (ZIP archives containing XML), extracts game state into a DuckDB database, and presents interactive visualizations through a desktop UI.

## Development

### Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).

### Common Development Tasks

Use the `per-ankh.sh` helper script for common operations:

```bash
# Import a single save file
./per-ankh.sh import test-data/saves/OW-Greece-Year74-2022-01-02-20-28-07.zip

# Import all test saves
./per-ankh.sh import-all

# Import only Greece saves
./per-ankh.sh import-all test-data/saves per-ankh.db "OW-Greece*.zip"

# Clean database and reimport all saves
./per-ankh.sh clean && ./per-ankh.sh import-all

# Run the app in development mode
./per-ankh.sh dev

# Build for distribution
./per-ankh.sh build

# Run tests
./per-ankh.sh test

# Run specific test
./per-ankh.sh test test_import_babylonia_save

# Check code quality (cargo check, clippy, fmt)
./per-ankh.sh check

# Format code
./per-ankh.sh format

# Show database info
./per-ankh.sh db-info

# Analyze database contents (empty tables, empty columns)
./per-ankh.sh db-analyze

# Show all available commands
./per-ankh.sh help
```

#### Integration Tests

Run the full integration test suite using the helper script:

```bash
# Run all tests
./per-ankh.sh test-release

# Test importing a single save file
./per-ankh.sh test-release test_import_babylonia_save

# Test reimporting the same save (update-and-replace)
./per-ankh.sh test-release test_reimport_same_save

# Test importing multiple different saves
./per-ankh.sh test-release test_import_multiple_saves
```

### Database Schema

The database schema is defined in `docs/schema.sql`. The parser implements Milestones 1-6 as documented in:
- `docs/plans/xml-parser-implementation.md`
- `docs/plans/xml-parser-milestone-4-6-updates.md`

### Database Analysis

Analyze the database to check table population and identify empty tables or columns:

```bash
./per-ankh.sh db-analyze
```

This command:
- Shows row counts for all tables
- Identifies completely empty tables
- Identifies columns that are empty (all NULL) in populated tables
- Calculates overall data completeness percentage

The analysis helps track parser implementation progress and identify data gaps. See `docs/database-analysis-2025-11-06.md` for the most recent analysis report.
