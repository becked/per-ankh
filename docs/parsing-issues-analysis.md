# Per-Ankh Parsing Issues Analysis and Resolution Plan

**Analysis Date:** 2025-11-06
**Analyst:** Technical Review
**Status:** Draft

## Executive Summary

The Per-Ankh database analysis reveals significant gaps in save file parsing, with **35% of tables empty** and **30% of populated tables containing empty columns**. This report identifies root causes and proposes actionable solutions to achieve complete data coverage.

### Critical Findings

- **19 empty tables** represent missing game features (units, religions, marriages)
- **16 tables** have partial data extraction (missing optional/conditional fields)
- **Core gameplay data** (characters, cities, technologies) is successfully parsed
- **Military and religious systems** are completely missing

---

## Current State Analysis

### Successfully Parsed Data (35 tables, 64.8% coverage)

The following game systems are working correctly:

- ✅ **Character System**: Characters, traits, stats, lineage (partial)
- ✅ **City Management**: Cities, production queues, projects
- ✅ **Economy**: Yields, prices, resource tracking
- ✅ **Technology**: Research progress and completion
- ✅ **Diplomacy**: Relations between nations (partial)
- ✅ **History Tracking**: Opinion histories, legitimacy, points
- ✅ **Map Data**: Tiles, tile changes, improvements (partial)

### Missing Data Categories

#### Category 1: Complete System Gaps (High Priority)

These tables are entirely empty, indicating missing parser implementations:

**Military System (0/4 tables working)**

- `units` - No unit data captured
- `unit_types` - No unit type definitions
- `unit_promotions` - No promotion tracking
- `military_composition` - No army composition data

**Religion System (0/2 tables working)**

- `religions` - No religion tracking
- `city_religions` - No city-religion relationships

**Character Relationships (0/3 tables working)**

- `character_marriages` - No marriage data
- `character_missions` - No mission assignments
- `character_relationships` - No relationship tracking

**Events System (0/2 tables working)**

- `event_logs` - No event tracking
- `event_outcomes` - No outcome recording
- `story_choices` - No choice tracking

**Governance (0/2 tables working)**

- `rulers` - No ruler history
- `family_law_opinions` - No family political positions

**Other Missing Features**

- `city_culture` - Cultural data missing
- `city_yields` - Detailed yield breakdowns missing
- `tile_visibility` - Fog of war/exploration data missing
- `match_settings` - Game configuration settings missing
- `match_locks` - Multiplayer lock state missing

#### Category 2: Partial Data Extraction (Medium Priority)

These tables have data but many columns are NULL:

**High-Impact Partial Parsing**

- `characters` (8/16 columns empty): Missing birth info, attributes (wisdom, charisma, courage, discipline), leader transitions
- `matches` (27/44 columns empty): Missing comprehensive game settings and configuration
- `match_summary` (6/12 columns empty): Missing game identification and victory details

**Medium-Impact Partial Parsing**

- `tiles` (4 columns empty): Missing improvement progress, ownership details, religion
- `diplomacy` (4 columns empty): Missing war scores and conflict timing
- `cities` (3 columns empty): Missing general and agent assignments
- `tribes` (4 columns empty): Missing leader and alliance information

**Low-Impact Partial Parsing**

- `character_lineage`: Missing parent names (may not be in save format)
- `character_traits`: Missing removal turn tracking
- `technologies_completed`: Missing completion turn
- `story_events`: Missing secondary character links and event text
- `player_council`: Missing appointment turns
- `player_goals`: Missing failure turns
- `players`: Missing various optional fields
- `tile_changes`: Missing old values
- `city_production_queue`: Missing yield costs

---

## Root Cause Analysis

### 1. Parser Implementation Gaps

**Evidence:**

- 19 empty tables with no corresponding parser code
- Background processes show imports completing without errors
- Schema exists but no data flows into these tables

**Root Cause:**
Parsers were likely implemented incrementally, focusing on core features first. Secondary game systems (military, religion, relationships) were deferred.

**Impact:** High - Core gameplay features invisible to users

### 2. Optional/Conditional Field Handling

**Evidence:**

- Many empty columns in populated tables
- Fields like `wisdom`, `charisma` appear to be game-version specific
- Some fields may only exist in certain game states (e.g., `war_score` during wars)

**Root Cause:**

- Parsers may use older XML schema that doesn't include newer fields
- Conditional fields not being checked for existence before parsing
- NULL handling inconsistent across parsers

**Impact:** Medium - Data incomplete but core functionality works

### 3. Save File Format Variations

**Evidence:**

- Test data from specific game version (OW-Babylonia-Year123)
- Empty columns may indicate version-specific features

**Possible Causes:**

- Old World game updates add new fields over time
- Different game modes expose different data
- Multiplayer vs single-player save format differences

**Impact:** Medium - May require version detection logic

### 4. Data Model Mismatch

**Evidence:**

- `character_lineage` has parent name columns that are always NULL
- Some match_summary fields empty despite being in schema

**Root Cause:**

- Schema designed for ideal state, not actual save file contents
- Some data may be computed/derived rather than stored in saves
- Save files may reference data by ID without including display names

**Impact:** Low - Schema cleanup needed but not blocking

---

## Recommended Resolution Approaches

### Approach 1: Systematic Parser Audit (Recommended First Step)

**Action Plan:**

1. **Inventory Existing Parsers**
   - List all parser modules in `src-tauri/src/parser/` (or equivalent)
   - Map each parser to database tables it populates
   - Identify tables with no corresponding parser

2. **Examine Save File Structure**
   - Extract and inspect XML/JSON structure of test save files
   - Document available data elements for each game system
   - Identify what data exists vs. what schema expects

3. **Gap Analysis Report**
   - For each empty table, determine: Does data exist in save files?
   - For each empty column, verify if data is present in saves
   - Prioritize based on user value and data availability

**Tools Needed:**

- XML/JSON viewer for save file inspection
- Parser code review (check `src-tauri/src/parser/`)
- Test save files from different game versions/scenarios

**Timeline:** 1-2 days
**Risk:** Low - Pure analysis, no code changes

### Approach 2: Incremental Parser Implementation

**Priority 1: High-Value Missing Systems**

Implement parsers for most-requested features:

1. **Units Parser** (`units`, `unit_types`, `unit_promotions`)
   - Critical for military analysis
   - Likely well-structured in save files
   - High user visibility

2. **Religion Parser** (`religions`, `city_religions`)
   - Core game mechanic
   - Ties into city management
   - Medium complexity

3. **Character Relationships** (`character_marriages`, `character_relationships`)
   - Enriches character system
   - Dynasty/family tree visualization potential
   - Medium complexity

**Priority 2: Complete Partial Parsers**

Enhance existing parsers to capture missing fields:

1. **Character Attributes** (wisdom, charisma, courage, discipline)
   - Check if these exist in save XML/JSON
   - May require game version detection
   - Enhance character analysis capabilities

2. **Match Settings** (comprehensive game configuration)
   - Useful for filtering/categorizing games
   - May exist in separate file or section

3. **Diplomacy Details** (war_score, conflict timing)
   - Conditional fields (only during wars)
   - Requires checking for presence before parsing

**Priority 3: Low-Impact Features**

- Event system (if desired for future features)
- Tile visibility (fog of war - questionable value)
- Match locks (multiplayer - if supporting MP analysis)

**Implementation Pattern:**

```rust
// For each new parser:
1. Locate data in save file XML/JSON structure
2. Define Rust struct with proper types
3. Implement parsing logic with error handling
4. Insert into DuckDB with proper transaction handling
5. Add integration test with test save file
6. Verify data appears in database
```

**Timeline:** 1 week per major system
**Risk:** Medium - Requires understanding save file format

### Approach 3: Save File Version Detection

**Rationale:**
Different Old World versions may have different save formats. Implementing version detection enables:

- Conditional parsing based on game version
- Better error messages for unsupported versions
- Future-proofing as game updates

**Implementation:**

1. Add `game_version` field to `matches` table
2. Parse version from save file metadata
3. Use version checks in parsers:
   ```rust
   if game_version >= "1.0.70000" {
       // Parse newer fields
   }
   ```

**Timeline:** 2-3 days
**Risk:** Low - Additive feature

### Approach 4: Schema Cleanup

**Action Plan:**

1. **Identify Unparseable Fields**
   - Fields that don't exist in any save file version
   - Computed/derived fields not stored in saves
   - Fields from abandoned game features

2. **Document vs. Remove**
   - Add schema comments explaining NULL fields
   - OR remove columns that will never be populated
   - Maintain schema migration history

3. **Update Documentation**
   - Document which fields are version-specific
   - Note conditional fields (war_score, etc.)
   - Explain NULL semantics for each table

**Timeline:** 1 day
**Risk:** Low - Improves clarity

### Approach 5: Enhanced Error Reporting

**Problem:**
Background bash outputs show imports "completing" but we don't know what's being skipped.

**Solution:**

1. **Add Parser Metrics**
   - Count elements found in save file
   - Count elements successfully parsed
   - Count elements skipped/errored

2. **Structured Logging**

   ```rust
   log::info!("Parsed {} units from save file", unit_count);
   log::warn!("Skipped {} units due to missing data", skip_count);
   log::error!("Failed to parse {} units", error_count);
   ```

3. **Summary Report**
   - Show parsing completeness per game system
   - Surface warnings to user in UI
   - Help identify format changes in new game versions

**Timeline:** 2-3 days
**Risk:** Low - Improves debuggability

---

## Prioritized Action Plan

### Phase 1: Assessment (Week 1)

1. ✅ Run database analysis (complete)
2. ⬜ Review existing parser code structure
3. ⬜ Inspect test save file XML/JSON structure
4. ⬜ Map available data to missing tables
5. ⬜ Create detailed gap analysis spreadsheet

**Deliverable:** Comprehensive data availability matrix

### Phase 2: Quick Wins (Week 2)

1. ⬜ Implement game version detection
2. ⬜ Add parser metrics and logging
3. ⬜ Complete character attribute parsing (wisdom, charisma, etc.)
4. ⬜ Add match settings parsing

**Deliverable:** Better visibility into parsing process + richer character data

### Phase 3: Major Systems (Weeks 3-5)

1. ⬜ Implement Units parser (week 3)
2. ⬜ Implement Religion parser (week 4)
3. ⬜ Implement Character relationships parser (week 5)

**Deliverable:** 3 major game systems fully parsed

### Phase 4: Refinement (Week 6)

1. ⬜ Complete diplomacy partial fields
2. ⬜ Schema cleanup and documentation
3. ⬜ Add integration tests for all parsers
4. ⬜ Update database analysis to show improvements

**Deliverable:** 90%+ data coverage with comprehensive tests

---

## Success Metrics

### Coverage Targets

- **Immediate (Phase 2):** 70% table coverage (38/54 tables)
- **Short-term (Phase 3):** 85% table coverage (46/54 tables)
- **Long-term (Phase 4):** 90%+ table coverage (49+/54 tables)

### Quality Indicators

- All parsers have integration tests
- Parser errors logged with context
- Empty columns documented as "Not in save format" or "Version-specific"
- User-facing features work with available data

### Non-Goals

- 100% coverage if data doesn't exist in save files
- Parsing multiplayer-only features for single-player analysis tool
- Supporting ancient game versions (< 1 year old)

---

## Risk Assessment

### Technical Risks

| Risk                                      | Probability | Impact | Mitigation                      |
| ----------------------------------------- | ----------- | ------ | ------------------------------- |
| Save format changes between versions      | High        | High   | Implement version detection     |
| Data not available in save files          | Medium      | High   | Audit save file structure first |
| Performance degradation with more parsers | Low         | Medium | Use DuckDB batch inserts        |
| Breaking changes to existing parsers      | Low         | High   | Comprehensive integration tests |

### Resource Risks

| Risk                            | Probability | Impact | Mitigation                           |
| ------------------------------- | ----------- | ------ | ------------------------------------ |
| Insufficient test data coverage | Medium      | Medium | Collect saves from multiple versions |
| Documentation gaps              | Medium      | Low    | Document as you go                   |
| Parser complexity estimation    | High        | Medium | Start with simplest systems first    |

---

## Appendix: Technical Investigation Tasks

### Immediate Investigation Needed

1. **Locate Parser Code**
   - Find all files matching `*parser*.rs` or `*parse*.rs`
   - Identify main parsing entry point
   - Map parser functions to database tables

2. **Inspect Save File**

   ```bash
   # Extract and examine save structure
   unzip test-data/saves/OW-Babylonia-Year123-2024-01-31-22-44-04.zip
   # Look for:
   # - Unit definitions
   # - Religion data
   # - Character relationship elements
   # - Event logs
   ```

3. **Check Background Process Outputs**
   - Review bash outputs from import examples
   - Look for warnings/errors being silently ignored
   - Identify what's being logged during parse

4. **Database Schema Review**
   - Compare schema to Old World game documentation
   - Verify field names match save file structure
   - Identify any schema-to-save-format mismatches

---

## Conclusion

The Per-Ankh parsing system has a solid foundation with 65% of game systems working correctly. The primary issues are:

1. **Missing parsers** for secondary game systems (military, religion, relationships)
2. **Incomplete parsers** that skip optional or version-specific fields
3. **Lack of visibility** into what's being skipped during parsing

The recommended approach is:

1. **Audit first** - Understand what data exists before writing code
2. **Implement incrementally** - Start with high-value systems (units, religion)
3. **Add observability** - Log what's parsed, skipped, and errored
4. **Test thoroughly** - Integration tests prevent regressions

With focused effort over 6 weeks, Per-Ankh can achieve 90%+ data coverage and provide comprehensive Old World game analytics.
