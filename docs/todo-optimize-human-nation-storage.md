# TODO: Optimize Human Nation Storage

## Context

Currently, the `human_nation` field is derived at query time by joining the `matches` table with the `players` table and selecting the player where `is_human = true`. This works but has some inefficiencies.

**Current approach** (as of fix for bug-human-nation-detection.md):
```sql
SELECT m.match_id, m.game_name, m.save_date, m.total_turns, p.nation
FROM matches m
LEFT JOIN (
    SELECT match_id, nation,
           ROW_NUMBER() OVER (
               PARTITION BY match_id
               ORDER BY CASE WHEN is_human = true THEN 0 ELSE 1 END,
                        player_name
           ) as rn
    FROM players
) p ON m.match_id = p.match_id AND p.rn = 1
```

## Proposal: Add `human_nation` Column to `matches` Table

### Benefits

1. **Performance**: Eliminates JOIN on every game list query
2. **Simplicity**: Makes queries more straightforward
3. **Clarity**: Schema explicitly shows that each match has an associated human player nation
4. **Consistency**: Matches how we think about the data (each game has a human player)

### Implementation Tasks

#### 1. Schema Migration

Add column to `matches` table:
```sql
ALTER TABLE matches ADD COLUMN human_nation VARCHAR;
```

**File to modify**: `src-tauri/src/db/schema.rs`

#### 2. Import Logic Update

Populate `human_nation` during save file import.

**File to modify**: `src-tauri/src/parser/import.rs` (or wherever matches are inserted)

**Logic**:
```rust
// After parsing players, find human player's nation
let human_nation = players.iter()
    .find(|p| p.is_human)
    .and_then(|p| p.nation.clone());

// Insert into matches with human_nation field
conn.execute(
    "INSERT INTO matches (..., human_nation) VALUES (..., ?)",
    params![..., human_nation]
)?;
```

#### 3. Query Simplification

Simplify all queries that need human_nation:

**File to modify**: `src-tauri/src/lib.rs`

**Before**:
```sql
SELECT m.match_id, m.game_name, m.save_date, m.total_turns, p.nation
FROM matches m
LEFT JOIN (...) p ON ...
```

**After**:
```sql
SELECT match_id, game_name, save_date, total_turns, human_nation
FROM matches
ORDER BY save_date DESC
```

#### 4. Backfill Existing Data

For existing databases, need migration to populate `human_nation` for old records:

```sql
UPDATE matches m
SET human_nation = (
    SELECT nation
    FROM players p
    WHERE p.match_id = m.match_id
      AND p.is_human = true
    LIMIT 1
)
WHERE human_nation IS NULL;
```

### Considerations

1. **Migration Strategy**: How do we handle existing databases?
   - Option A: Require fresh import (delete database)
   - Option B: Write migration script to backfill data
   - Option C: Handle NULL gracefully and populate on-demand

2. **Data Integrity**: What if there's no human player?
   - Keep as nullable column
   - Fall back to first player's nation (current behavior)

3. **Multiple Human Players**: What about hotseat/multiplayer?
   - Pick first human player (consistent with current behavior)
   - Future: Could add `human_nations` array column

### Files to Review/Modify

- `src-tauri/src/db/schema.rs` - Add column to schema
- `src-tauri/src/parser/import.rs` - Populate during import
- `src-tauri/src/lib.rs` - Simplify queries
- `docs/schema.sql` - Update documentation

### Testing Checklist

- [ ] Import new save file - verify `human_nation` is populated
- [ ] Query games list - verify correct nation appears
- [ ] Import save with no human player - verify graceful handling
- [ ] Import save with multiple human players - verify consistent behavior
- [ ] Verify backwards compatibility with existing databases

## Priority

**Low-Medium** - Current fix (using JOIN with `is_human`) solves the correctness issue. This optimization can wait until:
- We notice performance issues with game list queries
- We're doing other schema changes and can bundle this
- We have time for nice-to-have improvements

## Related Files

- `docs/bug-human-nation-detection.md` - Original bug that led to this TODO
- `src-tauri/src/parser/entities/players.rs:33-39` - Where `is_human` is parsed
- `src-tauri/src/lib.rs:228-246` - Current query implementation
