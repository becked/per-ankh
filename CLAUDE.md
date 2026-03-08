# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Per-Ankh is a desktop application that ingests completed save files from the Old World game and provides data visualizations and analytics. The application is packaged for distribution to end users.

## Technology Stack

- **Application Framework**: Tauri - native desktop application framework
- **Backend**: Rust - handles data processing, file parsing, and DuckDB queries
- **Frontend Framework**: Svelte 5 - reactive UI framework with runes
- **Frontend Language**: TypeScript - type-safe JavaScript
- **Visualization**: Apache ECharts - interactive charting library
- **Database**: DuckDB (Rust bindings) - handles data storage and analytical queries
- **Package Manager**:
  - Frontend: npm/pnpm - manages JavaScript dependencies
  - Backend: Cargo - manages Rust dependencies

## ⚠️ Tauri Desktop Environment - NOT a Web Browser

**CRITICAL**: This is a native desktop application built with Tauri, NOT a traditional web application.

### Key Differences from Browser Environment

**What DOESN'T Work:**

- ❌ "Refresh the page" - This is a desktop app with hot-reload during development
- ❌ Browser DevTools shortcuts (F12) - Use the app's development tools
- ❌ Assuming synchronous browser APIs - Many are async in Tauri

**What DOES Work:**

- ✅ Hot reload during `npm run tauri dev` - File changes auto-update
- ✅ Tauri command invocations via `invoke()` - Frontend ↔ Rust backend communication
- ✅ Native OS dialogs - `window.confirm()`, `window.alert()`, file pickers

### Tauri-Specific API Behaviors

**Native Dialogs are Async:**

```typescript
// ❌ WRONG: Assumes browser behavior (synchronous)
const confirmed = window.confirm("Are you sure?");
if (!confirmed) return;

// ✅ CORRECT: Tauri returns Promise
const confirmed = await window.confirm("Are you sure?");
if (!confirmed) return;
```

**File Operations:**

- Use Tauri's dialog APIs for file/folder selection
- File paths are OS-native (not URLs)
- File operations happen in Rust backend, not frontend

**State Management:**

- Frontend state is ephemeral (resets on app restart)
- Persistent state must be stored in DuckDB or app data directory
- No localStorage/sessionStorage - use Tauri's storage plugin if needed

**Development Workflow:**

- `npm run tauri dev` - Runs app with hot reload
- Changes to frontend auto-reload
- Changes to Rust require recompilation (automatic)
- Console logs appear in terminal, not browser DevTools

**When Troubleshooting:**

- Check terminal output for Rust panics/errors
- Check browser console for frontend errors
- Don't suggest "refresh the page" - suggest restarting dev server if needed
- Remember: User is running a compiled desktop app, not visiting a URL

## Tauri Built-ins vs Web APIs

**Principle:** Prefer Tauri built-ins for type safety. We use TypeScript to catch bugs at compile time.

### ALWAYS Use Tauri Built-ins

**1. OS Integration:**

- File/folder pickers → `@tauri-apps/plugin-dialog`
- System dialogs → `@tauri-apps/plugin-dialog` (confirm, message)
- Native menus, system tray, notifications
- Window management

**Why:** Native OS integration required; web APIs won't work correctly.

**2. Type Safety Issues:**

- Any browser API that behaves differently in Tauri
- Example: `window.confirm()` returns `Promise<boolean>` in Tauri but TypeScript types it as `boolean`
- This creates silent bugs TypeScript cannot catch

**3. Security-Sensitive:**

- File system access
- Shell commands
- Process management

**Why:** Tauri APIs are sandboxed and secured by default.

### Prefer Tauri Built-ins

**4. Desktop Features:**

- Clipboard, keyboard shortcuts, app updates, persistence

**Why:** Better integration, though alternatives exist.

### Web Libraries Are Fine

**5. Pure UI/Logic:**

- Charts (ECharts), forms, layouts, data processing
- Anything with no OS interaction

**Why:** No desktop-specific concerns.

### Decision Framework

Ask yourself:

1. Does it interact with the OS? → **Use Tauri**
2. Does the browser API behave differently in Tauri? → **Use Tauri**
3. Is it security-sensitive? → **Use Tauri**
4. Is it pure UI/logic with no OS interaction? → **Web libraries OK**

### Example: Dialogs

```typescript
// ❌ BAD: window.confirm() is Promise<boolean> in Tauri but typed as boolean
const confirmed = window.confirm("Sure?"); // TypeScript thinks boolean!
if (!confirmed) return; // Bug: actually checking if Promise is falsy

// ✅ GOOD: Tauri plugin has correct types
import { confirm } from "@tauri-apps/plugin-dialog";
const confirmed = await confirm("Sure?", "Title"); // Properly typed as Promise<boolean>
if (!confirmed) return; // TypeScript enforces await
```

**Reference:** See `docs/dialog-audit-report.md` for detailed analysis of dialog usage.

## Coding Standards

### Rust Standards

- Use `rustfmt` for code formatting
- Use `clippy` for linting
- Follow Rust naming conventions (snake_case for functions/variables, CamelCase for types)
- Handle errors explicitly with `Result<T, E>` types
- Avoid `.unwrap()` in production code - use proper error handling
- Use `#[derive(Serialize, Deserialize)]` for types passed to frontend

### TypeScript/Svelte Standards

- Always use TypeScript with strict mode enabled
- Use ESLint for linting
- Use Prettier for code formatting
- Follow consistent naming conventions (camelCase for functions/variables, PascalCase for components)
- Prefer `const` over `let` when variables don't need reassignment
- **When displaying XML/backend enum values in UI**: Always use `formatEnum()` from `$lib/utils/formatting` (see "Frontend: Enum Formatting" section below)

### Svelte 5 Standards

**CRITICAL**: This project uses Svelte 5. Always use Svelte 5 runes and patterns.

**Reactive State:**

```typescript
// ✅ CORRECT: Svelte 5 runes
let count = $state(0);
let doubled = $derived(count * 2);

// ❌ WRONG: Svelte 4 patterns
let count = 0; // No reactivity
$: doubled = count * 2; // Old reactive statement syntax
```

**Props:**

```typescript
// ✅ CORRECT: Svelte 5 props
let { name, age = 0 }: { name: string; age?: number } = $props();

// ❌ WRONG: Svelte 4 export
export let name: string;
export let age: number = 0;
```

**Effects:**

```typescript
// ✅ CORRECT: Svelte 5 effect
$effect(() => {
	console.log("count changed:", count);
});

// ❌ WRONG: Svelte 4 reactive statement
$: console.log("count changed:", count);
```

**Effect Dependency Tracking:**

Svelte 5 `$effect` only tracks dependencies **at the point they're accessed**. If a reactive value is only accessed inside a conditional block, it may not be tracked when the condition is initially false.

```typescript
// ✅ CORRECT: Access reactive values unconditionally to ensure tracking
$effect(() => {
	const currentOption = option; // Always accessed → always tracked
	if (chart && currentOption) {
		chart.setOption(currentOption);
	}
});

// ❌ WRONG: Reactive value only accessed conditionally
$effect(() => {
	if (chart) {
		chart.setOption(option); // NOT tracked if chart is initially null
	}
});
```

**Store Integration:**
When using Svelte stores with Svelte 5 runes, properly integrate them:

```typescript
// ✅ CORRECT: Convert store to reactive state
import { myStore } from "./stores";

let storeValue = $state(0);
$effect(() => {
	const unsubscribe = myStore.subscribe((value) => {
		storeValue = value;
	});
	return unsubscribe;
});

// Then use storeValue reactively
$effect(() => {
	if (storeValue > 0) {
		// React to changes
	}
});

// ❌ WRONG: Top-level subscribe (causes render failures)
myStore.subscribe(() => {
	// This will break component initialization
});
```

**Why this matters**: Mixing Svelte 4 and Svelte 5 patterns causes silent failures where components fail to render. The code may compile but the app shows a blank screen.

## Code Quality Standards

### Frontend: Null/Undefined Handling

**Policy**: Use different operators based on context to prevent bugs from falsy coercion.

**Domain/Data Layer (strict)**:

- Use nullish coalescing (`??`) for null/undefined checks
- Use explicit `!= null` checks for values where `0` or `""` are valid
- **NEVER** use logical OR (`||`) in data computation or state management

```typescript
// ✅ CORRECT: Data layer
const chartData = playerData.map((p) => p.points ?? 0);
const filteredGames = games.filter((g) => g.turn_number != null);
const humanNation = game.nations.find((n) => n.is_human) ?? null;

// ❌ WRONG: Data layer
const chartData = playerData.map((p) => p.points || 0); // 0 is valid!
```

**UI Rendering Layer (pragmatic)**:

- Allow `||` only for display fallbacks where falsy values should show the fallback

```typescript
// ✅ CORRECT: UI rendering
<h1>{game.name || "Unknown Game"}</h1>
<span>{player.name || "Anonymous"}</span>

// ✅ CORRECT: UI rendering with zero handling
<span>{score != null ? score : "N/A"}</span>
```

### Frontend: Enum Formatting

**Policy**: Use the shared `formatEnum()` utility for consistent formatting of backend enum values.

```typescript
import { formatEnum } from "$lib/utils/formatting";

// ✅ CORRECT: Use utility
const nationName = formatEnum(game.nation, "NATION_");
const religionName = formatEnum(player.religion, "RELIGION_");

// ❌ WRONG: Inline string manipulation
const nationName = game.nation?.replace("NATION_", "").toLowerCase()...;
```

The utility handles:

- Prefix removal (NATION*, RELIGION*, MAPSIZE*, LEVEL*)
- Title casing
- Multi-word support (e.g., "OLD_WORLD" → "Old World")
- Null/undefined safety (returns "Unknown")

### Frontend: Color Usage

**Policy**: Use centralized color configuration with proper hierarchy.

**UI Colors** (CSS variables as single source of truth):

```typescript
// ✅ CORRECT: Use Tailwind classes
<div class="bg-brown text-tan border-black">

// ✅ CORRECT: Custom CSS with variables
.custom-element {
  background: var(--color-tan);
}

// ❌ WRONG: Hardcoded colors
<div style="background: #D2B48C">
```

**Chart Colors** (TypeScript constants):

```typescript
import { CHART_COLORS, CHART_THEME, getChartColor } from "$lib/config";

// ✅ CORRECT: Use chart theme and helper
const chartOption: EChartsOption = {
	...CHART_THEME,
	series: data.map((d, i) => ({
		...d,
		itemStyle: { color: getChartColor(i) },
	})),
};
```

**Nation/Tribe Colors** (TypeScript constants with helpers):

```typescript
import { getNationColor, getCivilizationColor } from "$lib/config";

// ✅ CORRECT: Use helper functions
const color = getCivilizationColor(player.nation) ?? getChartColor(i);
```

**Reference**: See `docs/reference/color-scheme.md` for complete color palette documentation.

### Frontend: API Layer

**Policy**: Use the centralized API layer (`src/lib/api.ts`) for all Tauri backend calls.

```typescript
import { api } from "$lib/api";

// ✅ CORRECT: Use API layer
const stats = await api.getGameStatistics();
const details = await api.getGameDetails(matchId);

// ❌ WRONG: Direct invoke calls
import { invoke } from "@tauri-apps/api/core";
const stats = await invoke<GameStatistics>("get_game_statistics");
```

**Benefits**:

- Single source of truth for backend command names
- Easy refactoring when command names change
- Type-safe function signatures
- Documents all available backend commands in one place

**Adding new commands**:

```typescript
// src/lib/api.ts
export const api = {
	// ... existing commands ...

	getEconomicData: (matchId: number) =>
		invoke<EconomicData>("get_economic_data", { matchId }),
} as const;
```

**Future**: When `api.ts` grows to 30-40+ functions, split into domain modules (games, players, economics, etc.).

### Backend: SQL Query Safety

**Policy**: Always use parameterized queries to prevent SQL injection.

**INSERT/UPDATE/DELETE queries**:

```rust
// ✅ CORRECT: Parameterized query
conn.execute(
    "INSERT INTO games (name, turn) VALUES (?, ?)",
    params![game_name, turn_number]
)?;

// ❌ WRONG: String interpolation
conn.execute(&format!("INSERT INTO games (name) VALUES ('{}')", name))?;
```

**SELECT queries (single row)**:

```rust
// ✅ CORRECT: query_row with params
let game = conn.query_row(
    "SELECT * FROM games WHERE id = ?",
    [game_id],
    |row| Ok(Game { id: row.get(0)?, name: row.get(1)? })
)?;
```

**SELECT queries (multiple rows)**:

```rust
// ✅ CORRECT: prepare + query_map
let mut stmt = conn.prepare("SELECT * FROM games WHERE turn > ?")?;
let games = stmt.query_map([min_turn], |row| {
    Ok(Game { id: row.get(0)?, name: row.get(1)? })
})?
.collect::<Result<Vec<_>, _>>()?;
```

**Table/column names (CANNOT be parameterized)**:

```rust
// ✅ CORRECT: Whitelist approach with comment
let allowed_tables = vec!["games", "players", "nations"];
if allowed_tables.contains(&table_name) {
    // Safe: table_name validated against whitelist
    let query = format!("SELECT COUNT(*) FROM {}", table_name);
    conn.query_row(&query, [], |row| row.get(0))?
}
```

**Reference**: See `src-tauri/src/db/connection.rs` for detailed query pattern documentation.

### Backend: Error Context

**Policy**: Use `anyhow::Context` for cleaner, more ergonomic error handling.

```rust
use anyhow::Context;

// ✅ CORRECT: Use Context trait
conn.execute(query, params)
    .context("Failed to insert game data")?;

let file = File::open(path)
    .context("Failed to open save file")?;

// ❌ WRONG: Verbose map_err
conn.execute(query, params)
    .map_err(|e| format!("Failed to insert game data: {}", e))?;
```

Benefits:

- More concise and readable
- Preserves full error chain for debugging
- Consistent error formatting

### Backend: DuckDB (Not SQLite!)

**Policy**: DuckDB has different syntax and capabilities from SQLite. Don't assume SQLite patterns work.

**ALTER TABLE Limitations**:
DuckDB has very limited schema modification support compared to SQLite:

- ❌ `ALTER TABLE ... DROP COLUMN` - Not supported
- ❌ `ALTER TABLE ... RENAME COLUMN` - Not supported
- ❌ `ALTER TABLE ... ALTER COLUMN TYPE` - Not supported
- ✅ `ALTER TABLE ... ADD COLUMN` - Supported
- ✅ `ALTER TABLE ... RENAME TO` - Supported

**Schema Migration Pattern**:

```sql
-- ❌ WRONG: Trying to modify columns (will fail)
ALTER TABLE games DROP COLUMN old_field;
ALTER TABLE games RENAME COLUMN foo TO bar;

-- ✅ CORRECT: Create new table, migrate data, swap
CREATE TABLE games_new AS SELECT id, name, turn FROM games;
DROP TABLE games;
ALTER TABLE games_new RENAME TO games;
```

**Other Syntax Differences**:

| Feature      | SQLite              | DuckDB                   |
| ------------ | ------------------- | ------------------------ |
| UPSERT       | `INSERT OR REPLACE` | `INSERT ... ON CONFLICT` |
| Type casting | `CAST(x AS type)`   | `CAST()` or `x::type`    |
| RETURNING    | Limited             | Full support             |

```sql
-- ❌ WRONG: SQLite upsert
INSERT OR REPLACE INTO games (id, name) VALUES (1, 'Test');

-- ✅ CORRECT: DuckDB upsert
INSERT INTO games (id, name) VALUES (1, 'Test')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
```

**When in doubt**: Check https://duckdb.org/docs/sql/introduction before assuming SQLite syntax works.

### Backend: Schema Migrations

**Location**: `src-tauri/src/db/schema.rs`

The app uses a migration registry system to handle schema updates without requiring users to re-import their save files (when possible).

**Key concepts**:

- `CURRENT_SCHEMA_VERSION`: The target schema version (e.g., "2.12.0")
- `MIGRATIONS`: Array of all migrations with version, description, and `is_breaking` flag
- **Breaking migration**: Requires database reset (new XML data needed)
- **Non-breaking migration**: Can update schema incrementally (add columns, tables, indexes)

**Adding a new migration**:

```rust
// 1. Add to MIGRATIONS array in schema.rs:
Migration {
    version: "2.13.0",
    description: "Add player statistics columns",
    is_breaking: false,  // true if needs re-parsing
},

// 2. Add migration logic in run_migration():
"2.13.0" => {
    conn.execute("ALTER TABLE players ADD COLUMN total_cities INTEGER", [])?;
    conn.execute("UPDATE players SET total_cities = ...", [])?;
    Ok(())
}

// 3. Update CURRENT_SCHEMA_VERSION:
pub const CURRENT_SCHEMA_VERSION: &str = "2.13.0";
```

**When to mark as breaking (`is_breaking: true`)**:

- New data from XML that wasn't previously extracted
- Changed parsing logic that produces different values
- Structural changes that can't be computed from existing data

**When to mark as non-breaking (`is_breaking: false`)**:

- Adding columns with computable defaults or NULL
- Adding new tables (empty until new saves are parsed)
- Adding indexes or views
- Removing unused columns (just stop using them in code)

**Structural check**: The system checks if the database structure matches the current schema before requiring a reset. If structure is current but migration records are outdated, it updates records without resetting.

## Development Commands

### Initial Setup

```bash
# Install Tauri CLI
cargo install tauri-cli

# Install frontend dependencies
npm install
```

### Running the Application

```bash
# Run in development mode with hot reload
npm run tauri dev

# Or using cargo directly
cargo tauri dev
```

### Building for Distribution

```bash
# Build for current platform (creates .app, .exe, or Linux binary)
npm run tauri build

# Build creates optimized bundle in src-tauri/target/release/bundle/
```

### Testing

```bash
# Run Rust tests
cargo test

# Run frontend tests (when added)
npm test
```

### Cloud Admin CLI

`cloud/admin.sh` manages shared games on Cloudflare (D1 database + R2 blob storage). Uses `wrangler` commands directly — no API key needed, relies on Wrangler auth.

**Prerequisites**: `jq`, `wrangler` (via npx from cloud/)

```bash
./cloud/admin.sh stats                          # Summary: total shares, size, keys, 24h activity
./cloud/admin.sh list [--limit N]               # List shares (default 50)
./cloud/admin.sh info <share_id>                # Full details for one share
./cloud/admin.sh keys                           # App keys with share counts
./cloud/admin.sh by-key <app_key>               # Shares from a specific key
./cloud/admin.sh events [--type T] [--limit N]  # Audit log (upload/delete events)
./cloud/admin.sh delete <share_id>              # Delete share (D1 + R2, prompts y/N)
./cloud/admin.sh block-key <key> [reason]       # Block an app key
./cloud/admin.sh block-ip <ip> [reason]         # Block an IP
./cloud/admin.sh unblock-key <key>              # Unblock
./cloud/admin.sh unblock-ip <ip>                # Unblock
./cloud/admin.sh blocked                        # List all blocked keys/IPs
./cloud/admin.sh nuke-key <key> [reason]        # Block key + delete ALL its shares (requires typing "nuke")
```

**Implementation**: Wraps `wrangler d1 execute per-ankh-share-index --remote` for D1 queries and `wrangler r2 object delete per-ankh-shares/{id}.json.gz` for blob cleanup. Never exposes `delete_token` in output.

**Desktop UX on admin delete**: Desktop app continues showing "Shared" status (local DuckDB state). When user visits the link, web viewer shows "Share Not Found". When user clicks "Delete share" in app, 404 from Worker is treated as success and local state is cleaned up gracefully.

### Type Checking & Linting

#### Rust

```bash
# Check Rust code compiles
cargo check

# Run Clippy linter
cargo clippy

# Format Rust code
cargo fmt
```

#### TypeScript/Svelte

```bash
# Type check TypeScript
npm run check

# Run ESLint
npm run lint

# Format with Prettier
npm run format
```

### TypeScript Type Generation

TypeScript types are automatically generated from Rust structs using `ts-rs`:

```bash
# Manually regenerate types (rarely needed)
npm run types:generate

# Types are automatically regenerated when:
# 1. Running npm run tauri:dev or npm run tauri:build
# 2. Committing Rust files (via git pre-commit hook)
```

**Important**:

- Generated types are in `src/lib/types/` directory
- Never edit these files manually - they're auto-generated
- To add new types: add `#[derive(TS)]` and `#[ts(export)]` to your Rust struct
- Run tests to generate: `cargo test --lib export_bindings`

## Architecture

### Application Structure

```
per-ankh/
├── src/                    # Svelte frontend source
│   ├── lib/               # Svelte components and utilities
│   │   ├── game-detail/   # Shared game detail view (desktop + web)
│   │   ├── config/        # Chart colors, nation colors, theme
│   │   ├── types/         # Auto-generated TypeScript types from Rust
│   │   └── utils/         # Formatting utilities
│   ├── routes/            # App pages/routes
│   └── App.svelte         # Main app component
├── src-tauri/             # Rust backend source
│   ├── src/
│   │   ├── main.rs       # Tauri app entry point
│   │   ├── commands.rs   # Tauri command handlers
│   │   ├── db.rs         # DuckDB integration
│   │   └── parser.rs     # Save file parsing
│   ├── Cargo.toml        # Rust dependencies
│   └── tauri.conf.json   # Tauri configuration
├── web/                    # Static web viewer for shared games
│   └── src/lib/           # Symlinks to src/lib/ for shared components
├── test-data/             # Test fixtures
│   └── saves/            # Sample Old World save files for development/testing
├── package.json           # Frontend dependencies
└── tsconfig.json         # TypeScript configuration
```

### Test Data

The `test-data/saves/` directory contains sample Old World game save files that can be used for:

- Development and manual testing without needing your own save files
- Troubleshooting parsing or data issues
- Reproducing bugs with known test data

### Data Flow

1. **Ingestion**: Rust backend reads and parses Old World save files (XML/JSON format)
2. **Storage**: Rust backend loads parsed data into DuckDB using Rust DuckDB bindings
3. **Queries**: Frontend invokes Rust Tauri commands to query DuckDB
4. **Visualization**: Svelte components receive data and render with ECharts
5. **Distribution**: Tauri bundles Rust backend, Svelte frontend, and DuckDB into native executable

### Key Considerations

- **DuckDB file location**: Store in user data directory (use Tauri's `app_data_dir`)
- **Save file parsing**: Handle different Old World game versions gracefully
- **Error handling**: Rust errors should be serialized and displayed to user in UI
- **State management**: Use Svelte stores for reactive state
- **Tauri commands**: Keep commands focused and single-responsibility
- **Type safety**: Ensure Rust types match TypeScript interfaces for Tauri IPC

### Game Detail View (Shared Desktop + Web)

The game detail page is shared between the desktop app and the web share viewer via `src/lib/game-detail/`. The web project symlinks to this directory.

**Architecture:**

```
Wrapper Page (thin, context-specific)
  ├── Desktop: data fetching via Tauri API, map turn slider, ShareControl
  ├── Web: data fetching via HTTP, error handling, share banner
  │
  └── GameDetailView (receives all loaded data as non-null props)
        ├── Owns: activeTab, chartFilters, tables, cityVisibleColumns
        ├── Accepts snippet props: headerActions, preTabs
        │
        └── Tab Components (receive data + $bindable state slices)
```

**Adding a new yield chart**: Add one entry to `YIELD_CHART_CONFIG` in `src/lib/game-detail/helpers.ts`:

```typescript
{ yieldType: "YIELD_NEW", title: "New Yield", yAxisLabel: "Per Turn", filterKey: "new" },
```

Also add `"new"` to the `ChartFilterKey` type and `PLAYER_CHART_KEYS` array in the same file.

**Adding a new tab**: Create a new `FooTab.svelte` in `src/lib/game-detail/`, then add a `Tabs.Trigger` and `Tabs.Content` in `GameDetailView.svelte`. Both desktop and web get the tab automatically.

**When changes require new backend data (share implications):**

UI-only changes (rearranging layout, new charts using existing data) propagate to the web viewer automatically via symlinks — just redeploy the web app. But if a new chart/tab needs data not already in `SharedGameData`, you must update 4 layers:

1. **Rust** (`src-tauri/src/db/queries/share.rs`): Add the field to `SharedGameData` and query it in `assemble_shared_game_data()`
2. **Cloudflare Worker** (`cloud/src/index.ts`): Update schema validation to accept the new field
3. **Web API** (`web/src/lib/api-web.ts`): Add a `webApi` function that slices the new field from the cached blob
4. **Shared component** (`src/lib/game-detail/`): The new tab/chart itself

**Deploy ordering**: The Cloudflare Worker must be deployed with the new schema version **before** releasing the desktop app update. Otherwise, users on the new app version will have their share requests rejected by the Worker's schema validation. See `cloud/src/validation.ts` for the `KNOWN_SCHEMA_VERSIONS` list.

Previously shared games won't have the new field, so the web viewer must handle it being absent (e.g., `data.newField ?? []`).

**Key files:**

| File | Purpose |
|------|---------|
| `src/lib/game-detail/helpers.ts` | Types, constants (YIELD_CHART_CONFIG, CITY_COLUMNS), pure functions |
| `src/lib/game-detail/GameDetailView.svelte` | Orchestrator: summary, tabs, persistent UI state |
| `src/lib/game-detail/index.ts` | Re-export for clean imports |
| `src/routes/game/[id]/+page.svelte` | Desktop wrapper (~150 lines) |
| `web/src/routes/share/[id]/+page.svelte` | Web wrapper (~150 lines) |

## Player Identity & Winner Model

### User Identity (`primary_user_online_id`)

The app identifies "you" (the current user) via a Steam/GOG/Epic OnlineID stored in `user_settings`:

```sql
SELECT value FROM user_settings WHERE key = 'primary_user_online_id'
```

- **Auto-detected** on first import from the most common `online_id` across all players
- **Manually configurable** via Settings UI (calls `set_primary_user_online_id` Tauri command)
- Used to set `is_save_owner = TRUE` on the user's player in each match

### Save Owner (`is_save_owner`)

Despite the name, `is_save_owner` identifies the **app user's player** in each match — not who created the save file. It's the "whose perspective are we showing?" flag.

**How it's set** (via `reprocess_save_owners()` in `src-tauri/src/db/settings.rs`):

| Game type | Logic |
|-----------|-------|
| Single-player (1 human) | The sole human player |
| Multiplayer (2+ humans) | Player whose `online_id` matches `primary_user_online_id` |
| Multiplayer, no primary ID set | Falls back to `AIControlledToTurn=0` (file creator) |

**When it's reprocessed**: On every import, when `primary_user_online_id` changes, and via schema migrations.

### Winner Determination

**Who won a game:**

```sql
-- Winner's identity
SELECT wp.player_name, wp.nation AS winner_civilization
FROM matches m
JOIN players wp ON m.match_id = wp.match_id AND m.winner_player_id = wp.player_id
```

**Did the user win:**

```sql
-- For a specific match
SELECT m.winner_player_id = so.player_id AS user_won
FROM matches m
JOIN players so ON m.match_id = so.match_id AND so.is_save_owner = TRUE
WHERE m.match_id = ? AND m.winner_player_id IS NOT NULL
```

**For reports/filters**, use `is_save_owner = TRUE` to find the user's player, then compare against `winner_player_id`:

```sql
-- All games with win/loss status
SELECT m.match_id, m.game_name,
       CASE
           WHEN m.winner_player_id IS NULL THEN 'in_progress'
           WHEN m.winner_player_id = so.player_id THEN 'won'
           ELSE 'lost'
       END AS result
FROM matches m
LEFT JOIN players so ON m.match_id = so.match_id AND so.is_save_owner = TRUE
```

### Key Files

| File | Purpose |
|------|---------|
| `src-tauri/src/db/settings.rs` | `reprocess_save_owners()`, get/set `primary_user_online_id` |
| `src-tauri/src/parser/import.rs` | `determine_save_owner()` (import-time detection) |
| `src-tauri/src/db/queries/games.rs` | Sidebar queries computing `save_owner_won` |
| `src-tauri/src/db/queries/match_data.rs` | Game detail query with `winner_civilization` |

## Development Principles

### YAGNI (You Ain't Gonna Need It)

- Only implement what is needed NOW, not what "might be useful later"
- Avoid premature abstraction

### DRY (Don't Repeat Yourself)

- Reuse existing code patterns and logic
- Extract duplicated code to shared functions

### Atomic Commits

- Each commit should represent ONE logical change
- Commit frequently (after each task/subtask completion)
- Commit messages should clearly describe what changed and why
- Don't batch multiple unrelated changes into one commit

### Code Comments

- Comments should explain **WHY**, not **WHAT**
- The code itself should be clear enough to show what it does
- Document edge cases, business rules, and non-obvious decisions
- Example: Good comment explains XML ID mapping rationale, not just the formula

## Commit Messages

Do NOT include these lines in commit messages:

- `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- `Co-Authored-By: Claude <noreply@anthropic.com>`

Use conventional commit format:

- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation
- `test:` for tests
- `refactor:` for code changes that don't add features or fix bugs
- `perf:` for performance improvements
- `chore:` for maintenance tasks
