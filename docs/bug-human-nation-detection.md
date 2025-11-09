# Bug Report: Human Nation Detection Issue

## Status: FIXED ✓

**Fixed in**: src-tauri/src/lib.rs:240 (updated SQL query to prioritize `is_human = true`)

## Summary

The query was incorrectly selecting the human player's nation by prioritizing alphabetical player names instead of using the `is_human` flag. A Babylonian game was being displayed with `human_nation = "NATION_CARTHAGE"` instead of `"NATION_BABYLONIA"` because "Carthage" came first alphabetically.

## Observed Behavior

**Database State:**
- `game_name`: "Game 5"
- `human_nation`: "NATION_CARTHAGE" ❌ (incorrect)
- Expected: "NATION_BABYLONIA" ✓

**User Impact:**
- Sidebar displays: "Carthage - 113 turns" (shows wrong nation)
- Detail page displays: "Game 5" (shows placeholder name)
- Charts/stats show wrong nation color for human player
- User confusion about which nation they played

## Frontend Behavior (Working as Designed)

The frontend has two different approaches to displaying game titles:

### Sidebar (`src/lib/GameSidebar.svelte:44-69`)

```typescript
function formatGameTitle(game: GameInfo): string {
  // Check if game_name is real or auto-generated "GameN" pattern
  const isRealName = game.game_name != null &&
                     game.game_name !== "" &&
                     !game.game_name.match(/^Game\d+$/);

  if (isRealName) {
    return game.game_name!;
  }

  // Fallback: show nation + turns
  const formattedNation = formatNation(game.human_nation);
  if (formattedNation !== null && game.total_turns != null) {
    return `${formattedNation} - ${game.total_turns} turns`;
  }

  // Additional fallbacks...
}
```

**Logic:** If `game_name` matches `/^Game\d+$/`, treat it as auto-generated and show the human nation instead.

### Detail Page (`src/routes/game/[id]/+page.svelte:239`)

```svelte
<h1>{gameDetails.game_name || `Game ${gameDetails.match_id}`}</h1>
```

**Logic:** Just show `game_name` directly from the database.

### Why the Inconsistency

- Sidebar sees "Game 5" → matches auto-gen pattern → shows human_nation ("Carthage") ❌
- Detail page sees "Game 5" → just displays it as-is

The frontend is working correctly. The bug is that `human_nation` contains the wrong value.

## Root Cause: SQL Query (NOT Parser)

**Investigation Result**: The parser was working correctly. The bug was in the SQL query that retrieves game information.

### Where to Investigate

**File:** `src-tauri/src/parser.rs` (or wherever save file parsing happens)

**Look for:**
1. Code that identifies the human player
2. Logic that extracts/assigns the nation for the human player
3. How `human_nation` field gets populated in the database

### Likely Scenarios

**Scenario 1: Player Index Mismatch**
```rust
// Wrong: assumes human is always player 0
let human_nation = players[0].nation;

// Correct: find the actual human player
let human_nation = players.iter()
    .find(|p| p.is_human)
    .map(|p| p.nation)
    .unwrap_or("NATION_UNKNOWN");
```

**Scenario 2: Nation Assignment Order**
```rust
// If nation assignment happens before is_human detection,
// the nation might be assigned to wrong player
```

**Scenario 3: Multi-Player Game Logic**
```rust
// In multiplayer, might be picking wrong human
// (if there are multiple human players in hotseat mode)
```

## Reproduction Steps

1. Import a save file where the human player is Babylonia
2. Check database: `SELECT game_name, human_nation FROM games WHERE match_id = X`
3. Observe: `human_nation` shows incorrect nation (e.g., "NATION_CARTHAGE")

## Expected Fix

After fix:
- Parse save file to correctly identify human player
- Store correct nation in `human_nation` field
- Sidebar will then display correct nation name
- Charts will use correct nation colors

## Database Schema Context

**Table:** `games`
**Relevant Fields:**
- `game_name` (TEXT): User-provided name or auto-generated "Game{N}"
- `human_nation` (TEXT): Should be the NATION_* enum of the human player
- `match_id` (INTEGER): Primary key

**Related Table:** `players`
- Stores all players in the game
- Has `is_human` (BOOLEAN) flag
- Has `nation` (TEXT) field

The `games.human_nation` field is likely derived from `players` table where `is_human = true`.

## Verification After Fix

1. Delete database: `rm -f ~/Library/Application\ Support/com.becked.per-ankh/per-ankh.db`
2. Re-import the Babylonian save file
3. Check database: `SELECT game_name, human_nation FROM games`
4. Verify: `human_nation = "NATION_BABYLONIA"`
5. Check UI: Sidebar should show "Babylonia - N turns"

## Additional Context

### Old World Save File Format

Old World uses XML save files with structure like:
```xml
<game>
  <players>
    <player index="0" team="0" ...>
      <nation>NATION_BABYLONIA</nation>
      <isHuman>true</isHuman>
    </player>
    <player index="1" team="1" ...>
      <nation>NATION_CARTHAGE</nation>
      <isHuman>false</isHuman>
    </player>
  </players>
</game>
```

The parser needs to:
1. Find the player with `<isHuman>true</isHuman>`
2. Extract that player's `<nation>` value
3. Store it as `games.human_nation`

### Game Name Context

Old World save files have a `<gameName>` field:
- If user named the game: contains actual name (e.g., "My Epic Campaign")
- If not named: often empty or contains placeholder like "Game 5"

The frontend treats "GameN" pattern as placeholder and prefers showing the nation name instead.

## Questions for Investigation

1. How does the parser identify which player is human?
2. Is there a player ordering assumption that could be wrong?
3. Are we correctly handling multiplayer/hotseat scenarios?
4. Could there be a bug in XML parsing that reads the wrong player node?
5. Is the nation being extracted before or after identifying the human player?

## Related Files

- `src-tauri/src/parser.rs` - Save file parser
- `src-tauri/src/db/schema.rs` - Database schema
- `src-tauri/src/db/queries.rs` - Database queries
- `src/lib/GameSidebar.svelte:44-69` - Frontend title formatting
- `src/routes/game/[id]/+page.svelte:239` - Detail page title display

---

## Fix Applied

### What Was Wrong

**File**: `src-tauri/src/lib.rs:228-246` (`get_games_list` command)

The SQL query was selecting the nation from the `players` table using this ordering:
```sql
ORDER BY
    CASE WHEN player_name IS NOT NULL AND LENGTH(player_name) > 0
         THEN 0 ELSE 1 END,
    player_name
```

This meant it picked **the first player alphabetically by name**, not the human player. If an AI player's nation name came before your player name alphabetically (e.g., "Carthage" < "Jeff"), it would select the wrong nation.

### The Fix

Updated the SQL query to prioritize the `is_human` flag:
```sql
ORDER BY
    CASE WHEN is_human = true THEN 0 ELSE 1 END,
    CASE WHEN player_name IS NOT NULL AND LENGTH(player_name) > 0
         THEN 0 ELSE 1 END,
    player_name
```

Now the query:
1. **First** selects human players (`is_human = true`)
2. Then prioritizes players with names
3. Finally sorts alphabetically as a fallback

### Testing the Fix

To verify the fix works:

1. Delete the database to force a fresh import:
   ```bash
   rm -f ~/Library/Application\ Support/com.becked.per-ankh/per-ankh.db
   ```

2. Re-import your Babylonian save file

3. Check the database:
   ```sql
   SELECT game_name, human_nation FROM matches WHERE match_id = X;
   ```
   Should now show: `human_nation = "NATION_BABYLONIA"`

4. Check the UI:
   - Sidebar should display: "Babylonia - N turns" (or the custom game name if set)
   - Detail page should show correct nation color and info

### Future Optimization

See `docs/todo-optimize-human-nation-storage.md` for a potential future optimization to store `human_nation` directly in the `matches` table instead of computing it via JOIN.
