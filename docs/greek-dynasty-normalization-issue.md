# Greek Dynasty Normalization Issue

## Problem Statement

Greek successor dynasties (Diadochi) are appearing as separate nations in the "Games by Nation" chart instead of being properly grouped under their parent civilizations.

### Expected Behavior

- **NATION_SELEUCUS** → should display as **NATION_GREECE** (with DYNASTY_SELEUCID)
- **NATION_ANTIGONUS** → should display as **NATION_GREECE** (with DYNASTY_ANTIGONID)
- **NATION_PTOLEMY** → should display as **NATION_GREECE** (with DYNASTY_PTOLEMY)

**Note**: All three Diadochi are Macedonian/Greek. The Ptolemies ruled Egypt but were ethnically Greek.

### Current Behavior

These appear as three separate nations in charts and statistics, fragmenting the data for Greece.

### Root Cause

Old World's save files encode Greek successor states as distinct nation values rather than storing them as Greece/Egypt with different dynasty values. This is a data representation choice in the game files themselves.

**IMPORTANT - Save File Format May Have Changed Over Time:**

There is strong reason to suspect that Old World changed how they encode dynasties between game versions:

- **Initial Release (~2020)**: Greece-only dynasties (Seleucid, Ptolemy, Antigonus) may have been encoded as separate nations: `NATION_SELEUCUS`, `NATION_ANTIGONUS`, `NATION_PTOLEMY`
- **Later Update (~2021+)**: Dynasty system expanded to other nations. Save format may have changed to properly encode these as `NATION_GREECE` + `DYNASTY_SELEUCID`, etc.

**This would explain the parse-time normalization failure**: If we applied normalization to ALL saves, we would have been "double-normalizing" newer saves that were already in the correct format. This could cause:
- Data collisions (multiple "NATION_GREECE" entries where the game expected distinct values)
- Query mismatches (statistics counting wrong)
- Missing games in the UI

**Critical Investigation Step**: Before implementing any fix, examine save files from different time periods to determine:
1. Do older saves (2020-2021) encode Greek dynasties as separate nations?
2. Do newer saves (2022+) properly encode them as NATION_GREECE + dynasty?
3. Is there a specific game version where the format changed?
4. Are there any save file version indicators we can use to detect which format is in use?

This investigation will determine whether we need:
- **Conditional normalization** (only for old saves) based on save file version/date
- **Uniform normalization** (if all saves use the old format)
- **No normalization** (if all saves already use the correct format)

## Failed Solution: Parse-Time Normalization

### Approach

We attempted to normalize these values during XML parsing in `src-tauri/src/parser/entities/players.rs`.

### Implementation

```rust
/// Normalize Diadochi (Greek successor) dynasties encoded as nations
///
/// Old World encodes certain Greek/Egyptian dynasties as separate nations:
/// - NATION_ANTIGONUS → NATION_GREECE + DYNASTY_ANTIGONID
/// - NATION_SELEUCUS → NATION_GREECE + DYNASTY_SELEUCID
/// - NATION_PTOLEMY → NATION_EGYPT + DYNASTY_PTOLEMY
fn normalize_nation_dynasty(
    nation: Option<String>,
    dynasty: Option<String>
) -> (Option<String>, Option<String>) {
    match nation.as_deref() {
        Some("NATION_ANTIGONUS") => (
            Some("NATION_GREECE".to_string()),
            Some("DYNASTY_ANTIGONID".to_string())
        ),
        Some("NATION_SELEUCUS") => (
            Some("NATION_GREECE".to_string()),
            Some("DYNASTY_SELEUCID".to_string())
        ),
        Some("NATION_PTOLEMY") => (
            Some("NATION_GREECE".to_string()),  // Ptolemies were Greek!
            Some("DYNASTY_PTOLEMY".to_string())
        ),
        _ => (nation, dynasty)
    }
}

// Applied in parse loop:
let raw_nation = player_node.opt_attr("Nation").map(|s| s.to_string());
let raw_dynasty = player_node.opt_attr("Dynasty").map(|s| s.to_string());
let (nation, dynasty) = normalize_nation_dynasty(raw_nation, raw_dynasty);
```

### Results

**Data Corruption Observed:**
- Logs showed 2 saves imported successfully
- UI displayed only 1 game in the games list
- Statistics showed "Games Played: 1" while chart displayed 3 nations
- Clear data inconsistency/corruption

### Why It Failed (Theories)

#### Theory 1: Deduplication Key Collision
The parser uses `deduplicate_rows_last_wins` with `(player_id, match_id)` as the primary key:

```rust
let unique_players = deduplicate_rows_last_wins(
    players,
    |(player_id, match_id, ..)| (*player_id, *match_id)
);
```

**Hypothesis**: If multiple players in the same game had nations that normalized to the same value, and if player IDs are somehow derived from nation values, we could get ID collisions causing legitimate players to be deduplicated away.

**Counter-evidence**: Player IDs come from XML ID mapping (`id_mapper.map_player(xml_id)`), which should be independent of nation values.

#### Theory 2: Database Constraint Violation
**Hypothesis**: There might be a unique constraint or foreign key relationship that was violated by the normalized values.

**Counter-evidence**: No database errors were logged during import.

#### Theory 3: Query-Level Issues
The statistics query groups by nation:

```rust
SELECT nation, COUNT(DISTINCT match_id) as games_played
FROM players
WHERE nation IS NOT NULL
GROUP BY nation
ORDER BY games_played DESC
```

**Hypothesis**: Normalization caused this query to behave unexpectedly.

**Counter-evidence**: This query should work fine with normalized values - grouping SELEUCUS and ANTIGONUS under GREECE should just combine their counts.

#### Theory 4: Match-Level Data Corruption
**Hypothesis**: The normalization affected match-level records in unexpected ways, perhaps through foreign key relationships or cascading effects.

**Investigation needed**: Check if other entities (cities, units, etc.) reference player data in ways that could be affected by nation normalization.

## Relevant Code Locations

### Parser
- **File**: `src-tauri/src/parser/entities/players.rs`
- **Lines**: 22-24 (nation/dynasty reading)
- **Lines**: 95-122 (player row assembly)
- **Lines**: 127-130 (deduplication)

### Statistics Query
- **File**: `src-tauri/src/lib.rs`
- **Lines**: 200-210 (get_game_statistics command)

### Database Schema
- **File**: `docs/schema.sql`
- **Lines**: 132-133 (nation/dynasty columns)

### Frontend Chart
- **File**: `src/routes/+page.svelte`
- **Lines**: 15-56 (chart configuration)

## Alternative Approaches

### Option 1: Query-Time Normalization

Instead of normalizing during parsing, normalize in the SQL query:

```rust
SELECT
    CASE
        WHEN nation = 'NATION_ANTIGONUS' THEN 'NATION_GREECE'
        WHEN nation = 'NATION_SELEUCUS' THEN 'NATION_GREECE'
        WHEN nation = 'NATION_PTOLEMY' THEN 'NATION_EGYPT'
        ELSE nation
    END as normalized_nation,
    COUNT(DISTINCT match_id) as games_played
FROM players
WHERE nation IS NOT NULL
GROUP BY normalized_nation
ORDER BY games_played DESC
```

**Pros:**
- Preserves original data in database
- No risk of data corruption during import
- Easy to modify/extend mapping rules
- Can be applied to existing data without migration

**Cons:**
- Normalization logic duplicated across queries
- Slight performance overhead (minimal for small datasets)
- Dynasty information lost in aggregation (though we could track it separately)

### Option 2: Database View

Create a database view with normalized values:

```sql
CREATE VIEW players_normalized AS
SELECT
    player_id,
    match_id,
    CASE
        WHEN nation = 'NATION_ANTIGONUS' THEN 'NATION_GREECE'
        WHEN nation = 'NATION_SELEUCUS' THEN 'NATION_GREECE'
        WHEN nation = 'NATION_PTOLEMY' THEN 'NATION_EGYPT'
        ELSE nation
    END as nation,
    CASE
        WHEN nation = 'NATION_ANTIGONUS' THEN 'DYNASTY_ANTIGONID'
        WHEN nation = 'NATION_SELEUCUS' THEN 'DYNASTY_SELEUCID'
        WHEN nation = 'NATION_PTOLEMY' THEN 'DYNASTY_PTOLEMY'
        ELSE dynasty
    END as dynasty,
    ... other columns ...
FROM players;
```

**Pros:**
- Centralized normalization logic
- Preserves original data
- Clean separation of concerns

**Cons:**
- Adds complexity to schema management
- Need to update schema migrations

### Option 3: Debug and Fix Parse-Time Normalization

Systematically debug the original approach:

1. **Add detailed logging** around deduplication to see if rows are being incorrectly merged
2. **Check ID generation** to ensure player IDs aren't affected by nation values
3. **Verify match insertion** to ensure match records aren't being corrupted
4. **Check foreign key relationships** between players and other entities
5. **Add unit tests** for the normalization function with realistic data

**Pros:**
- Most "correct" solution (clean data at source)
- No query overhead
- Dynasty values properly stored

**Cons:**
- Requires investigation time
- Risk of similar issues if not fully understood

### Option 4: Frontend-Only Normalization

Normalize display values in the frontend without touching data:

```typescript
function normalizeNation(nation: string): string {
    switch (nation) {
        case 'NATION_ANTIGONUS':
        case 'NATION_SELEUCUS':
            return 'NATION_GREECE';
        case 'NATION_PTOLEMY':
            return 'NATION_EGYPT';
        default:
            return nation;
    }
}

// In chart data preparation
const normalizedData = stats.nations.reduce((acc, n) => {
    const normalized = normalizeNation(n.nation);
    const existing = acc.find(item => item.nation === normalized);
    if (existing) {
        existing.games_played += n.games_played;
    } else {
        acc.push({ nation: normalized, games_played: n.games_played });
    }
    return acc;
}, []);
```

**Pros:**
- No backend changes required
- No risk to data integrity
- Easy to implement and test

**Cons:**
- Doesn't solve the problem for backend queries/reports
- Logic must be duplicated across frontend components
- Dynasty information tracking becomes complex

## Recommended Next Steps

1. **Start with Option 1 (Query-Time Normalization)** as a quick, safe fix
2. **Add comprehensive logging** to the parser to understand the data flow
3. **Write unit tests** for both parser normalization and query normalization
4. **Investigate** the root cause of the parse-time failure with proper debugging
5. **Consider Option 2 (Database View)** if query-time normalization proves cumbersome

## Testing Strategy

Any solution should be tested with:

1. **Empty database** → import saves with Greek dynasties → verify counts
2. **Existing data** → import additional saves → verify no corruption
3. **Mixed data** → saves with both regular nations and Greek dynasties
4. **Edge cases** → saves with NULL nations, saves with only Greek dynasties

## Questions for Investigation

### Primary Question: Save File Format Evolution

**Before any other investigation, determine if save file format changed:**

1. Extract and examine the `Nation` and `Dynasty` attributes from Player nodes in saves from different time periods (2020, 2021, 2022, 2023, 2024)
2. Look for version indicators in save files (game version, save format version, etc.)
3. Document when/if the encoding changed from `NATION_SELEUCUS` to `NATION_GREECE` + `DYNASTY_SELEUCID`
4. Check Old World patch notes/changelogs for any mentions of dynasty system changes

**Suggested approach:**
```bash
# Extract Player nodes from various saves
unzip -p save_2020.zip game.xml | grep -A 5 '<Player.*Nation="NATION_'
unzip -p save_2024.zip game.xml | grep -A 5 '<Player.*Nation="NATION_'

# Compare nation values for Greek players across different save dates
```

### Secondary Questions (if parse-time normalization is still pursued)

5. Why did 2 successfully imported saves result in only 1 game appearing?
6. Is the issue in parsing, database insertion, or querying?
7. Are there foreign key relationships that could cascade the normalization effect?
8. How are match IDs generated and could they be affected by player data?
9. Could there be a race condition in the bulk insert process?

## Historical Context

- **Issue discovered**: 2025-11-09
- **First fix attempted**: Parse-time normalization in players.rs
- **Result**: Data corruption, reverted
- **Current state**: Issue unresolved, original data structure intact
