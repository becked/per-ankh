# Fix Human Player Detection

## Problem

Current implementation in `src-tauri/src/parser/entities/players.rs:34`:
```rust
let is_human = player_node.opt_attr("AIControlledToTurn").is_none();
```

This logic is incorrect for 2025+ game saves:
- **Actual behavior:** Attribute is always present
  - Human players: `AIControlledToTurn="0"`
  - AI players: `AIControlledToTurn="2147483647"`
- **Current logic:** Checks if attribute is absent (always false)
- **Result:** All players marked as AI (`is_human = false`)

## Solution

Fix the detection logic to check the attribute value, not its presence.

### Implementation

**File:** `src-tauri/src/parser/entities/players.rs`

**Change line 34 from:**
```rust
let is_human = player_node.opt_attr("AIControlledToTurn").is_none();
```

**To:**
```rust
let is_human = player_node
    .opt_attr("AIControlledToTurn")
    .and_then(|s| s.parse::<i32>().ok())
    .map(|turn| turn == 0)
    .unwrap_or(true); // Default to human if attribute missing (backward compatibility)
```

### Logic Breakdown

1. Get `AIControlledToTurn` attribute (returns `Option<&str>`)
2. Parse as `i32` (returns `Option<i32>`)
3. Check if value equals `0` (returns `Option<bool>`)
4. Default to `true` if attribute missing (handles older save formats)

## Testing

Re-import existing saves and verify:
```sql
SELECT match_id, COUNT(*) as human_count
FROM players
WHERE is_human = true
GROUP BY match_id;
```

Expected results:
- Single-player games: 1 human player per match
- Hotseat games: 2+ human players per match

## Impact

- Fixes game name fallback logic (will now correctly identify human player's nation)
- Enables proper human vs AI player filtering in future features
- Backward compatible with older save formats

## Out of Scope (YAGNI)

- ✗ Parsing `<PlayerHuman>` elements (not needed - attribute is sufficient)
- ✗ Parsing `<?ActivePlayer?>` processing instruction (not needed for this use case)
- ✗ Adding hotseat-specific features (not requested)
