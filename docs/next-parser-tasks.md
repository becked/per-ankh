# Next Parser Implementation Tasks

**Last Updated:** November 6, 2025
**Based On:** schema-save-format-alignment-analysis.md

This document outlines remaining parser implementation work, prioritized by value and effort.

---

## ⚠️ Important: Multi-Match Support

**All entity tables now use composite PRIMARY KEYs `(id, match_id)`** to support importing multiple game saves into the same database without conflicts.

**Design Principles:**

- Entity IDs are `INTEGER` (not `BIGINT`) and scoped per match
- Each match maintains independent ID sequences (1, 2, 3, ...)
- All UPDATE/DELETE queries must include `match_id` in WHERE clauses
- Foreign keys must reference both `entity_id` AND `match_id`

If you create new tables, follow this pattern. See `docs/schema-fix-composite-primary-keys.md` for details.

---

## 🎯 Quick Wins (High Value, Low Effort)

### 1. LogData Events Parser

**Priority:** High
**Effort:** Low
**Impact:** Adds rich event narrative data

**Status:**

- ✅ XML data exists and verified: `/Root/Player/PermanentLogList/LogData`
- ✅ Schema table exists: `event_logs` with composite PK `(log_id, match_id)` (currently empty)
- ❌ Parser not implemented

**XML Structure:**

```xml
<Player ID="0">
  <PermanentLogList>
    <LogData>
      <Text>Discovered &lt;color=#e3c08c&gt;Ironworking&lt;/color&gt;</Text>
      <Type>TECH_DISCOVERED</Type>
      <Data1>TECH_IRONWORKING</Data1>
      <Data2>None</Data2>
      <Data3>None</Data3>
      <Turn>1</Turn>
      <TeamTurn>0</TeamTurn>
    </LogData>
  </PermanentLogList>
</Player>
```

**Implementation:**

- Location: `src-tauri/src/parser/entities/events.rs` (or new file)
- Function: `parse_player_log_events()`
- Pattern: Similar to `parse_player_events()` which already exists
- Call from: `parse_player_gameplay_data()` in `import.rs`

**Schema:**

```sql
CREATE TABLE event_logs (
    log_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    event_type VARCHAR NOT NULL,
    event_text TEXT,
    turn INTEGER NOT NULL,
    data1 VARCHAR,
    data2 VARCHAR,
    data3 VARCHAR,
    PRIMARY KEY (log_id, match_id)
);
```

---

### 2. Legitimacy History Parser

**Priority:** Medium
**Effort:** Low
**Impact:** Completes time-series suite

**Status:**

- ✅ XML data exists: `/Root/Player/LegitimacyHistory/*`
- ✅ Schema table exists: `legitimacy_history` (currently empty)
- ❌ Parser not implemented

**XML Structure:**

```xml
<Player ID="0">
  <LegitimacyHistory>
    <T.1>100</T.1>
    <T.5>95</T.5>
    <T.10>90</T.10>
  </LegitimacyHistory>
</Player>
```

**Implementation:**

- Location: `src-tauri/src/parser/entities/timeseries.rs`
- Function: `parse_legitimacy_history()`
- Pattern: Identical to `parse_military_power_history()`, `parse_points_history()`
- Call from: `parse_player_timeseries()` in `timeseries.rs`
- Already partially implemented in `parse_player_timeseries()` - just commented out

**Action:** Uncomment the legitimacy parsing code in `timeseries.rs:parse_player_timeseries()` and verify it works.

---

### 3. Character Marriages Parser

**Priority:** Medium
**Effort:** Low
**Impact:** Enables marriage tracking and dynastic analysis

**Status:**

- ✅ XML data exists: `/Root/Character/Spouses/ID`
- ✅ Schema table exists: `character_marriages` (currently empty)
- ❌ Parser not implemented

**XML Structure:**

```xml
<Character ID="4">
  <Spouses>
    <ID>19</ID>
  </Spouses>
</Character>
```

**Implementation:**

- Location: `src-tauri/src/parser/entities/character_data.rs`
- Function: `parse_character_marriages()`
- Call from: `parse_character_extended_data_all()` in `import.rs`
- Note: Extract spouse ID and infer marriage (married_turn = min(character.birth_turn, spouse.birth_turn) or leave NULL)

**Schema:**

```sql
CREATE TABLE character_marriages (
    character_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    spouse_id INTEGER NOT NULL,
    married_turn INTEGER,
    divorced_turn INTEGER,
    PRIMARY KEY (character_id, match_id, spouse_id)
);
```

**Gotcha:** Marriage should be recorded symmetrically (both directions) or use a canonical ordering (lower ID first).

---

## 🔍 Needs Investigation

### 4. MemoryData System

**Priority:** High (if data is valuable)
**Effort:** Low-Medium
**Impact:** AI diplomatic memory tracking

**Status:**

- ✅ XML data exists: `/Root/Player/MemoryList/MemoryData`
- ✅ Schema table exists: `memory_data` with composite PK `(memory_id, match_id)`
- ❌ Parser not implemented

**XML Structure:**

```xml
<Player ID="0">
  <MemoryList>
    <MemoryData>
      <Type>MEMORYPLAYER_ATTACKED_CITY</Type>
      <Player>1</Player>
      <Turn>34</Turn>
    </MemoryData>
    <MemoryData>
      <Type>MEMORYFAMILY_FOUNDED_CITY</Type>
      <Family>FAMILY_DIDONIAN</Family>
      <Turn>35</Turn>
    </MemoryData>
  </MemoryList>
</Player>
```

**Action Required:**

1. Investigate several save files to understand data structure variations
2. Implement parser following composite key pattern
3. Ensure IdMapper generates memory_id per match

**Schema Reference:**
See `memory_data` table in `docs/schema.sql` - already includes composite PK and proper foreign keys.

---

### 5. Tile Ownership

**Priority:** Medium
**Effort:** Low-Medium
**Impact:** Track territory control

**Status:**

- ✅ Schema has `owner_player_id`, `owner_tribe` columns in `tiles` table
- ❌ Columns are always empty (NULL)
- ❓ Unclear if XML contains ownership data or only tracks unowned tiles

**Action Required:**

1. **Investigate:** Check if Tile elements have `Owner`, `Player`, or similar attributes
2. **If exists:** Update `parse_tiles()` in `src-tauri/src/parser/entities/tiles.rs`
3. **If not exists:** Remove ownership columns from schema (YAGNI)

**Check these files:**

```bash
xmllint --xpath "//Tile[1]" save-file.xml
```

---

## 📋 Lower Priority

### 6. Event Outcomes

**Priority:** Low
**Effort:** Unknown
**Impact:** May not be available in XML

**Status:**

- ❓ May not exist in XML (outcomes might be implicit in LogData text)
- ✅ Schema table exists: `event_outcomes` with composite PK `(outcome_id, match_id)` (empty)

**Action Required:**

1. Search multiple save files for outcome-related elements
2. If not found, remove `event_outcomes` table from schema (YAGNI)

---

### 7. Diplomacy State Details

**Priority:** Low
**Effort:** Medium
**Impact:** Enhanced diplomatic analysis

**Status:**

- ✅ Basic diplomacy relations work (`parse_diplomacy()`)
- ⚠️ Missing detailed state info (treaty terms, modifiers, etc.)

**Action Required:**

1. Review `TeamDiplomacy` XML structure more deeply
2. Identify what additional data is available
3. Enhance `parse_diplomacy()` if valuable data exists

---

## 📖 Documentation Tasks

### 8. XML-to-Schema Mapping Document

**Priority:** Medium (developer experience)
**Effort:** Medium

Create `docs/xml-schema-mapping.md` with:

- Definitive XPath for each schema table
- Field-by-field mappings
- Status indicators (confirmed/partial/missing/static)

### 9. Corrected Save File Format Documentation

**Priority:** Low
**Effort:** Medium

The external `save-file-format.md` has known errors (claims Unit elements exist at root level).

Action: Create corrected version based on actual XML inspection.

---

## ✅ Recently Completed (For Reference)

These have been implemented:

1. ✅ **Composite Primary Keys** - All entity tables updated for multi-match support (Nov 6, 2025)
2. ✅ **Character Genealogy** - `parse_character_genealogy()` (Nov 6, 2025)
3. ✅ **City Yields** - `parse_city_yields()` (Nov 6, 2025)
4. ✅ **City Religions** - `parse_city_religions()` (Nov 6, 2025)
5. ✅ **City Culture Fix** - Corrected T. prefix parsing (Nov 6, 2025)
6. ✅ **Unit Tables Removed** - YAGNI cleanup (Nov 6, 2025)

---

## 🚀 Recommended Next Steps

For a new developer picking up this work:

1. **Start with:** LogData events parser (highest value, lowest effort)
2. **Then:** Legitimacy history (just uncomment existing code)
3. **Then:** Character marriages (straightforward extraction)
4. **Investigate:** MemoryData and Tile ownership
5. **Clean up:** Remove event_outcomes table if no data source found

---

## Testing Strategy

For each new parser:

1. **Unit test:** Add test in the parser module with sample XML
2. **Integration test:** Run full import and check row counts
3. **Validation:** Use `./per-ankh.sh db-analyze` to verify data populated
4. **Query test:** Write example queries in `src-tauri/examples/query_matches.rs`

---

## References

- Main analysis: `docs/schema-save-format-alignment-analysis.md`
- Database analysis: `docs/database-analysis-2025-11-06.md`
- Schema: `docs/schema.sql`
- Parser code: `src-tauri/src/parser/`
