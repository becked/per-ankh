# Feature 1.1: Match Summary Card Enhancement - Implementation Plan

## Overview

Enhance the Match Summary Card to display missing metadata from the statistics report.

**Current Status:** 🔨 PARTIAL
**Priority:** 🟢 Easy
**Target Completion:** Phase 1 MVP

---

## Requirements Summary

### Currently Implemented ✅
- Game name, total turns
- Map size, width, height
- Game mode, difficulty
- Players table with: name, nation, type (Human/AI), legitimacy, state religion
- Player count (calculated from players array)

### Missing Features (This Implementation)
1. 📋 **Winner Information** - Backend complete (data in DB), needs frontend display
2. 📋 **Victory Conditions** - Data in DB (`matches.victory_conditions`), needs query + display
3. 📋 **DLC List** - Data in DB (`matches.enabled_dlc`), needs query + display

### Backend Implementation Status ✅
- ✅ **Winner Extraction**: XML parsing implemented in `src-tauri/src/parser/import.rs`
- ✅ **Database Storage**: `matches.winner_player_id` populated for completed games
- ✅ **Match Summary View**: Provides `winner_name`, `winner_civilization` via LEFT JOIN
- ✅ **Integration Test**: `winner_extraction_test.rs` validates end-to-end flow

---

## Architecture Decisions

### 1. Display Location: **Hybrid Approach**

**This Implementation:**
- Winner Info → Summary bar (lines 254-270 in game detail page)
- Victory Conditions → Settings tab grid
- DLC List → Settings tab grid

**Rationale:**
- Winner is primary metadata users want to see immediately (high visibility)
- Settings tab has space for detailed metadata (victory conditions, DLC)
- Follows user's mental model: "Who won?" is the first question

### 2. Winner Backend Implementation: **XML Parsing (Completed)**

**Implementation Details:**
- Winner parsed from `TeamVictories` element in save file XML during import
- Stored in `matches.winner_player_id` (NULL for in-progress games)
- Team ID resolved to Player XML ID → Player DB ID via IdMapper
- Fallback for single-player games: use human player when team attributes unavailable
- Integration test validates extraction from completed game saves

**Performance Impact:**
- 1 UPDATE query per import (~0.1ms)
- No additional XML parsing passes
- Winner extraction happens during existing metadata parsing

### 3. Winner Query Strategy: **Extend get_game_details()**

**Decision:** Add winner fields to existing `GameDetails` struct and query.

**Fields to Add:**
```rust
pub winner_player_id: Option<i64>,
pub winner_name: Option<String>,
pub winner_civilization: Option<String>,
pub winner_victory_type: Option<String>,
```

**SQL Query:**
```sql
SELECT m.match_id, m.game_name, CAST(m.save_date AS VARCHAR) as save_date,
       m.total_turns, m.map_size, m.map_width, m.map_height,
       m.game_mode, m.opponent_level, m.victory_conditions, m.enabled_dlc,
       m.winner_player_id,
       wp.player_name as winner_name,
       wp.nation as winner_civilization,
       -- Victory type: extract from TeamVictories (future enhancement)
       NULL as winner_victory_type
FROM matches m
LEFT JOIN players wp ON m.match_id = wp.match_id AND m.winner_player_id = wp.player_id
WHERE m.match_id = ?
```

**Rationale:**
- DRY - reuses existing query and struct
- Type-safe - all data validated by Rust types
- Single database round-trip

### 4. Winner Display Format: **Name + Civilization + Victory Type**

**Display Examples:**
```
Winner: Gilgamesh (Assyria) - Victory Points
Winner: Hatshepsut (Egypt) - Domination
Game In Progress  // When winner_player_id is NULL
```

**Implementation:**
```typescript
const winnerDisplay = $derived(() => {
  if (!gameDetails.winner_player_id) return "Game In Progress";

  const name = gameDetails.winner_name ?? "Unknown";
  const civ = formatEnum(gameDetails.winner_civilization, 'NATION_');
  const victory = gameDetails.winner_victory_type
    ? ` - ${formatEnum(gameDetails.winner_victory_type, 'VICTORY_')}`
    : '';

  return `Winner: ${name} (${civ})${victory}`;
});
```

**Rationale:**
- Clear, concise, informative
- Handles NULL gracefully ("Game In Progress")
- Victory type optional (can add later when parsing Victory element)
- Follows existing formatEnum() pattern (DRY)

### 5. Victory Conditions Display: **Simple List with formatEnum()**

**Format:**
```typescript
const victoryConditions = gameDetails.victory_conditions
  ?.split('+')
  .map(v => formatEnum(v, 'VICTORY_'))
  .join(', ') ?? 'Unknown';
```

**Example Output:** "Score, Domination, Cultural"

**Rationale:**
- DRY - reuses existing `formatEnum()` utility
- Simple, readable, no new components needed

### 6. DLC Display: **Comma-Separated List**

**Format:**
```typescript
const dlcList = gameDetails.enabled_dlc?.split('+').join(', ') ?? 'None';
```

**Example Output:** "New Portraits, Nobles of the Settled Lands 1, Wonders and Dynasties"

**Rationale:**
- DRY - follows victory conditions pattern
- Simple implementation
- Can switch to bulleted list in future if too long in practice

---

## Implementation Steps

### Backend Changes (src-tauri/src/lib.rs)

**1. Update `GameDetails` Struct** (around line 58-70)

Add five fields:
```rust
pub struct GameDetails {
    #[ts(type = "number")]
    pub match_id: i64,
    pub game_name: Option<String>,
    pub save_date: Option<String>,
    pub total_turns: i32,
    pub map_size: Option<String>,
    pub map_width: Option<i32>,
    pub map_height: Option<i32>,
    pub game_mode: Option<String>,
    pub opponent_level: Option<String>,
    pub victory_conditions: Option<String>,  // ADD THIS
    pub enabled_dlc: Option<String>,          // ADD THIS
    #[ts(type = "number | null")]
    pub winner_player_id: Option<i64>,       // ADD THIS
    pub winner_name: Option<String>,          // ADD THIS
    pub winner_civilization: Option<String>,  // ADD THIS
    pub winner_victory_type: Option<String>,  // ADD THIS (for future use)
    pub players: Vec<PlayerInfo>,
}
```

**2. Update `get_game_details()` Query** (around line 290-302)

Modify SQL SELECT to LEFT JOIN players table for winner info:
```rust
let mut stmt = conn.prepare(
    "SELECT m.match_id, m.game_name, CAST(m.save_date AS VARCHAR) as save_date,
            m.total_turns, m.map_size, m.map_width, m.map_height,
            m.game_mode, m.opponent_level, m.victory_conditions, m.enabled_dlc,
            m.winner_player_id,
            wp.player_name as winner_name,
            wp.nation as winner_civilization
     FROM matches m
     LEFT JOIN players wp ON m.match_id = wp.match_id AND m.winner_player_id = wp.player_id
     WHERE m.match_id = ?"
)?;
```

Update query_row mapping:
```rust
let game_details = stmt.query_row([match_id], |row| {
    Ok(GameDetails {
        match_id: row.get(0)?,
        game_name: row.get(1)?,
        save_date: row.get(2)?,
        total_turns: row.get(3)?,
        map_size: row.get(4)?,
        map_width: row.get(5)?,
        map_height: row.get(6)?,
        game_mode: row.get(7)?,
        opponent_level: row.get(8)?,
        victory_conditions: row.get(9)?,   // ADD THIS
        enabled_dlc: row.get(10)?,         // ADD THIS
        winner_player_id: row.get(11)?,   // ADD THIS
        winner_name: row.get(12)?,        // ADD THIS
        winner_civilization: row.get(13)?, // ADD THIS
        winner_victory_type: None,         // ADD THIS (future enhancement)
        players: vec![], // populated later
    })
})?;
```

**3. Regenerate TypeScript Types**

Run: `cargo test --lib export_bindings`

TypeScript types will auto-update via `ts-rs` in `src/lib/types/GameDetails.ts`.

---

### Frontend Changes (src/routes/game/[id]/+page.svelte)

**1. Add Helper Functions** (after line 40)

```typescript
// Format winner display
const winnerDisplay = $derived(() => {
  if (!gameDetails?.winner_player_id) return "Game In Progress";

  const name = gameDetails.winner_name ?? "Unknown";
  const civ = formatEnum(gameDetails.winner_civilization, 'NATION_');
  const victory = gameDetails.winner_victory_type
    ? ` - ${formatEnum(gameDetails.winner_victory_type, 'VICTORY_')}`
    : '';

  return `Winner: ${name} (${civ})${victory}`;
});

// Get winner civilization color
const winnerColor = $derived(() => {
  if (!gameDetails?.winner_civilization) return undefined;
  return getCivilizationColor(gameDetails.winner_civilization);
});

// Format victory conditions from DB string
const victoryConditions = $derived(
  gameDetails?.victory_conditions
    ?.split('+')
    .map(v => formatEnum(v, 'VICTORY_'))
    .join(', ') ?? 'Unknown'
);

// Format DLC list from DB string
const dlcList = $derived(
  gameDetails?.enabled_dlc
    ?.split('+')
    .join(', ') ?? 'None'
);
```

**2. Add Winner to Summary Bar** (around line 254-270)

Add winner display after the game name/info line:
```svelte
<!-- Existing summary bar content -->
<div class="flex justify-between items-center mb-6">
  <h1 class="text-3xl font-bold text-brown">
    {gameDetails.game_name ?? 'Loading...'}
  </h1>
  <span class="text-brown text-lg">
    Turn {gameDetails.total_turns}
  </span>
</div>

<!-- ADD WINNER DISPLAY HERE -->
{#if gameDetails}
  <div class="mb-4 p-3 bg-tan/30 border border-brown rounded">
    <span
      class="text-lg font-semibold"
      style:color={winnerColor}
    >
      {winnerDisplay}
    </span>
  </div>
{/if}
```

**3. Add to Settings Tab Grid** (around line 398-423)

Add after the difficulty field:
```svelte
{#if gameDetails.victory_conditions}
  <div class="flex flex-col gap-1">
    <span class="font-bold text-brown text-sm">Victory Conditions:</span>
    <span class="text-black text-base">{victoryConditions}</span>
  </div>
{/if}

{#if gameDetails.enabled_dlc}
  <div class="flex flex-col gap-1">
    <span class="font-bold text-brown text-sm">DLC Enabled:</span>
    <span class="text-black text-base">{dlcList}</span>
  </div>
{/if}
```

---

## Testing Checklist

### Backend
- [ ] Backend compiles without errors
- [ ] TypeScript types regenerated and match Rust struct
- [ ] LEFT JOIN returns NULL for in-progress games (no winner)
- [ ] LEFT JOIN returns winner_name and winner_civilization for completed games
- [ ] Test with both completed and in-progress game saves

### Frontend
- [ ] Winner displays in summary bar with correct formatting
- [ ] Winner shows "Game In Progress" when NULL
- [ ] Winner text colored with civilization color
- [ ] Victory conditions display correctly in Settings tab (formatted enum values)
- [ ] DLC list displays correctly in Settings tab (comma-separated)
- [ ] Fields show appropriate fallbacks when data is null

### Integration
- [ ] Settings tab grid layout doesn't break with new fields
- [ ] Summary bar layout doesn't break with winner display
- [ ] Existing functionality (charts, players table) unaffected
- [ ] No console errors or warnings

---

## Future Enhancements (Not in Scope)

### Phase 2: Victory Type Extraction

**Goal:** Display specific victory type (e.g., "Victory Points", "Domination") in winner display.

**Implementation:**
- Parse `Victory` attribute from `TeamVictories/Team` element
- Store in `matches.winner_victory_type`
- Already added to `GameDetails` struct (currently NULL)

**Example XML:**
```xml
<TeamVictories>
  <Team Victory="VICTORY_POINTS">0</Team>
</TeamVictories>
```

**SQL Update:**
```sql
UPDATE matches
SET winner_victory_type = ?
WHERE match_id = ?
```

**Requires:** Minimal changes to `insert_match_metadata()` in import.rs

### Phase 3: UI Enhancements (If Needed)

- Badge/pill UI for victory conditions (if list wrapping is ugly)
- Bulleted list for DLC (if comma-separated is too long)
- Tooltip truncation for long DLC lists

---

## Files to Modify

### Backend
- `src-tauri/src/lib.rs` - GameDetails struct, get_game_details() query

### Frontend
- `src/routes/game/[id]/+page.svelte` - Add helpers and display fields
- `src/lib/types/GameDetails.ts` - Auto-generated, no manual edits

### Documentation
- `docs/statistics-and-visualizations-report.md` - Update 1.1 status to ✅ when complete

---

## Estimated Effort

**Backend:** 20 minutes
- Add 5 fields to struct (3 for winner, 2 for victory/DLC)
- Update SQL query with LEFT JOIN
- Regenerate types

**Frontend:** 25 minutes
- Add 4 derived helpers (winner display, color, victory conditions, DLC)
- Add winner to summary bar (new location)
- Add 2 grid items to Settings tab

**Testing:** 20 minutes
- Test with completed and in-progress games
- Verify NULL handling
- Check layout/styling

**Total:** ~65 minutes

---

## Success Criteria

### Functional Requirements
- ✅ Winner displays in summary bar with correct name and civilization
- ✅ Winner shows "Game In Progress" for NULL winner_player_id
- ✅ Winner text colored with civilization color
- ✅ Victory conditions display correctly in Settings tab (formatted enum values)
- ✅ DLC list displays correctly in Settings tab (comma-separated)

### Code Quality
- Data formatting follows existing patterns (DRY - uses formatEnum, getCivilizationColor)
- No new dependencies or complex UI components (YAGNI)
- TypeScript types match Rust structs (type safety via ts-rs)
- Null handling uses `??` operator (per CLAUDE.md standards)

### Non-Functional Requirements
- Existing features continue working (no regressions)
- LEFT JOIN adds minimal query overhead (<1ms)
- UI layout responsive and doesn't break on long strings

---

**Document Version:** 2.0
**Created:** 2025-11-15
**Updated:** 2025-11-15
**Status:** Ready for Implementation

---

## Architecture Review Summary

**Reviewed By:** Tech Lead (User)
**Review Date:** 2025-11-15

**Architectural Decisions Approved:**
1. ✅ Display Location: Winner in summary bar, victory conditions/DLC in Settings tab
2. ✅ Query Strategy: Extend get_game_details() with LEFT JOIN (DRY, single query)
3. ✅ Display Format: Name + Civilization + Victory Type
4. ✅ NULL Handling: Show "Game In Progress" for in-progress games

**Backend Implementation:**
- Winner extraction from XML: ✅ Complete (2025-11-15)
- Database storage: ✅ Complete (`matches.winner_player_id`)
- Integration test: ✅ Passing (`winner_extraction_test.rs`)

**Frontend Implementation:**
- 📋 Pending (this task)
