# Intra-File Progress Updates - Implementation Plan

## Overview

Currently, the import progress bar only updates after each file completes processing. For large save files, this means no visual progress for extended periods (potentially several seconds). This document describes implementing phase-based progress updates that move the progress bar smoothly within each file.

## Goals

1. Provide visual progress feedback during long file imports
2. Display meaningful phase names (e.g., "Parsing characters", "Parsing time-series data")
3. Minimal performance overhead (~8 events per file instead of 24+)
4. Accurate progress representation based on actual work completed

## Approach: 8-Phase Grouped Updates

Instead of emitting an event after every parsing step, group related parsing operations into 8 major phases that represent meaningful milestones:

1. **Extraction & Setup** - ZIP extraction, XML parsing, lock acquisition, match setup
2. **Foundation Entities** - Players, characters, tiles, cities, tribes, families, religions (including all Pass 2 sub-phases)
3. **Unit Production** - Player and city unit production aggregates
4. **Gameplay Data** - Resources, technologies, council, laws, goals, logs, memories
5. **Diplomacy** - Relations between players
6. **Time-Series Data** - History data (military, points, legitimacy, yields, opinions)
7. **Character & City Extended** - Stats, traits, relationships, production queues, etc.
8. **Tile Extended & Finalization** - Tile visibility/history, event stories, ID mappings

These 8 phases correspond to the natural structure of `import_save_file_internal()` and represent distinct logical units of work.

## Performance Impact

- **Current**: 1 event per file
- **Proposed**: 8 events per file
- **Per-event overhead**: ~0.1-0.5ms (serialization + IPC)
- **Total overhead per file**: ~0.8-4ms
- **For 100 files**: ~80-400ms total overhead (negligible compared to total import time)

## Implementation Details

### 1. Extend `ImportProgress` Struct

**File**: `src-tauri/src/lib.rs`

Add two optional fields to the existing `ImportProgress` struct:

```rust
#[derive(Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct ImportProgress {
    // ... existing fields ...

    /// Current parsing phase within the file (e.g., "Parsing characters")
    pub current_phase: Option<String>,

    /// Progress within current file (0.0 to 1.0, where 1.0 = file complete)
    pub file_progress: Option<f64>,
}
```

**Why optional?**: The final progress event (after file completes) doesn't need these fields - it includes `result: Some(ImportResult)` instead.

### 2. Modify `import_files_batch` Function

**File**: `src-tauri/src/lib.rs` (lines 560-671)

#### Change the function signature to pass more context:

```rust
fn import_files_batch(
    files: Vec<PathBuf>,
    app: tauri::AppHandle,
) {
    let pool: tauri::State<db::connection::DbPool> = app.state();
    let total = files.len();
    let start_time = Instant::now();

    // ... rest of existing code ...
```

#### Update the call to pass file context:

Replace line 597-604:

```rust
// OLD:
let result = pool
    .with_connection(|conn| {
        parser::import_save_file(
            file_path.to_str().unwrap_or(""),
            conn,
        )
    })
    .context("Import failed");
```

With:

```rust
// NEW:
let result = pool
    .with_connection(|conn| {
        parser::import_save_file(
            file_path.to_str().unwrap_or(""),
            conn,
            &app,
            current, // file index (1-based)
            total,   // total files
            &file_name,
            start_time,
        )
    })
    .context("Import failed");
```

#### Update final progress event emission (line 636-654):

Set `current_phase: None` and `file_progress: None` since the file is complete:

```rust
let progress = ImportProgress {
    current,
    total,
    current_file: file_name,
    elapsed_ms,
    estimated_remaining_ms,
    speed,
    result: import_result,
    current_phase: None,         // Add this
    file_progress: None,         // Add this
};
```

### 3. Update `import_save_file` Function Signature

**File**: `src-tauri/src/parser/import.rs` (line 86)

Add parameters to thread through the AppHandle and file context:

```rust
pub fn import_save_file(
    file_path: &str,
    conn: &Connection,
    app: &tauri::AppHandle,
    file_index: usize,
    total_files: usize,
    file_name: &str,
    batch_start_time: Instant,
) -> Result<ImportResult> {
```

Pass these through to `import_save_file_internal()` at line 125:

```rust
match import_save_file_internal(
    file_path,
    &doc,
    &tx,
    &game_id,
    app,
    file_index,
    total_files,
    file_name,
    batch_start_time,
) {
```

### 4. Update `import_save_file_internal` Function

**File**: `src-tauri/src/parser/import.rs` (line 163)

#### Update function signature:

```rust
fn import_save_file_internal(
    file_path: &str,
    doc: &XmlDocument,
    tx: &Connection,
    game_id: &str,
    app: &tauri::AppHandle,
    file_index: usize,
    total_files: usize,
    file_name: &str,
    batch_start_time: Instant,
) -> Result<ImportResult> {
```

#### Add helper function at the top of the file (after imports):

```rust
/// Emit phase progress event
fn emit_phase_progress(
    app: &tauri::AppHandle,
    file_index: usize,
    total_files: usize,
    file_name: &str,
    phase_name: &str,
    phase_number: usize,
    total_phases: usize,
    batch_start_time: Instant,
) {
    let file_progress = (phase_number as f64) / (total_phases as f64);

    let elapsed = batch_start_time.elapsed();
    let elapsed_ms = elapsed.as_millis() as u64;

    // Calculate speed based on files completed + current file progress
    let files_progress = (file_index - 1) as f64 + file_progress;
    let speed = if elapsed_ms > 0 {
        files_progress / (elapsed_ms as f64 / 1000.0)
    } else {
        0.0
    };

    // Estimate remaining time
    let remaining_files = (total_files - file_index) as f64 + (1.0 - file_progress);
    let estimated_remaining_ms = if speed > 0.0 {
        (remaining_files / speed * 1000.0) as u64
    } else {
        0
    };

    let progress = ImportProgress {
        current: file_index,
        total: total_files,
        current_file: file_name.to_string(),
        elapsed_ms,
        estimated_remaining_ms,
        speed,
        result: None,
        current_phase: Some(phase_name.to_string()),
        file_progress: Some(file_progress),
    };

    // Log but don't fail if emit fails
    if let Err(e) = app.emit("import-progress", &progress) {
        log::error!("Failed to emit phase progress: {}", e);
    }
}
```

#### Add phase constants for clarity:

```rust
const TOTAL_PHASES: usize = 8;
```

#### Insert emit calls at strategic points in the function:

```rust
fn import_save_file_internal(
    /* ... params ... */
) -> Result<ImportResult> {
    let t_setup = Instant::now();

    // ... existing setup code (extract turn, check existing match, create match_id, etc.) ...

    // PHASE 1: Already complete (ZIP/XML/locks happened in caller)
    emit_phase_progress(app, file_index, total_files, file_name,
                       "Extracting and setting up", 1, TOTAL_PHASES, batch_start_time);

    // ... existing foundation entity parsing code ...

    // PHASE 2: Foundation entities complete
    emit_phase_progress(app, file_index, total_files, file_name,
                       "Parsing foundation entities", 2, TOTAL_PHASES, batch_start_time);

    // Parse aggregate unit production data
    log::info!("Parsing aggregate unit production data...");
    let t_units = Instant::now();
    let player_units_count = super::entities::parse_player_units_produced(doc, tx, &id_mapper)?;
    let city_units_count = super::entities::parse_city_units_produced(doc, tx, &id_mapper)?;

    // PHASE 3: Unit production complete
    emit_phase_progress(app, file_index, total_files, file_name,
                       "Parsing unit production", 3, TOTAL_PHASES, batch_start_time);

    // Parse player-nested gameplay data
    log::info!("Parsing player-nested gameplay data...");
    let t_gameplay = Instant::now();
    parse_player_gameplay_data(doc, tx, &id_mapper)?;

    // PHASE 4: Gameplay data complete
    emit_phase_progress(app, file_index, total_files, file_name,
                       "Parsing gameplay data", 4, TOTAL_PHASES, batch_start_time);

    // Parse game-level diplomacy
    log::info!("Parsing diplomacy...");
    let t_diplomacy = Instant::now();
    let diplomacy_count = super::entities::parse_diplomacy(doc, tx, &id_mapper, match_id)?;

    // PHASE 5: Diplomacy complete
    emit_phase_progress(app, file_index, total_files, file_name,
                       "Parsing diplomacy", 5, TOTAL_PHASES, batch_start_time);

    // Parse time-series data
    log::info!("Parsing time-series data...");
    let t_timeseries = Instant::now();
    parse_timeseries_data(doc, tx, &id_mapper)?;

    // PHASE 6: Time-series complete
    emit_phase_progress(app, file_index, total_files, file_name,
                       "Parsing time-series data", 6, TOTAL_PHASES, batch_start_time);

    // Parse character extended data
    log::info!("Parsing character extended data (stats, traits, relationships)...");
    let t_char_ext = Instant::now();
    parse_character_extended_data_all(doc, tx, &id_mapper)?;

    // Parse city extended data
    log::info!("Parsing city extended data (production, culture, happiness)...");
    let t_city_ext = Instant::now();
    parse_city_extended_data_all(doc, tx, &id_mapper)?;

    // PHASE 7: Character & city extended complete
    emit_phase_progress(app, file_index, total_files, file_name,
                       "Parsing character and city data", 7, TOTAL_PHASES, batch_start_time);

    // Parse tile extended data
    log::info!("Parsing tile extended data (visibility, history)...");
    let t_tile_ext = Instant::now();
    parse_tile_extended_data_all(doc, tx, &id_mapper)?;

    // Parse event stories
    log::info!("Parsing event stories...");
    let t_events = Instant::now();
    parse_event_stories(doc, tx, &id_mapper)?;

    // Save ID mappings
    let t_id_save = Instant::now();
    id_mapper.save_mappings(tx)?;

    // PHASE 8: Complete
    emit_phase_progress(app, file_index, total_files, file_name,
                       "Finalizing", 8, TOTAL_PHASES, batch_start_time);

    Ok(ImportResult {
        success: true,
        match_id: Some(match_id),
        game_id: game_id.to_string(),
        is_new: true,
        error: None,
    })
}
```

### 5. Update `import_save_file_cmd` Command

**File**: `src-tauri/src/lib.rs` (lines 168-177)

This command is for single-file imports. Since it doesn't use the batch system, it won't have intra-file progress. No changes needed (YAGNI principle - single file imports are fast anyway).

### 6. Frontend Changes

**Files**: Components that display the import progress modal

#### Update TypeScript types (auto-generated):

After making Rust changes, run:

```bash
cargo test --lib export_bindings
```

This regenerates `src/lib/types/ImportProgress.ts` with the new fields.

#### Update progress display component:

Add display for `current_phase` if present:

```typescript
{#if progress.current_phase}
  <div class="text-sm text-tan-dark mt-2">
    {progress.current_phase}
  </div>
{/if}
```

The progress bar calculation should remain the same - it already uses `current / total`, which now includes fractional progress thanks to the updated calculations in `emit_phase_progress()`.

#### Optional: Show file-level progress:

If you want to show "File 2 of 10 (45%)" separately from the overall progress:

```typescript
{#if progress.file_progress != null}
  <div class="text-xs text-tan-dark">
    File {progress.current} of {progress.total}
    ({Math.round(progress.file_progress * 100)}%)
  </div>
{/if}
```

## Testing

### Manual Testing

1. Import a single large file - verify phase names appear and progress bar moves smoothly
2. Import multiple small files - verify transitions between files work correctly
3. Import mixed sizes - verify overall ETA remains accurate

### Verification Points

- Progress bar never goes backward
- Phase names are grammatically correct and make sense to users
- Speed and ETA calculations remain stable
- No noticeable performance degradation

## Future Enhancements (YAGNI - Don't Implement Now)

- Sub-phase progress within slow phases (e.g., character parsing could report every 100 characters)
- Time-based adaptive emission (only emit if >200ms elapsed)
- Weighted phase durations (some phases are slower than others)
- Cancel/pause functionality

## Key Design Decisions

**Why 8 phases?**

- Natural groupings in the existing code structure
- Enough granularity for meaningful feedback
- Low enough overhead to be negligible

**Why not time-based?**

- More complex to implement
- Less accurate (progress could move unevenly)
- Harder to test and debug

**Why optional fields instead of separate event types?**

- DRY: Reuse existing `ImportProgress` struct and event handling
- Simpler frontend: One event listener handles all progress updates
- Type safety: Frontend gets all fields in one interface

**Why calculate speed/ETA in the helper?**

- DRY: Single source of truth for progress calculations
- Consistency: Same formula used for all phase emissions
- Accuracy: Includes fractional file progress in calculations
