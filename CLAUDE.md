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
