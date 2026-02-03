# Plan: Yield Display Views

## Status: Ready for Implementation

## Problem

Yield values are stored as raw integers from the game (fixed-point × 10), but the `/10.0` conversion for display is scattered in query code. As we add more yield queries, this pattern would repeat.

## Current State

**Good news**: We already store raw integers. No schema or parser changes needed.

| Component | Current Behavior                             |
| --------- | -------------------------------------------- |
| Parser    | Stores raw XML integers (correct)            |
| Schema    | INTEGER columns (correct)                    |
| Queries   | One query does `/10.0` inline (`lib.rs:467`) |

## Solution

Create a database view that handles the `/10.0` conversion. Queries use the view instead of the base table.

## Implementation

### Step 1: Add view to schema

In `docs/schema.sql`, after `yield_history` table definition (~line 791):

```sql
-- Display view: converts fixed-point integers to display values
CREATE VIEW yield_history_display AS
SELECT
    match_id,
    player_id,
    turn,
    yield_type,
    amount / 10.0 AS amount
FROM yield_history;
```

### Step 2: Create view in Rust

In `src-tauri/src/db/schema.rs`, add after table creation:

```rust
conn.execute(
    "CREATE VIEW IF NOT EXISTS yield_history_display AS
     SELECT match_id, player_id, turn, yield_type, amount / 10.0 AS amount
     FROM yield_history",
    [],
)?;
```

### Step 3: Update query

In `src-tauri/src/lib.rs` at line ~467, change:

```rust
// Before
"SELECT turn, amount / 10.0 AS display_amount FROM yield_history ..."

// After
"SELECT turn, amount FROM yield_history_display ..."
```

### Step 4: Delete database and reimport

Since we're in development, delete the DuckDB file and reimport a save to create the new view.

## Files Changed

1. `docs/schema.sql` - Document the view
2. `src-tauri/src/db/schema.rs` - Create view on DB init
3. `src-tauri/src/lib.rs` - Use view in query (~1 line change)

## Not In Scope (YAGNI)

- Views for `player_resources`, `city_yields`, `yield_prices` - no queries use them yet
- Renaming columns (e.g., `amount_raw`) - current names are fine
- Adding both raw and display columns - pick one per table/view

## Future

When we add queries for other yield tables, follow the same pattern:

1. Base table stores raw integers
2. Create `*_display` view with `/10.0`
3. Queries use the view

## Verification

After implementation:

1. Run `cargo test`
2. Import a save file
3. Open yield chart - values should display correctly (e.g., 21.5, not 215)
