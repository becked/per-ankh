# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Per-Ankh is a desktop application that ingests completed save files from the Old World game and provides data visualizations and analytics. The application is packaged for distribution to end users.

## Technology Stack

- **Application Framework**: Tauri - native desktop application framework
- **Backend**: Rust - handles data processing, file parsing, and DuckDB queries
- **Frontend Framework**: Svelte - reactive UI framework
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

## Code Quality Standards

### Frontend: Null/Undefined Handling

**Policy**: Use different operators based on context to prevent bugs from falsy coercion.

**Domain/Data Layer (strict)**:
- Use nullish coalescing (`??`) for null/undefined checks
- Use explicit `!= null` checks for values where `0` or `""` are valid
- **NEVER** use logical OR (`||`) in data computation or state management

```typescript
// ✅ CORRECT: Data layer
const chartData = playerData.map(p => p.points ?? 0);
const filteredGames = games.filter(g => g.turn_number != null);
const humanNation = game.nations.find(n => n.is_human) ?? null;

// ❌ WRONG: Data layer
const chartData = playerData.map(p => p.points || 0);  // 0 is valid!
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
- Prefix removal (NATION_, RELIGION_, MAPSIZE_, LEVEL_)
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
    itemStyle: { color: getChartColor(i) }
  }))
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
│   ├── lib/               # Svelte components
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
├── package.json           # Frontend dependencies
└── tsconfig.json         # TypeScript configuration
```

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
