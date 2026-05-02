# Per-Ankh

Old World save game analyzer and visualizer built with Tauri, Rust, SvelteKit, and DuckDB.

## Project Overview

Per-Ankh imports Old World game save files and provides data visualizations and analytics. The application parses save files (ZIP archives containing XML), extracts game state into a DuckDB database, and presents interactive visualizations through a desktop UI.

## Legal Notice

Per-Ankh is an independent, unofficial fan project. It is not affiliated with, endorsed by, sponsored by, or connected to Mohawk Games, Hooded Horse, or any of their affiliates.

"Old World" is a trademark of Mohawk Games. Mohawk Games holds the copyright in *Old World* and all of its visual assets, save file formats, and game data.

Per-Ankh's source code is licensed under the MIT License (see [LICENSE](LICENSE)). The visual assets bundled under `static/atlases/` and `static/sprites/` are derived from *Old World* and remain the property of Mohawk Games — they are **not** covered by the MIT License and are included solely as build artifacts to support analysis of save files from games the end user legally owns. See the "Third-Party Content" section of [LICENSE](LICENSE) for details.

This application:

- Analyzes save files from games you legally own
- Is provided free and open-source for the benefit of the Old World community

This software is provided "as is" without warranty of any kind.

## Development

### Setup

After cloning:

**1. Activate the repo's git hooks** (one-time, per clone):

```bash
git config core.hooksPath scripts/hooks
```

Wires up the pre-commit hook that regenerates TypeScript types from Rust
structs and stages them alongside your commit. `.git/hooks/` isn't versioned,
so this step is required on every clone (and every git worktree).

**2. Install dependencies:**

```bash
npm install
```

**3. Configure asset paths.** The visual assets under `static/atlases/` and
`static/sprites/` are derived from *Old World* and are not committed to git
(see the "Third-Party Content" section of [LICENSE](LICENSE)). They're
regenerated locally from your own [pinacotheca](https://github.com/becked/pinacotheca)
checkout and Old World install.

You'll need:

- A pinacotheca checkout (anywhere on disk).
- An Old World install (the `bake:improvements` step reads its reference XML).

Copy `.env.example` to `.env` and fill in absolute paths:

```bash
cp .env.example .env
```

- `PINACOTHECA_DIR` — your pinacotheca checkout root.
- `OLD_WORLD_REFERENCE_DIR` — directory containing an `XML/` subdir (typically your Old World install). Only required by `bake:improvements`.

Both env vars fall back to relative-path candidates if unset (pinacotheca as a
sibling of per-ankh; a `Reference/` directory or symlink at the repo root),
but the env-var path is recommended on Windows since it sidesteps any
symlink-permission concerns.

**4. Bake the assets:**

```bash
npm run bake:all
```

This populates `static/atlases/` and `static/sprites/` from your pinacotheca
checkout. Re-run any time pinacotheca refreshes its renders.

### Upgrading from a previous local checkout

If you cloned per-ankh before `static/atlases/` and `static/sprites/` were
gitignored, those directories are removed from the working tree on pull. After
pulling these changes, run:

```bash
npm run bake:all
```

to regenerate them locally. You'll need `PINACOTHECA_DIR` configured in `.env`
(see step 3 above).

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

# Test importing multiple different saves
./per-ankh.sh test-release test_import_multiple_saves
```

### Database Schema

The schema is managed by a versioned migration system in `src-tauri/src/db/schema.rs`. A reference SQL snapshot is available in `docs/schema.sql` (may lag behind the Rust source).

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

### Cloud Admin CLI

Manage shared games on Cloudflare (D1 + R2) using `cloud/admin.sh`. Requires `wrangler` auth (`wrangler login`) and `jq`.

```bash
# Summary statistics
./cloud/admin.sh stats

# List recent shares
./cloud/admin.sh list
./cloud/admin.sh list --limit 10

# Show full details for a share
./cloud/admin.sh info <share_id>

# List app keys with share counts
./cloud/admin.sh keys

# List shares from a specific app key
./cloud/admin.sh by-key <app_key>

# View recent events (uploads/deletes)
./cloud/admin.sh events
./cloud/admin.sh events --type upload --limit 20

# Delete a share (prompts for confirmation)
./cloud/admin.sh delete <share_id>

# Block/unblock app keys and IPs
./cloud/admin.sh block-key <key> "spam uploads"
./cloud/admin.sh block-ip <ip> "abuse"
./cloud/admin.sh unblock-key <key>
./cloud/admin.sh unblock-ip <ip>
./cloud/admin.sh blocked

# Nuclear option: block key + delete all its shares
./cloud/admin.sh nuke-key <app_key> "reason"

# Show all commands
./cloud/admin.sh help
```

When a share is deleted server-side, the desktop user's app continues to show "Shared" status (local state) until they either visit the link (sees "Share Not Found") or click "Delete share" (handled gracefully — 404 treated as success, local state cleaned up).
