# Implementation Action Items - XML Parser

**Based on:** Architecture reviews in `docs/reviews/`
**Plan:** `docs/plans/xml-parser-implementation.md`
**Status:** Not Started
**Last Updated:** 2025-11-05

---

## Overview

This document tracks all action items identified during the architectural review of the XML parser implementation plan. Items are prioritized and organized by category for systematic resolution.

**Priority Levels:**
- 🔴 **Critical** - Blocks implementation, must fix immediately
- 🟡 **High** - Impacts core functionality, fix before Milestone 2
- 🟢 **Medium** - Important for production, address before Milestone 4
- 🔵 **Low** - Quality of life, address before final release

---

## Critical Issues (Block Implementation Start)

### 🔴 1. Schema Mismatch - Add `xml_id` Columns

**Issue:** Plan references `xml_id` columns in INSERT statements, but `docs/schema.sql` doesn't include these columns.

**Source:** Review 1, Lines 28-44

**Impact:** Code won't compile/run against current schema

**Action Items:**
- [ ] Review schema.sql and identify which tables need `xml_id`
  - characters
  - cities
  - units
  - tiles
  - players
  - families
  - religions
  - tribes
- [ ] Add `xml_id INTEGER` column to each identified table
- [ ] Update schema comments to explain xml_id purpose (debugging, future export)
- [ ] Add index on xml_id where beneficial: `CREATE INDEX idx_{table}_xml_id ON {table}(match_id, xml_id)`
- [ ] Update implementation plan examples to match final schema

**Acceptance Criteria:**
- Schema.sql includes xml_id columns for all entities with XML IDs
- All INSERT statements in plan align with updated schema
- Schema initializes without errors in DuckDB

**Estimated Effort:** 2 hours

---

### 🔴 2. XML Parsing Library - Switch to `roxmltree`

**Issue:** Plan assumes DOM-like XML access, but `quick-xml` is event-based (SAX-style)

**Source:** Review 1 Lines 211-227, Review 2 Lines 22-23

**Impact:** Code examples in plan won't work as written

**Decision Required:** Stream parsing with quick-xml OR DOM parsing with roxmltree?

**Action Items:**

**Option A: Switch to roxmltree (Recommended)**
- [ ] Update `Cargo.toml`: Replace `quick-xml` with `roxmltree = "0.19"`
- [ ] Rewrite all XML parsing examples in plan to use roxmltree API
  - `let doc = roxmltree::Document::parse(&xml_content)?;`
  - `doc.descendants().filter(|n| n.has_tag_name("City"))`
- [ ] Update plan's "XML Parsing Patterns" section with roxmltree examples
- [ ] Test roxmltree with actual save file to confirm it handles 11MB files

**Option B: Streaming with quick-xml**
- [ ] Rewrite plan to use event-based parsing model
- [ ] Design streaming architecture for multi-pass parsing
- [ ] Update all code examples to use quick-xml Reader

**Acceptance Criteria:**
- Plan's code examples compile and work with chosen library
- Test parse of OW-Hatti-Year99 save file succeeds
- No references to non-existent DOM methods remain in plan

**Estimated Effort:** 4-6 hours (depends on option chosen)

---

### 🔴 3. Complete IdMapper API

**Issue:** IdMapper only shows character/city/unit/tile mappings; missing players, families, religions, tribes, laws, techs, etc.

**Source:** Review 2, Lines 24-26, 115-116

**Impact:** Can't map IDs for all entity types, incomplete implementation

**Action Items:**
- [ ] Design complete IdMapper struct with all entity type maps:
  ```rust
  pub struct IdMapper {
      match_id: i64,

      // Entity mappings
      players: HashMap<i32, i64>,
      characters: HashMap<i32, i64>,
      cities: HashMap<i32, i64>,
      units: HashMap<i32, i64>,
      tiles: HashMap<i32, i64>,
      families: HashMap<i32, i64>,
      religions: HashMap<i32, i64>,
      tribes: HashMap<String, i64>, // Tribes use string IDs

      // Sequence counters
      next_player_id: i64,
      next_character_id: i64,
      // ... etc
  }
  ```
- [ ] Implement generic `map()` method to reduce duplication:
  ```rust
  fn map<T: EntityType>(&mut self, xml_id: T::XmlId) -> i64
  ```
- [ ] Implement `get()` methods with error handling for missing mappings
- [ ] Add `new()` constructor that initializes from database for updates
- [ ] Update plan with complete IdMapper implementation

**Acceptance Criteria:**
- IdMapper supports ALL entity types in schema
- Consistent API across all entity types
- Clear error messages for unmapped IDs

**Estimated Effort:** 3 hours

---

### 🔴 4. ID Stability Strategy for Updates

**Issue:** Update-and-replace deletes all data, then re-inserts with new DB IDs, breaking external references

**Source:** Review 1 Lines 56-73, Review 2 Lines 27-31

**Impact:** Database IDs change on re-import, breaking any saved queries, bookmarks, or external tools

**Decision Required:** How to maintain stable IDs across updates?

**Action Items:**

**Option A: Persist XML→DB Mappings (Recommended)**
- [ ] Create new table `id_mappings`:
  ```sql
  CREATE TABLE id_mappings (
      match_id BIGINT NOT NULL,
      entity_type VARCHAR NOT NULL, -- 'character', 'city', 'unit', etc.
      xml_id INTEGER NOT NULL,
      db_id BIGINT NOT NULL,
      PRIMARY KEY (match_id, entity_type, xml_id)
  );
  ```
- [ ] Update IdMapper to load existing mappings on re-import:
  ```rust
  impl IdMapper {
      pub fn new(match_id: i64, conn: &Connection, is_new: bool) -> Result<Self> {
          if is_new {
              // Start fresh
          } else {
              // Load existing mappings from id_mappings table
          }
      }
  }
  ```
- [ ] Update-and-replace preserves id_mappings table
- [ ] After import, save mappings back to id_mappings table

**Option B: Natural Keys + Upserts**
- [ ] Add unique constraint: `UNIQUE(match_id, xml_id)` to all entity tables
- [ ] Change DELETE strategy to DELETE only rows not in new import
- [ ] Use UPSERT/INSERT ... ON CONFLICT UPDATE instead of full replace

**Acceptance Criteria:**
- Re-importing same game preserves database IDs
- External references remain valid after update
- Test: Import turn 50, query by DB ID, re-import turn 75, same DB ID still valid

**Estimated Effort:** 4-6 hours

---

### 🔴 5. Tauri Async/Threading Strategy

**Issue:** Long-running import (10-15 seconds) blocks UI thread in async Tauri command

**Source:** Review 2, Lines 35-36, 85-86

**Impact:** UI freezes during import, poor user experience

**Action Items:**
- [ ] Wrap import in `spawn_blocking`:
  ```rust
  #[tauri::command]
  pub async fn import_save_file(
      file_path: String,
      app_handle: tauri::AppHandle
  ) -> Result<ImportResult, String> {
      tauri::async_runtime::spawn_blocking(move || {
          // Actual import logic here
          crate::parser::save_file::import_save_file(&file_path, ...)
      })
      .await
      .map_err(|e| e.to_string())?
  }
  ```
- [ ] Update plan's Tauri Integration section with spawn_blocking
- [ ] Test UI remains responsive during 15-second import

**Acceptance Criteria:**
- Import runs on background thread
- UI remains interactive during import
- Progress updates work smoothly

**Estimated Effort:** 1 hour

---

## High Priority (Fix Before Core Implementation)

### 🟡 6. Add Missing Dependencies to Cargo.toml

**Issue:** Plan uses `thiserror`, `log`, `env_logger`, `roxmltree` but they're not in Cargo.toml

**Source:** Review 1, Lines 188-202

**Action Items:**
- [ ] Add to `src-tauri/Cargo.toml`:
  ```toml
  thiserror = "1.0"
  log = "0.4"
  env_logger = "0.11"  # or tracing-subscriber for more features
  roxmltree = "0.19"   # if chosen over quick-xml
  ```
- [ ] Remove `quick-xml` if switching to roxmltree
- [ ] Verify all dependencies compile together
- [ ] Run `cargo check` to confirm no conflicts

**Acceptance Criteria:**
- All dependencies compile successfully
- No version conflicts
- cargo check passes

**Estimated Effort:** 30 minutes

---

### 🟡 7. Complete DELETE Cascade Order

**Issue:** Example deletion order is incomplete and may violate foreign keys

**Source:** Review 1, Lines 89-115

**Action Items:**
- [ ] Generate complete deletion order from schema.sql foreign keys
- [ ] Create constant in code:
  ```rust
  const DELETE_ORDER: &[&str] = &[
      // Leaf tables (no children)
      "unit_promotions",
      "character_traits",
      "character_stats",
      "character_missions",
      "character_relationships",
      "character_marriages",
      "city_yields",
      "city_culture",
      "city_religions",
      "city_production_queue",
      "city_units_produced",
      "city_projects_completed",
      "tile_changes",
      "tile_visibility",
      "player_resources",
      "player_council",
      "family_opinion_history",
      "family_law_opinions",
      "religion_opinion_history",
      "technologies_completed",
      "technology_progress",
      "technology_states",
      "laws",
      "diplomacy",
      "player_goals",
      "story_events",
      "story_choices",
      "event_outcomes",
      "event_logs",
      "yield_history",
      "points_history",
      "military_history",
      "legitimacy_history",
      "yield_prices",

      // Parent entities (referenced by children above)
      "units",
      "tiles",
      "cities",
      "characters",
      "families",
      "religions",
      "tribes",
      "players",

      // Match data last
      "match_settings",
      // Don't delete matches - we update it
  ];
  ```
- [ ] Write test to verify deletion order respects all FK constraints
- [ ] Update plan with complete order

**Acceptance Criteria:**
- Deletion runs without FK violations
- Test with actual imported data confirms order works
- Plan documents final order

**Estimated Effort:** 2 hours

---

### 🟡 8. Move Progress Reporting to Milestone 1

**Issue:** Progress reporting marked as "future enhancement" but critical for 15-second import UX

**Source:** Review 1, Lines 229-246

**Action Items:**
- [ ] Design ProgressCallback trait:
  ```rust
  pub trait ProgressCallback: Send + Sync {
      fn on_progress(&self, phase: &str, percent: u8);
  }
  ```
- [ ] Update import_save_file signature:
  ```rust
  pub fn import_save_file<P: ProgressCallback>(
      file_path: &str,
      db_path: &str,
      progress: P
  ) -> Result<ImportResult>
  ```
- [ ] Add progress calls at key milestones:
  - 5% - ZIP extracted
  - 10% - XML parsed
  - 20% - Match metadata
  - 30% - Players parsed
  - 40% - Characters parsed
  - 50% - Cities/tiles parsed
  - 60% - Units parsed
  - 70% - Relationships updated
  - 80% - Time-series started
  - 95% - Time-series complete
  - 100% - Done
- [ ] Implement Tauri event emission for progress
- [ ] Update Milestone 1 to include progress reporting
- [ ] Update plan to remove from "future enhancements"

**Acceptance Criteria:**
- Progress updates emit during import
- Frontend can display progress bar
- Progress is reasonably accurate (±5%)

**Estimated Effort:** 3 hours

---

### 🟡 9. Security - Zip Safety Measures

**Issue:** No validation of ZIP contents (zip bombs, path traversal, size limits)

**Source:** Review 2, Lines 37-43, 93-96

**Action Items:**
- [ ] Add ZIP validation constants:
  ```rust
  const MAX_COMPRESSED_SIZE: u64 = 50 * 1024 * 1024; // 50 MB
  const MAX_UNCOMPRESSED_SIZE: u64 = 100 * 1024 * 1024; // 100 MB
  const MAX_ENTRIES: usize = 10;
  ```
- [ ] Implement validation function:
  ```rust
  fn validate_zip_archive(archive: &ZipArchive) -> Result<()> {
      if archive.len() > MAX_ENTRIES {
          return Err(ParseError::InvalidArchiveStructure(
              format!("Too many entries: {}", archive.len())
          ));
      }

      for i in 0..archive.len() {
          let file = archive.by_index(i)?;

          // Check path traversal
          if file.name().contains("..") || file.name().starts_with('/') {
              return Err(ParseError::SecurityViolation(
                  "Path traversal detected".into()
              ));
          }

          // Check size
          if file.size() > MAX_UNCOMPRESSED_SIZE {
              return Err(ParseError::FileTooLarge(file.size()));
          }
      }

      Ok(())
  }
  ```
- [ ] Add ParseError variants: `SecurityViolation`, `FileTooLarge`
- [ ] Validate before extraction
- [ ] Update plan with security measures

**Acceptance Criteria:**
- Zip bombs rejected (compression ratio check)
- Path traversal attempts blocked
- Oversized files rejected
- Only expected file types accepted

**Estimated Effort:** 2 hours

---

### 🟡 10. Concurrency Control for Parallel Imports

**Issue:** Two parallel imports of same GameId can conflict (interleaved delete/insert)

**Source:** Review 2, Line 47

**Action Items:**
- [ ] Add unique constraint to schema:
  ```sql
  ALTER TABLE matches ADD CONSTRAINT unique_game_id UNIQUE (game_id);
  ```
- [ ] Implement advisory locking:
  ```rust
  pub fn acquire_match_lock(conn: &Connection, game_id: &str) -> Result<()> {
      // Use DuckDB's transaction + SELECT FOR UPDATE
      conn.execute(
          "SELECT match_id FROM matches WHERE game_id = ? FOR UPDATE",
          params![game_id]
      )?;
      Ok(())
  }
  ```
- [ ] Or use file-based locking:
  ```rust
  use fs2::FileExt;

  let lock_path = format!("{}/locks/{}.lock", db_dir, game_id);
  let lock_file = File::create(lock_path)?;
  lock_file.lock_exclusive()?; // Blocks until acquired
  ```
- [ ] Update plan with concurrency strategy
- [ ] Add test for concurrent imports

**Acceptance Criteria:**
- Parallel imports of same GameId serialize (second waits for first)
- No data corruption from concurrent access
- Clear error if lock can't be acquired

**Estimated Effort:** 3 hours

---

## Medium Priority (Important for Production Quality)

### 🟢 11. Schema Initialization with Idempotency

**Issue:** Plan mentions `initialize_schema` but doesn't explain implementation

**Source:** Review 1, Lines 247-262

**Action Items:**
- [ ] Implement schema initializer:
  ```rust
  pub fn initialize(db_path: &Path) -> Result<()> {
      let conn = Connection::open(db_path)?;

      // Embed schema.sql at compile time
      let schema_sql = include_str!("../../../docs/schema.sql");

      // Execute (schema uses IF NOT EXISTS for idempotency)
      conn.execute_batch(schema_sql)?;

      // Verify critical tables exist
      verify_schema(&conn)?;

      Ok(())
  }
  ```
- [ ] Add schema verification:
  ```rust
  fn verify_schema(conn: &Connection) -> Result<()> {
      let tables = vec!["matches", "players", "characters", "cities"];
      for table in tables {
          let exists: bool = conn.query_row(
              "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = ?)",
              params![table],
              |row| row.get(0)
          )?;
          if !exists {
              return Err(ParseError::SchemaNotInitialized(table.into()));
          }
      }
      Ok(())
  }
  ```
- [ ] Ensure app data directory created before initialization
- [ ] Update plan with implementation

**Acceptance Criteria:**
- Schema initializes successfully on first run
- Re-initialization is idempotent (no errors)
- Missing tables detected with clear errors

**Estimated Effort:** 2 hours

---

### 🟢 12. Validation Queries After Import

**Issue:** No post-import validation to detect data integrity issues

**Source:** Review 1, Lines 264-283

**Action Items:**
- [ ] Implement validation function:
  ```rust
  pub fn validate_import(conn: &Connection, match_id: i64) -> Result<Vec<ValidationWarning>> {
      let mut warnings = Vec::new();

      // Check orphaned foreign keys
      check_orphaned_parents(conn, match_id, &mut warnings)?;
      check_orphaned_cities(conn, match_id, &mut warnings)?;
      check_orphaned_governors(conn, match_id, &mut warnings)?;

      // Check data integrity
      check_negative_values(conn, match_id, &mut warnings)?;
      check_turn_ranges(conn, match_id, &mut warnings)?;

      Ok(warnings)
  }
  ```
- [ ] Add validation to import flow (after commit)
- [ ] Log warnings but don't fail import
- [ ] Return validation results in ImportResult
- [ ] Update plan with validation strategy

**Acceptance Criteria:**
- Common integrity issues detected
- Warnings logged but don't block import
- Frontend can display validation warnings to user

**Estimated Effort:** 4 hours

---

### 🟢 13. Batch Insert Optimization for DuckDB

**Issue:** Row-by-row inserts for time-series data may be slow

**Source:** Review 1, Lines 145-157, Review 2, Lines 51-55

**Action Items:**
- [ ] Research DuckDB Rust bindings for bulk insert APIs
- [ ] Implement batched insert for time-series:
  ```rust
  // Option A: Batched prepared statements
  let mut stmt = tx.prepare("INSERT INTO yield_history VALUES (?, ?, ?, ?, ?)")?;
  for batch in data.chunks(1000) {
      for row in batch {
          stmt.execute(params![...])?;
      }
  }

  // Option B: DuckDB COPY if available
  // Write to temp CSV, then COPY
  let temp_csv = create_temp_csv(data)?;
  tx.execute(&format!("COPY yield_history FROM '{}'", temp_csv), [])?;
  ```
- [ ] Benchmark both approaches with real save data
- [ ] Update plan with chosen optimization
- [ ] Add performance test to verify <15 second target

**Acceptance Criteria:**
- Time-series import completes in reasonable time (<5 seconds for 10k rows)
- No memory issues with large batches
- Performance target (<15s total) met

**Estimated Effort:** 4 hours

---

### 🟢 14. Consistent Option Handling Helpers

**Issue:** Plan mixes .ok() and .and_then() patterns inconsistently

**Source:** Review 2, Lines 63-69

**Action Items:**
- [ ] Create parsing helper module:
  ```rust
  // src-tauri/src/parser/xml_helpers.rs

  pub trait XmlNodeExt {
      fn req_attr<T: FromStr>(&self, name: &str) -> Result<T>;
      fn opt_attr<T: FromStr>(&self, name: &str) -> Option<T>;
      fn opt_attr_sentinel<T: FromStr + PartialEq>(
          &self, name: &str, sentinel: T
      ) -> Option<T>;

      fn req_child_text<T: FromStr>(&self, name: &str) -> Result<T>;
      fn opt_child_text<T: FromStr>(&self, name: &str) -> Option<T>;
  }

  impl XmlNodeExt for roxmltree::Node<'_, '_> {
      fn req_attr<T: FromStr>(&self, name: &str) -> Result<T> {
          self.attribute(name)
              .ok_or_else(|| ParseError::MissingAttribute(name.into()))?
              .parse()
              .map_err(|_| ParseError::InvalidFormat(name.into()))
      }

      fn opt_attr_sentinel<T: FromStr + PartialEq>(
          &self, name: &str, sentinel: T
      ) -> Option<T> {
          self.attribute(name)
              .and_then(|s| s.parse().ok())
              .and_then(|v| if v == sentinel { None } else { Some(v) })
      }
      // ... etc
  }
  ```
- [ ] Update all parsing code to use helpers
- [ ] Update plan examples to use consistent pattern

**Acceptance Criteria:**
- All attribute/element access uses helper methods
- Consistent error handling across parsers
- Sentinel values (-1 → None) handled uniformly

**Estimated Effort:** 3 hours

---

### 🟢 15. Enhanced Error Provenance

**Issue:** MalformedXML errors could include more context (column, excerpt, element path)

**Source:** Review 2, Lines 49-50

**Action Items:**
- [ ] Enhance ParseError::MalformedXML:
  ```rust
  #[error("Malformed XML at {location}: {message}\nContext: {context}")]
  MalformedXML {
      location: String,  // "line 45, col 12"
      message: String,
      context: String,   // "<Character ID=\"5\"><FirstName>..."
  }
  ```
- [ ] Capture roxmltree position info when available
- [ ] Add element path for nested errors: `Root > Player[0] > Character[5] > Name`
- [ ] Update error construction throughout parsers
- [ ] Improve logging format for parse errors

**Acceptance Criteria:**
- Error messages include file position
- Context snippet helps locate issue
- Element path shows nesting for nested errors

**Estimated Effort:** 2 hours

---

## Low Priority (Quality of Life)

### 🔵 16. Store File Hash and Import Provenance

**Issue:** file_hash computed but not used; no audit trail of imports

**Source:** Review 2, Line 81

**Action Items:**
- [ ] Update matches table to use file_hash
- [ ] Create import history table:
  ```sql
  CREATE TABLE import_history (
      import_id BIGINT PRIMARY KEY,
      match_id BIGINT NOT NULL,
      imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      file_path VARCHAR NOT NULL,
      file_hash VARCHAR NOT NULL,
      import_duration_ms INTEGER,
      rows_inserted INTEGER,
      validation_warnings TEXT,
      FOREIGN KEY (match_id) REFERENCES matches(match_id)
  );
  ```
- [ ] Log each import with metadata
- [ ] Add query to view import history for a match

**Acceptance Criteria:**
- Each import logged to import_history
- Can query when/what was imported for debugging
- File hash prevents duplicate imports

**Estimated Effort:** 2 hours

---

### 🔵 17. Deterministic Test Fixtures

**Issue:** Need canonical test save files covering edge cases

**Source:** Review 2, Lines 101-102

**Action Items:**
- [ ] Create minimal test save files:
  - `minimal-valid.zip` - Smallest valid save
  - `out-of-order-parents.zip` - Children before parents in XML
  - `sparse-history.zip` - Large gaps in turn-by-turn data
  - `sentinel-values.zip` - Uses -1, empty strings, etc.
  - `max-entities.zip` - Large number of characters/cities
- [ ] Add to test-data/saves/ with documentation
- [ ] Update .gitignore to allow these specific test files
- [ ] Reference in integration tests

**Acceptance Criteria:**
- At least 5 edge-case test fixtures
- All fixtures parse successfully
- Tests use fixtures to verify edge case handling

**Estimated Effort:** 6 hours (requires creating test saves manually or with tool)

---

### 🔵 18. Fuzz Testing for XML Parser

**Issue:** Property-based testing should cover malformed/random XML

**Source:** Review 2, Line 103

**Action Items:**
- [ ] Add `proptest` dependency
- [ ] Create fuzz tests:
  ```rust
  proptest! {
      #[test]
      fn fuzz_character_xml(
          id in 0i32..10000,
          name in ".*",
          turn in 0i32..1000
      ) {
          let xml = format!(
              r#"<Character ID="{}"<FirstName>{}</FirstName><BirthTurn>{}</BirthTurn></Character>"#,
              id, name, turn
          );

          // Should not panic, even on weird input
          let _ = parse_character_xml(&xml);
      }
  }
  ```
- [ ] Run fuzz tests in CI
- [ ] Fix any panics discovered

**Acceptance Criteria:**
- Fuzz tests run without panics
- Invalid input returns Err, never panics
- Coverage of common XML malformations

**Estimated Effort:** 4 hours

---

## Design Decisions Required

### Decision 1: XML Parsing Library

**Options:**
- A. **roxmltree** (DOM, easier but loads full file)
- B. **quick-xml** (streaming, harder but more memory efficient)
- C. **Hybrid** (stream to find sections, DOM for complex parts)

**Recommendation:** A (roxmltree) for simplicity at 11MB file size

**Decision:** [Pending]

---

### Decision 2: ID Stability Mechanism

**Options:**
- A. **Persist mappings table** (id_mappings table in DB)
- B. **Natural keys + upserts** (match_id + xml_id uniqueness)
- C. **Don't preserve IDs** (accept that re-import changes IDs)

**Recommendation:** A (persist mappings) for referential integrity

**Decision:** [Pending]

---

### Decision 3: Progress Reporting Implementation

**Options:**
- A. **Trait-based callback** (passed to import function)
- B. **Channel-based** (send progress updates to channel)
- C. **Tauri events only** (emit directly in parser)

**Recommendation:** A (trait) for testability and flexibility

**Decision:** [Pending]

---

### Decision 4: Bulk Insert Strategy

**Options:**
- A. **Batched prepared statements** (1000 rows at a time)
- B. **DuckDB COPY from CSV** (write temp file, then COPY)
- C. **DuckDB appender API** (if Rust bindings support it)

**Recommendation:** Benchmark A and B, choose based on performance

**Decision:** [Pending]

---

## Implementation Priority Order

**Phase 1: Critical Fixes (Week 0 - Before coding starts)**
1. Add xml_id columns to schema
2. Choose and integrate XML parsing library
3. Complete IdMapper API
4. Design ID stability strategy
5. Add Tauri spawn_blocking
6. Add missing dependencies

**Phase 2: High Priority (Milestone 1)**
7. Complete DELETE cascade order
8. Move progress reporting to core
9. Implement ZIP security measures
10. Add concurrency control

**Phase 3: Medium Priority (Milestone 2-3)**
11. Schema initialization
12. Post-import validation
13. Batch insert optimization
14. Consistent parsing helpers
15. Enhanced error messages

**Phase 4: Low Priority (Milestone 5-6)**
16. Import provenance tracking
17. Test fixture creation
18. Fuzz testing

---

## Progress Tracking

### Legend
- [ ] Not Started
- [~] In Progress
- [x] Complete
- [!] Blocked

### Current Status
- **Critical Issues:** 0/5 complete
- **High Priority:** 0/5 complete
- **Medium Priority:** 0/5 complete
- **Low Priority:** 0/3 complete
- **Total:** 0/18 complete (0%)

### Blockers
None currently

---

## Notes

Add any additional context, decisions made, or issues discovered here as work progresses.

---

**Next Session Goals:**
1. Make decisions on pending choices (XML library, ID stability)
2. Begin Phase 1 critical fixes (schema updates, dependencies)
3. Create test environment to validate fixes

**Document Status:** Ready for Review
**Last Updated:** 2025-11-05
