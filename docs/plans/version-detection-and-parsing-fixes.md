# Implementation Plan: Version Detection & Parsing Fixes

**Created:** 2025-11-06
**Status:** Draft
**Principles:** YAGNI, DRY
**Related:** [Parsing Issues Analysis](../parsing-issues-analysis.md)

## Overview

Two-phase plan to improve parsing coverage:

1. **Phase 1 (Quick Win):** Capture Root-level metadata including version
2. **Phase 2 (Incremental):** Fix parsing gaps based on data availability

## Phase 1: Root Metadata Capture (1-2 hours)

### Goal

Capture all available Root element attributes to populate the `matches` table. This gives us version detection AND fixes 27 empty columns in one go.

### Current State

- `insert_match_metadata()` only extracts 5 fields (game_id, game_name, file_name, file_hash, total_turns)
- Root element has ~40 attributes available but unused
- Schema ready, just need to parse and insert

### Implementation

**File:** `src-tauri/src/parser/import.rs:605-641`

**Changes:**

1. Parse all Root attributes using `root.opt_attr()` helper
2. Parse SaveDate to timestamp
3. Parse Version string to extract game version number
4. Insert all fields into matches table

**Attributes to Extract:**

```rust
// From Root element (all are attributes, not child elements)
- Version           -> parse to extract version number and DLC list
- SaveDate          -> parse to timestamp
- MapWidth          -> i32
- MinLatitude       -> i32
- MaxLatitude       -> i32
- MapEdgesSafe      -> bool
- MinCitySiteDistance -> i32
- MapClass          -> string
- MapSize           -> string
- GameName          -> string (already parsed from child, check attribute too)
- FirstSeed         -> i64
- MapSeed           -> i64
- GameMode          -> string
- TurnStyle         -> string
- TurnTimer         -> string
- OpponentLevel     -> string
- TribeLevel        -> string
- Development       -> string
- Advantage         -> string
- SuccessionGender  -> string
- SuccessionOrder   -> string
- Mortality         -> string
- TurnScale         -> string
- TeamNation        -> string
- ForceMarch        -> string
- EventLevel        -> string
- VictoryPointModifier -> string
```

**Version Parsing Helper:**

```rust
/// Parse version string: "Version: 1.0.70671+DLC1+DLC2=-123456"
/// Returns (version_number, dlc_list_string)
fn parse_version_string(version: &str) -> (Option<String>, Option<String>) {
    let parts: Vec<&str> = version.split('+').collect();
    if parts.is_empty() {
        return (None, None);
    }

    // First part is "Version: 1.0.70671"
    let version_num = parts[0]
        .strip_prefix("Version: ")
        .map(|v| v.to_string());

    // Remaining parts are DLCs (join back, exclude checksum at end)
    let dlcs = if parts.len() > 1 {
        let dlc_parts: Vec<&str> = parts[1..]
            .iter()
            .map(|s| s.split('=').next().unwrap_or(s))
            .collect();
        Some(dlc_parts.join("+"))
    } else {
        None
    };

    (version_num, dlcs)
}
```

**SQL Update:**

```sql
INSERT INTO matches (
    match_id, file_name, file_hash, game_id, game_name, save_date,
    total_turns, processed_date,
    -- Map config
    map_width, map_height, map_size, map_class, map_aspect_ratio,
    min_latitude, max_latitude,
    -- Game settings
    game_mode, turn_style, turn_timer, turn_scale, simultaneous_turns,
    -- Difficulty
    opponent_level, tribe_level, development, advantage,
    -- Rules
    succession_gender, succession_order, mortality, event_level,
    victory_point_modifier, force_march, team_nation,
    -- Seeds
    first_seed, map_seed,
    -- Version (add to schema if not exists)
    game_version, enabled_dlc
) VALUES (?, ?, ..., ?, ?)
```

**Schema Changes (if needed):**
Add to `docs/schema.sql` if not present:

```sql
ALTER TABLE matches ADD COLUMN game_version VARCHAR;
ALTER TABLE matches ADD COLUMN enabled_dlc TEXT; -- Full DLC list
```

### Testing

1. Run import on test save
2. Query matches table - verify all 27 previously-empty columns now populated
3. Check game_version = "1.0.70671"
4. Verify SaveDate parsed correctly

### Success Criteria

- ✅ matches table goes from 17/44 columns to 44/44 columns populated
- ✅ Can query by game version for future conditional logic
- ✅ All test saves import successfully

### Notes

- YAGNI: Don't create version comparison logic yet - just store the version string
- DRY: Use opt_attr() helper for all optional fields
- Keep version parsing simple - regex overkill at this stage

---

## Phase 2: Targeted Parsing Fixes (Incremental)

### Strategy

Fix parsing gaps incrementally, starting with **highest value per effort**:

1. Complete existing partial parsers (low-hanging fruit)
2. Add missing parsers for high-value features
3. Skip low-value features unless requested

### 2.1: Complete Character Attributes (30 mins)

**Problem:** 8 empty columns in `characters` table (wisdom, charisma, courage, discipline, etc.)

**Investigation First:**

```bash
# Check if attributes exist in XML
unzip -p test-data/saves/*.zip | grep -A 5 '<Character' | head -100
```

**If attributes exist in XML:**

- Update `parse_characters_core()` to extract them
- Map XML attribute names to DB columns

**If attributes don't exist:**

- Document in schema comments: "Not available in save format"
- Consider removing columns (schema cleanup)

### 2.2: Units Parser (High Value, 2-4 hours)

**Why:** Military analysis is core gameplay feature

**Investigation:**

```bash
# Look for Unit elements in XML
unzip -p test-data/saves/*.zip | grep -A 10 '<Unit' | head -200
```

**Implementation (if data exists):**

1. Create `src/parser/entities/units.rs`
2. Parse Unit elements into:
   - `units` table (unit instances)
   - `unit_types` table (unique unit types seen)
   - `unit_promotions` table (promotions per unit)
3. Add to import.rs orchestration
4. Test with verification query

**If no Unit elements in XML:**

- Document: "Units not exported in single-player saves"
- Consider marking tables as "multiplayer-only" in schema
- Deprioritize

### 2.3: Religion Parser (Medium Value, 1-2 hours)

**Note from code:** Comment in import.rs says religions referenced by name but not defined separately

**Investigation:**

```bash
# Check for religion references
unzip -p test-data/saves/*.zip | grep -i religion | head -50
```

**Approaches:**

1. **If Religion elements exist:** Parse them directly
2. **If only references exist:** Extract unique religion names from context (cities, characters, events)
3. **If minimal data:** Populate `religions` table with referenced names only (ID, name, match_id)

**Implementation priority:** Medium - only if straightforward

### 2.4: Character Relationships (Medium Value, 1-2 hours)

**Investigate:**

```bash
unzip -p test-data/saves/*.zip | grep -A 5 'Relationship\|Marriage' | head -100
```

**From logs:** The import log shows:

```
Parsed character extended data: ... 0 relationships
```

**Possible reasons:**

1. Parser exists but finds no data (test save has no relationships)
2. Parser exists but has bugs
3. No parser implemented

**Action:**

1. Check `src/parser/entities/character_data.rs` for relationship parsing
2. If parser exists: debug why it returns 0
3. If no parser: implement based on XML structure
4. If XML has no data: get different test save with marriages/relationships

### 2.5: Tile & Diplomacy Optional Fields (Low Value, 1 hour)

**Tiles:** 4 empty columns (improvement_turns_left, owner_player_id, owner_city_id, religion)
**Diplomacy:** 4 empty columns (war_score, last_conflict_turn, etc.)

**These are likely conditional fields:**

- improvement_turns_left: only when improvement in progress
- war_score: only when at war
- owner_player_id: only for owned tiles (many tiles unowned)

**Action:**

- Verify parser checks for attribute existence
- If missing: add opt_attr() checks
- Document as conditional fields in schema

---

## Phase 3: Skip / Defer (YAGNI)

### Low Priority - Skip Unless Requested

**Empty tables to skip:**

- `event_logs` / `event_outcomes` - questionable value for analytics
- `story_choices` - already have story_events
- `tile_visibility` - fog of war, minimal value
- `city_yields` - aggregate yield data available elsewhere
- `city_culture` - may not be in XML
- `match_settings` - covered by Root attributes now
- `match_locks` - internal concurrency control only
- `military_composition` - derived data, units table sufficient
- `rulers` - ruler tracking may be in character data
- `family_law_opinions` - niche feature

**Action:**

- Mark these tables as "deferred" in schema comments
- Only implement if user requests feature that needs them

---

## Implementation Order

### Week 1: Metadata & Quick Wins

1. **Day 1 Morning:** Phase 1 - Root metadata capture
2. **Day 1 Afternoon:** Phase 2.1 - Character attributes (if in XML)
3. **Day 2:** Phase 2.5 - Complete conditional field parsing

### Week 2: High-Value Features

4. **Day 3-4:** Phase 2.2 - Units parser (if data exists)
5. **Day 5:** Phase 2.3 - Religion parser (if straightforward)

### Week 3: Relationships & Testing

6. **Day 6-7:** Phase 2.4 - Character relationships
7. **Day 8:** Integration testing, update database analysis report
8. **Day 9:** Documentation and schema cleanup

---

## Investigation Protocol (DRY)

For each missing parser, follow this pattern:

### Step 1: Check XML Structure

```bash
unzip -p test-data/saves/*.zip | grep -A 10 '<ElementName' | head -100
```

### Step 2: Assess Complexity

- **Simple (< 10 attributes):** Implement immediately
- **Medium (10-30 attributes):** Implement if high value
- **Complex (> 30 attributes, nested):** Break into phases

### Step 3: Check Existing Parser

```bash
# Look for existing parser file
find src/parser/entities -name "*element*.rs"
# Search for parsing function
rg "parse.*element" src/parser/
```

### Step 4: Decision Matrix

| Data Exists | High Value | Implement?                          |
| ----------- | ---------- | ----------------------------------- |
| Yes         | Yes        | ✅ Now                              |
| Yes         | No         | ⏸️ Defer                            |
| No          | Yes        | 📝 Document + seek alternative save |
| No          | No         | ❌ Skip                             |

---

## Success Metrics

### Phase 1 Complete:

- ✅ matches table: 44/44 columns populated (up from 17/44)
- ✅ game_version field available for conditional logic
- ✅ All game settings captured for filtering

### Phase 2 Complete:

- ✅ 3-5 new entity parsers implemented
- ✅ Table coverage: 40+/54 tables (75%+)
- ✅ All high-value gameplay systems parsed

### Overall Goals:

- ✅ No unknown parsing gaps (all documented)
- ✅ Clear schema comments for unparsed fields
- ✅ Version detection enables future conditional parsing
- ✅ Incremental value delivered, not big-bang rewrite

---

## Anti-Patterns to Avoid

### ❌ Don't Do This:

1. **Don't** implement all 19 empty tables at once
2. **Don't** create complex version comparison logic before needed
3. **Don't** parse data "just in case" - wait for use case
4. **Don't** spend time on perfect XML structure before checking if data exists
5. **Don't** add new database tables without confirming XML has the data

### ✅ Do This Instead:

1. **Do** implement parsers incrementally, testing each
2. **Do** store version string simply, enhance later if needed
3. **Do** parse when there's a feature that needs it
4. **Do** check XML structure first, then implement
5. **Do** reuse existing schema, populate what we can

---

## Dependencies

- None! All work is additive
- No breaking changes to existing parsers
- Database schema already supports all fields

## Risks

| Risk                              | Mitigation                                           |
| --------------------------------- | ---------------------------------------------------- |
| XML structure varies by version   | Version detection helps handle this                  |
| Test save missing data            | Get additional test saves from different game states |
| Parsing complexity underestimated | Time-box investigations, defer if too complex        |
| Breaking existing parsers         | Comprehensive integration tests                      |

## Questions to Answer During Implementation

1. **Character attributes:** Are they in XML? If not, are they computed?
2. **Units:** Single-player exports units? Or multiplayer only?
3. **Religions:** Definitions in XML or just references?
4. **Relationships:** Bug in parser or missing data in test save?
5. **Conditional fields:** Current parsers check existence or assume present?

---

## Next Steps

1. ✅ Review this plan
2. ⬜ Start with Phase 1 (Root metadata)
3. ⬜ Update database analysis after Phase 1
4. ⬜ Begin Phase 2 investigations
5. ⬜ Adjust priorities based on XML findings

## Appendix: Quick Reference

### Files to Modify

**Phase 1:**

- `src/parser/import.rs` - insert_match_metadata()
- `docs/schema.sql` - Add game_version, enabled_dlc if missing

**Phase 2.1:**

- `src/parser/entities/characters.rs` - parse_characters_core()

**Phase 2.2:**

- `src/parser/entities/units.rs` - NEW FILE
- `src/parser/entities/mod.rs` - Export new parser
- `src/parser/import.rs` - Call new parser

**Phase 2.3:**

- `src/parser/entities/religions.rs` - ALREADY EXISTS, check implementation
- `src/parser/import.rs` - Uncomment religion parsing

**Phase 2.4:**

- `src/parser/entities/character_data.rs` - Debug relationship parsing

### Test Commands

```bash
# Run import
cd src-tauri
cargo run --example import_save -- ../test-data/saves/OW-Babylonia-Year123-2024-01-31-22-44-04.zip

# Check results
sqlite3 per-ankh.db "SELECT game_version, map_size, game_mode FROM matches"
sqlite3 per-ankh.db "SELECT COUNT(*) FROM units"

# Inspect XML
unzip -p ../test-data/saves/*.zip | head -100
```
