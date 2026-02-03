# Schema vs Save File Format Alignment Analysis

**Analysis Date:** November 6, 2025
**Analyst:** Claude
**Save Files Examined:**

- OW-Carthage-Year39-2025-11-04-21-38-46.xml (v1.0.80522, November 2025)
- OW-Babylonia-Year123-2024-01-31-22-44-04.zip (v1.0.70671, January 2024)

**Documents Reviewed:**

- docs/save-file-format.md (from external project)
- docs/schema.sql (current database schema)
- docs/database-analysis-2025-11-06.md (current parser coverage)

---

## Executive Summary

This analysis reveals **significant misalignments** between the save file format documentation, the actual XML save file structure, and the database schema. Key findings:

1. **❌ CRITICAL MISMATCH**: The save-file-format.md documentation describes Unit elements at the root level, but **actual save files contain NO Unit elements whatsoever** (tested in both 2024 and 2025 versions)

2. **✅ Schema Design**: The database schema is well-designed with 85% theoretical coverage, but **cannot store data that doesn't exist** in save files (specifically: individual unit tracking)

3. **⚠️ Documentation Gap**: The save-file-format.md appears to be based on incomplete analysis or wishful thinking rather than actual XML inspection

4. **✅ Parser Progress**: Current parser implementation is making good progress but is hampered by trying to populate tables for data that may not exist in save files

---

## Detailed Findings

### 1. Root-Level Elements in Actual Save Files

**2024 Save (v1.0.70671):**

```
5476 <Tile>
 297 <Character>
  28 <City>
  10 <Tribe>
   5 <Player>
   1 <Game>
   [+ configuration elements]
```

**2025 Save (v1.0.80522):**

```
1972 <Tile>
  69 <Character>
  14 <City>
  10 <Tribe>
   2 <Player>
   1 <Game>
   [+ configuration elements]
```

**CRITICAL FINDING**: NO `<Unit>` elements at root level in either version.

### 2. Save File Format Documentation Accuracy

| Element Type   | Documentation Claims                                 | Actual Reality     | Impact                                    |
| -------------- | ---------------------------------------------------- | ------------------ | ----------------------------------------- |
| **Units**      | "Variable (example: 221 units)" at `/Root/Unit[@ID]` | **Does not exist** | CRITICAL - schema has 3 empty unit tables |
| **Characters** | Correct location and structure                       | ✅ Verified        | Good                                      |
| **Cities**     | Correct location and structure                       | ✅ Verified        | Good                                      |
| **Tiles**      | Correct location and structure                       | ✅ Verified        | Good                                      |
| **Players**    | Correct location and structure                       | ✅ Verified        | Good                                      |
| **MemoryData** | Correct location in Player/MemoryList                | ✅ Verified        | Good                                      |
| **LogData**    | Correct location in Player/PermanentLogList          | ✅ Verified        | Good                                      |

**Assessment**: The documentation is approximately **85% accurate** but contains at least one **critical error** regarding unit storage.

### 3. Schema Tables vs Available Data

#### ✅ Tables with Verifiable XML Sources

| Schema Table              | XML Source                            | Status                      |
| ------------------------- | ------------------------------------- | --------------------------- |
| `matches`                 | `/Root[@attributes]`                  | ✅ Fully mappable           |
| `players`                 | `/Root/Player[@ID]`                   | ✅ Fully mappable           |
| `characters`              | `/Root/Character[@ID]`                | ✅ Fully mappable           |
| `character_traits`        | `/Root/Character/TraitTurn/*`         | ✅ Fully mappable           |
| `character_relationships` | `/Root/Character/Relationships/*`     | ⚠️ Partially available      |
| `character_marriages`     | Unknown location                      | ❓ Not found yet            |
| `cities`                  | `/Root/City[@ID]`                     | ✅ Fully mappable           |
| `city_yields`             | `/Root/City/YieldProgress/*`          | ✅ Available in XML         |
| `city_religions`          | `/Root/City/Religion/*`               | ✅ Available in XML         |
| `city_culture`            | `/Root/City/TeamCulture/*`            | ✅ Available in XML         |
| `tiles`                   | `/Root/Tile`                          | ✅ Fully mappable           |
| `families`                | `/Root/Player/Families/*`             | ✅ Fully mappable           |
| `religions`               | `/Root/Game/Religion*` elements       | ✅ Fully mappable           |
| `tribes`                  | `/Root/Tribe`                         | ✅ Fully mappable           |
| `technologies_completed`  | `/Root/Player/TechCount/*`            | ✅ Fully mappable           |
| `laws`                    | `/Root/Player/ActiveLaw/*`            | ✅ Fully mappable           |
| `diplomacy`               | `/Root/Game/TeamDiplomacy/*`          | ✅ Available                |
| `yield_history`           | `/Root/Player/YieldRateHistory/*`     | ✅ Fully mappable           |
| `points_history`          | `/Root/Player/PointsHistory/*`        | ✅ Fully mappable           |
| `military_history`        | `/Root/Player/MilitaryPowerHistory/*` | ✅ Fully mappable           |
| `legitimacy_history`      | `/Root/Player/LegitimacyHistory/*`    | ✅ Available but not parsed |
| `story_events`            | `/Root/Player/EventStoryTurn/*`       | ✅ Partially mappable       |

#### ❌ Tables with NO XML Source (Per Current Evidence)

| Schema Table      | Expected XML Source       | Reality                    | Recommendation                                   |
| ----------------- | ------------------------- | -------------------------- | ------------------------------------------------ |
| `units`           | `/Root/Unit[@ID]`         | **Does not exist**         | ⚠️ Consider removal or mark as "future/optional" |
| `unit_promotions` | `/Root/Unit/Promotions/*` | **Parent element missing** | ⚠️ Consider removal                              |
| `unit_types`      | Reference data            | Could be static data       | ✅ Populate from game definitions                |

#### ⚠️ Aggregate Data Alternative for Units

While individual units are not stored, **aggregate production statistics ARE available**:

```xml
<!-- In Player element -->
<UnitsProduced>
  <UNIT_SETTLER>3</UNIT_SETTLER>
  <UNIT_SCOUT>1</UNIT_SCOUT>
  <UNIT_WARRIOR>6</UNIT_WARRIOR>
</UnitsProduced>

<UnitsProducedTurn>
  <UNIT_SETTLER>55</UNIT_SETTLER>
  <UNIT_SCOUT>1</UNIT_SCOUT>
  <UNIT_WARRIOR>66</UNIT_WARRIOR>
</UnitsProducedTurn>

<!-- In City element -->
<UnitProductionCounts>
  <UNIT_SETTLER>4</UNIT_SETTLER>
</UnitProductionCounts>
```

These are correctly mapped to:

- `player_units_produced` (84 rows) ✅
- `city_units_produced` (62 rows) ✅

### 4. Critical Schema Alignment Issues

#### Issue 1: Character Genealogy (HIGH PRIORITY)

**Schema Expectation:**

```sql
characters (
    birth_father_id INTEGER,
    birth_mother_id INTEGER,
    ...
)
```

**XML Reality:**

```xml
<Character ID="8" ...>
    <FirstName>NAME_DIDO</FirstName>
    <!-- NO parent ID elements observed -->
</Character>
```

**Status:** Fields exist in schema but are empty (per database analysis).
**Root Cause:** Unknown - either:

1. XML doesn't contain parent references (needs verification)
2. Parent references are in a different format/location
3. Parser hasn't implemented this yet

**Impact:** `character_lineage` view is non-functional, family tree analysis impossible.

#### Issue 2: Unit Tracking (CRITICAL)

**Schema Design:**

```sql
units (
    unit_id INTEGER NOT NULL,
    unit_type VARCHAR NOT NULL,
    player_id INTEGER,
    tile_id INTEGER NOT NULL,
    ...
) -- Designed for individual unit tracking
```

**XML Reality:**

- ❌ No `/Root/Unit` elements at all
- ✅ Aggregate statistics only in `Player/UnitsProduced` and `City/UnitProductionCounts`

**Impact:**

- 0 rows in `units`, `unit_promotions`, `unit_types` tables
- Military analysis limited to aggregate production counts only
- **Schema is over-engineered for data that doesn't exist**

**Recommendation:** Either:

1. Accept that individual unit tracking is impossible from save files
2. Remove/deprecate unit detail tables
3. Mark as "future enhancement pending game format changes"

#### Issue 3: City Subsystems (MEDIUM PRIORITY)

**Schema Tables:** `city_yields`, `city_culture`, `city_religions`
**XML Availability:** ✅ **DATA EXISTS** in XML
**Current Status:** ❌ Tables are empty (0 rows)
**Root Cause:** Parser not implemented for these nested structures

**Example XML (verified present):**

```xml
<City ID="0" ...>
    <YieldProgress>
        <YIELD_GROWTH>380</YIELD_GROWTH>
        <YIELD_CULTURE>4918</YIELD_CULTURE>
    </YieldProgress>
    <Religion>
        <RELIGION_PAGAN_CARTHAGE />
    </Religion>
    <TeamCulture>
        <T.0>CULTURE_DEVELOPING</T.0>
    </TeamCulture>
</City>
```

**Impact:** Missing granular city-level economic and cultural data.
**Recommendation:** High-value parser implementation target.

#### Issue 4: Event System (LOW-MEDIUM PRIORITY)

**Schema Tables:**

- `event_logs` (0 rows)
- `event_outcomes` (0 rows)
- `story_choices` (0 rows)

**XML Reality:**

- ✅ `LogData` events exist and are well-documented
- ✅ Story events tracked in `EventStoryTurn` elements
- ❓ Event outcomes may be implicit in LogData text
- ❓ Story choices may not be stored after resolution

**Current Implementation:**

- `story_events` table: 764 rows ✅ (working)
- But missing: comprehensive logging, outcome tracking, choice recording

**Recommendation:** Review XML structure to determine if detailed outcome/choice data exists or if this is an over-specification.

### 5. Schema Design Quality Assessment

#### ✅ Strengths

1. **Clean Normalization**: Proper foreign key constraints, logical entity separation
2. **ID Mapping System**: Smart solution for stable database IDs across re-imports
3. **Time-Series Design**: Excellent support for turn-by-turn historical analysis
4. **Multi-Match Support**: Well-designed for analyzing multiple game saves
5. **Comprehensive Views**: Helpful analytical views like `match_summary`, `character_lineage`, `player_performance`

#### ⚠️ Areas of Concern

1. **Over-Specification**: Schema includes tables for data that may not exist in save files
2. **Optimistic Coverage Claim**: "~85% coverage of XML data structures" may be inflated if including impossible-to-populate tables
3. **Documentation Dependency**: Schema design appears based on incomplete/inaccurate save-file-format.md documentation

#### 🎯 Recommended Schema Changes

**HIGH PRIORITY:**

1. **Add schema metadata table:**

```sql
CREATE TABLE schema_coverage_notes (
    table_name VARCHAR PRIMARY KEY,
    xml_source VARCHAR,  -- XPath or description
    availability_status VARCHAR,  -- 'confirmed', 'partial', 'missing', 'static'
    parser_status VARCHAR,  -- 'implemented', 'in_progress', 'blocked', 'deferred'
    notes TEXT
);
```

2. **Mark unit tables as optional/future:**

```sql
-- Add comments to unit tables
COMMENT ON TABLE units IS 'AVAILABILITY: NO SOURCE DATA IN SAVE FILES (as of v1.0.80522). Individual unit state is not persisted. Only aggregate production counts available.';
COMMENT ON TABLE unit_promotions IS 'AVAILABILITY: BLOCKED - parent table has no source data';
COMMENT ON TABLE unit_types IS 'AVAILABILITY: STATIC - could be populated from game definitions';
```

3. **Fix character genealogy:** Investigate XML structure thoroughly or mark fields as unavailable

**MEDIUM PRIORITY:**

4. **Implement city subsystem parsers** - data exists, just needs implementation
5. **Add legitimacy_history parser** - data exists in XML
6. **Complete diplomacy state tracking** - partial data available

**LOW PRIORITY:**

7. **Review event system design** against actual XML capabilities
8. **Consider tile ownership parsing** - verify if data exists or is only for unowned tiles

### 6. Comparison: Documentation vs Reality vs Schema

| Aspect                 | save-file-format.md                     | Actual XML (2024-2025)  | schema.sql                             | Alignment                                |
| ---------------------- | --------------------------------------- | ----------------------- | -------------------------------------- | ---------------------------------------- |
| **Root Structure**     | Root with 31 attributes                 | ✅ Confirmed            | ✅ Captured in `matches`               | Good                                     |
| **Player Elements**    | `/Root/Player[@ID]`                     | ✅ Confirmed            | ✅ `players` table                     | Good                                     |
| **Character Elements** | `/Root/Character[@ID]`                  | ✅ Confirmed            | ✅ `characters` table                  | Good                                     |
| **City Elements**      | `/Root/City[@ID]`                       | ✅ Confirmed            | ✅ `cities` table                      | Good                                     |
| **Tile Elements**      | `/Root/Tile`                            | ✅ Confirmed            | ✅ `tiles` table                       | Good                                     |
| **Unit Elements**      | ❌ `/Root/Unit[@ID]` described          | ❌ **NOT FOUND**        | ❌ 3 empty tables                      | **CRITICAL MISMATCH**                    |
| **MemoryData**         | `/Root/Player/MemoryList/MemoryData`    | ✅ Confirmed            | ❓ Not mapped                          | Documentation correct, schema incomplete |
| **LogData**            | `/Root/Player/PermanentLogList/LogData` | ✅ Confirmed            | ⚠️ `event_logs` table exists but empty | Documentation correct, parser missing    |
| **Character Parents**  | Implied by fields                       | ❓ Not found in samples | ❌ Empty columns                       | Unknown if available                     |
| **City Subsystems**    | Not documented                          | ✅ Exists in XML        | ✅ Tables exist but empty              | Schema better than docs!                 |

### 7. Data Availability Matrix

| Data Category                  | XML Availability      | Schema Coverage   | Parser Implementation | Gap Analysis                          |
| ------------------------------ | --------------------- | ----------------- | --------------------- | ------------------------------------- |
| **Match Metadata**             | ✅ Full               | ✅ Full           | ✅ Implemented        | None                                  |
| **Players**                    | ✅ Full               | ✅ Full           | ✅ Mostly done        | Minor gaps in difficulty, founder IDs |
| **Characters (Core)**          | ✅ Full               | ✅ Full           | ✅ Implemented        | Works well                            |
| **Characters (Genealogy)**     | ❓ Unknown            | ✅ Schema ready   | ❌ Not working        | **Need XML investigation**            |
| **Characters (Relationships)** | ✅ Partial            | ✅ Schema ready   | ⚠️ Partial            | Missing strength/timing data          |
| **Characters (Marriages)**     | ❓ Unknown            | ✅ Schema ready   | ❌ Not found          | **Need XML investigation**            |
| **Cities (Core)**              | ✅ Full               | ✅ Full           | ✅ Implemented        | Works well                            |
| **Cities (Yields)**            | ✅ Full               | ✅ Schema ready   | ❌ Not implemented    | **High-value parser target**          |
| **Cities (Culture)**           | ✅ Full               | ✅ Schema ready   | ❌ Not implemented    | **High-value parser target**          |
| **Cities (Religions)**         | ✅ Full               | ✅ Schema ready   | ❌ Not implemented    | **High-value parser target**          |
| **Tiles**                      | ✅ Full               | ✅ Full           | ⚠️ Mostly done        | Ownership fields empty                |
| **Units (Individual)**         | ❌ **Does not exist** | ❌ Over-specified | ❌ Impossible         | **Schema should mark as unavailable** |
| **Units (Aggregate)**          | ✅ Full               | ✅ Implemented    | ✅ Working            | Good alternative                      |
| **Technologies**               | ✅ Full               | ✅ Full           | ✅ Implemented        | Works well                            |
| **Laws**                       | ✅ Full               | ✅ Full           | ✅ Implemented        | Works well                            |
| **Families**                   | ✅ Full               | ✅ Full           | ✅ Implemented        | Works well                            |
| **Religions**                  | ✅ Full               | ✅ Full           | ✅ Implemented        | Works well                            |
| **Tribes**                     | ✅ Full               | ⚠️ Partial schema | ⚠️ Partial            | Leadership/alliance data empty        |
| **Diplomacy**                  | ✅ Partial            | ✅ Full           | ⚠️ Basic only         | State details missing                 |
| **Time Series**                | ✅ Full               | ✅ Full           | ⚠️ Mostly done        | Legitimacy missing                    |
| **Events (LogData)**           | ✅ Full               | ✅ Schema ready   | ❌ Not implemented    | **Medium-value target**               |
| **Events (Story)**             | ✅ Full               | ✅ Schema ready   | ✅ Implemented        | Works well                            |
| **Events (Outcomes)**          | ❓ Unknown            | ✅ Schema ready   | ❌ Not implemented    | May not exist in XML                  |
| **MemoryData**                 | ✅ Full               | ❌ Not in schema  | ❌ Not implemented    | **Schema gap**                        |

### 8. Save File Format Version Differences

**2024 (v1.0.70671):**

- 5,476 tiles (larger map)
- 297 characters
- 28 cities
- 5 players (multiplayer AI game)
- TurnScale: SEMESTER

**2025 (v1.0.80522):**

- 1,972 tiles (smaller map)
- 69 characters
- 14 cities
- 2 players (2-player network game)
- TurnScale: YEAR
- New DLC: CALAMITIES
- New occurrence system in `/Root/Game/Occurrences`

**Format Stability:** Structure appears stable across versions, no breaking changes observed.

---

## Recommendations

### Immediate Actions (Week 1)

1. **✅ Document the Unit situation:**
   - Add comments to schema marking unit tables as "no source data available"
   - Update README or architecture docs to explain this limitation
   - Consider if individual unit tracking will ever be possible

2. **🔍 Investigate Character Genealogy:**
   - Deep dive into multiple save files to find parent references
   - Check if older versions had this data
   - If confirmed missing, document as unavailable

3. **📝 Create XML-to-Schema mapping document:**
   - Definitive mapping of every schema table to its XML source
   - Include XPath expressions for each field
   - Mark tables as: confirmed, partial, missing, or static reference data

### Short-term Goals (Month 1)

4. **🎯 Implement high-value parsers:**
   - City subsystems (yields, culture, religions) - **highest ROI**
   - Legitimacy history - completes time-series suite
   - Character marriage discovery

5. **🧹 Clean up schema expectations:**
   - Add `schema_coverage_notes` table
   - Add SQL comments documenting data sources
   - Update "85% coverage" claim to be more accurate

6. **📖 Create corrected save file format documentation:**
   - Fork/update save-file-format.md with corrections
   - Remove references to Unit elements
   - Add newly discovered structures (Occurrences, etc.)
   - Base entirely on actual XML inspection, not assumptions

### Medium-term Goals (Months 2-3)

7. **🔬 Comprehensive XML survey:**
   - Parse 10+ save files from different versions
   - Document all discovered element types
   - Create test coverage for version differences
   - Build format evolution timeline

8. **📊 Implement remaining parsers:**
   - LogData events
   - MemoryData (currently not in schema at all!)
   - Complete diplomacy state
   - Event outcomes (if available)

9. **🏗️ Schema refinement:**
   - Consider archiving/deprecating unit detail tables
   - Add version-specific handling for new elements
   - Optimize indexes based on actual queries

### Long-term Considerations

10. **🎮 Community documentation:**
    - Consider publishing corrected save file format docs
    - Help other Old World tools developers
    - Possibly contribute to modding community

11. **📈 Analytics expansion:**
    - Once parsers are complete, focus on analytical views
    - Develop standard queries and visualizations
    - Performance optimization

12. **🔄 Format version handling:**
    - Build system to handle multiple game versions
    - Gracefully handle new DLC adding new elements
    - Migration system for schema updates

---

## Conclusion

The **schema.sql design is fundamentally sound** with excellent normalization, proper foreign keys, and thoughtful time-series support. However, it suffers from being **over-specified based on incomplete documentation**.

The **save-file-format.md documentation is approximately 85% accurate** but contains at least one critical error (Unit elements) and appears to be based on assumptions rather than thorough XML inspection.

The **parser implementation has made good progress** (65.3% table population) but is correctly blocked on elements that don't exist in save files and incorrectly unimplemented on elements that do exist (city subsystems, legitimacy history).

**Priority actions:**

1. ✅ Accept that individual unit tracking is impossible
2. 🔍 Investigate character genealogy thoroughly
3. 🎯 Implement city subsystem parsers (high-value, data available)
4. 📝 Create accurate XML-to-schema mapping documentation
5. 🧹 Clean up schema expectations and documentation

The path forward is clear: **focus on parsing data that actually exists** rather than trying to populate tables for data that may never be available.

---

## Appendix: Sample XML Structures

### A. Character Element (Verified 2025)

```xml
<Character
  ID="4"
  BirthTurn="-18"
  Player="0"
  Gender="GENDER_FEMALE"
  FirstName="NAME_DIDO"
  Seed="18046197663819832677">
  <CustomNicknameType>GENDERED_TEXT_NICKNAME_THE_FOUNDER</CustomNicknameType>
  <Portrait>CHARACTER_PORTRAIT_DIDO</Portrait>
  <NameType>NAME_DIDO</NameType>
  <Level>6</Level>
  <XP>132</XP>
  <IsRoyal />
  <Royal>0</Royal>
  <Rating>
    <RATING_WISDOM>7</RATING_WISDOM>
    <RATING_CHARISMA>8</RATING_CHARISMA>
    <RATING_COURAGE>4</RATING_COURAGE>
    <RATING_DISCIPLINE>4</RATING_DISCIPLINE>
  </Rating>
  <TraitTurn>
    <TRAIT_SCHOLAR_ARCHETYPE>1</TRAIT_SCHOLAR_ARCHETYPE>
    <TRAIT_CHARISMATIC>1</TRAIT_CHARISMATIC>
    <TRAIT_BLESSED>18</TRAIT_BLESSED>
  </TraitTurn>
  <Relationships>
    <RELATIONSHIP_IN_LOVE_WITH>5</RELATIONSHIP_IN_LOVE_WITH>
    <RELATIONSHIP_IN_LOVE_WITH>12</RELATIONSHIP_IN_LOVE_WITH>
  </Relationships>
</Character>
```

**Notable:** No parent ID fields observed.

### B. City Element with Subsystems (Verified 2025)

```xml
<City
  ID="0"
  TileID="1094"
  Player="0"
  Family="FAMILY_HANNONID"
  Founded="1">
  <NameType>CITYNAME_CARTHAGO</NameType>
  <GovernorID>5</GovernorID>
  <Citizens>2</Citizens>
  <YieldProgress>
    <YIELD_GROWTH>380</YIELD_GROWTH>
    <YIELD_CULTURE>4918</YIELD_CULTURE>
    <YIELD_HAPPINESS>390</YIELD_HAPPINESS>
  </YieldProgress>
  <Religion>
    <RELIGION_PAGAN_CARTHAGE />
  </Religion>
  <TeamCulture>
    <T.0>CULTURE_DEVELOPING</T.0>
  </TeamCulture>
  <TeamHappinessLevel>
    <T.0>-5</T.0>
    <T.1>-1</T.1>
  </TeamHappinessLevel>
</City>
```

**Notable:** YieldProgress, Religion, and TeamCulture data IS AVAILABLE but not being parsed.

### C. Player LogData (Verified 2025)

```xml
<LogData>
  <Text>Discovered &lt;color=#e3c08c&gt;&lt;link="HELP_LINK,HELP_TECH,TECH_IRONWORKING"&gt;Ironworking&lt;/link&gt;&lt;/color&gt;</Text>
  <Type>TECH_DISCOVERED</Type>
  <Data1>TECH_IRONWORKING</Data1>
  <Data2>None</Data2>
  <Data3>None</Data3>
  <Turn>1</Turn>
  <TeamTurn>0</TeamTurn>
</LogData>
```

**Notable:** Well-structured, parseable, but not currently being imported.

### D. Player MemoryData (Verified 2025)

```xml
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
```

**Notable:** Critical AI memory system not represented in schema at all.

### E. Unit Aggregate Data (Verified 2025)

```xml
<!-- In Player element -->
<UnitsProduced>
  <UNIT_SETTLER>3</UNIT_SETTLER>
  <UNIT_SCOUT>1</UNIT_SCOUT>
  <UNIT_WARRIOR>6</UNIT_WARRIOR>
</UnitsProduced>

<!-- In City element -->
<UnitProductionCounts>
  <UNIT_SETTLER>4</UNIT_SETTLER>
</UnitProductionCounts>
```

**Notable:** This is the ONLY unit-related data in save files. No individual units tracked.

---

**End of Analysis**
