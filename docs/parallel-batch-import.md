# Parallel Batch Import Architecture

**Date**: November 7, 2025
**Status**: Proposed
**Dependencies**: Requires hybrid parser architecture (see `hybrid_parser_architecture.md`)

---

## Problem Statement

### User Pain Point

Users need to import large numbers of save files:
- **Initial onboarding**: 76-266 completed saves to import
- **Ongoing usage**: 1-3 new saves per week
- **Current performance**: ~213ms per save = 56 seconds for 266 saves (unacceptable UX)

### Root Cause

Current sequential import architecture:
1. Parse save file (CPU-bound) → 106ms
2. Insert to database (IO-bound) → 50ms
3. **Repeat for each file sequentially**

This is inefficient because:
- Parsing is CPU-bound and embarrassingly parallel
- We have 4-8 CPU cores sitting idle
- Database insertion time could be overlapped with parsing

---

## Solution: Two-Stage Pipeline Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────┐
│  Stage 1: Parallel Parsing (CPU-bound)             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ Parse    │  │ Parse    │  │ Parse    │         │
│  │ Save 1   │  │ Save 2   │  │ Save 3   │ ...     │
│  │  50ms    │  │  50ms    │  │  50ms    │         │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘         │
│       │             │             │                 │
│       └─────────────┴─────────────┘                │
│                     ▼                               │
│              ┌──────────────┐                       │
│              │ GameData     │                       │
│              │ Queue        │                       │
│              └──────┬───────┘                       │
└─────────────────────┼───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│  Stage 2: Sequential Insertion (IO-bound)          │
│  ┌──────────────────────────────────────────────┐  │
│  │  for each GameData:                          │  │
│  │    1. Begin transaction                      │  │
│  │    2. Insert to DuckDB (~50ms)              │  │
│  │    3. Commit transaction (atomic!)          │  │
│  │    4. Update progress UI                     │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Why This Works

1. **Parsing is parallelizable**: No shared state, pure functions after hybrid parser
2. **Insertion stays atomic**: Each save gets its own transaction, rollback on failure
3. **Pipeline overlap**: While batch N is parsing, batch N-1 is being inserted
4. **Memory bounded**: Control batch size to limit concurrent GameData structs in memory

---

## Performance Analysis

### Current Sequential (Baseline)

```
Per-save time: 213ms
76 saves:  76 × 213ms = 16.2 seconds
266 saves: 266 × 213ms = 56.6 seconds
```

### Hybrid Parser (Sequential)

```
Per-save time: 157ms (faster parsing)
76 saves:  76 × 157ms = 11.9 seconds
266 saves: 266 × 157ms = 41.8 seconds
Improvement: 26% faster
```

### Hybrid Parser + Parallel Batch Import (4 cores)

```
Parsing (parallel):   4 saves × 50ms = 50ms (wall time)
Insertion (queued):   4 saves × 50ms = 200ms (wall time)

Pipeline efficiency with 8-save batches:
┌─────────────┬─────────────┬─────────────┬─────────────┐
│  Batch 1    │  Batch 2    │  Batch 3    │  Batch 4    │
├─────────────┼─────────────┼─────────────┼─────────────┤
│ Parse 50ms  │ Parse 50ms  │ Parse 50ms  │ Parse 50ms  │
│ Insert 200ms│ Insert 200ms│ Insert 200ms│ Insert 200ms│
└─────────────┴─────────────┴─────────────┴─────────────┘
   │               │
   │ ──overlap──▶  │ (while Batch 1 inserts, Batch 2 parses)

Effective time per batch: ~200ms (insertion dominates)
Effective time per save: 200ms / 4 saves = 50ms

76 saves:  76 × 50ms = 3.8 seconds   ✅ 4.3x faster
266 saves: 266 × 50ms = 13.3 seconds ✅ 4.3x faster
```

**Speedup**: 4.3x faster than current, 3.1x faster than hybrid-only

---

## Implementation Design

### Rust Backend API

#### New Tauri Command

```rust
// src-tauri/src/lib.rs

#[derive(Debug, Clone, Serialize)]
pub struct BatchImportProgress {
    pub total_files: usize,
    pub completed: usize,
    pub current_file: String,
    pub failed_files: Vec<(String, String)>, // (filename, error)
}

#[tauri::command]
async fn import_saves_batch(
    app_handle: tauri::AppHandle,
    file_paths: Vec<String>,
) -> Result<BatchImportResult, String> {
    use crate::parser::{parse_save_batch, insert_game_data_batch};
    use crate::db::connection::get_connection;

    let total = file_paths.len();
    let mut results = Vec::new();
    let mut failed = Vec::new();

    // Stage 1: Parallel parsing (4-8 at a time)
    let batch_size = num_cpus::get();
    let mut parsed_saves = Vec::new();

    for (batch_idx, chunk) in file_paths.chunks(batch_size).enumerate() {
        log::info!("Parsing batch {} ({} files)", batch_idx + 1, chunk.len());

        // Parse this batch in parallel
        let batch_results: Vec<_> = chunk
            .par_iter()
            .map(|path| {
                match parse_save_file(path) {
                    Ok(game_data) => Ok((path.clone(), game_data)),
                    Err(e) => Err((path.clone(), e.to_string()))
                }
            })
            .collect();

        // Separate successes from failures
        for result in batch_results {
            match result {
                Ok((path, game_data)) => parsed_saves.push((path, game_data)),
                Err((path, error)) => failed.push((path, error)),
            }
        }
    }

    log::info!("Parsed {}/{} saves successfully", parsed_saves.len(), total);

    // Stage 2: Sequential insertion with progress updates
    let conn = get_connection()?;

    for (idx, (path, game_data)) in parsed_saves.iter().enumerate() {
        // Emit progress event to frontend
        let _ = app_handle.emit_all("import-progress", BatchImportProgress {
            total_files: total,
            completed: idx,
            current_file: path.clone(),
            failed_files: failed.clone(),
        });

        // Insert to database (atomic transaction per save)
        match insert_save_to_db(&conn, game_data, path) {
            Ok(match_id) => {
                results.push(ImportResult {
                    match_id,
                    file_path: path.clone(),
                });
            }
            Err(e) => {
                failed.push((path.clone(), e.to_string()));
            }
        }
    }

    // Final progress update
    let _ = app_handle.emit_all("import-progress", BatchImportProgress {
        total_files: total,
        completed: parsed_saves.len(),
        current_file: String::new(),
        failed_files: failed.clone(),
    });

    Ok(BatchImportResult {
        successful: results,
        failed,
    })
}
```

#### Parser Functions

```rust
// src-tauri/src/parser/import.rs

use rayon::prelude::*;
use crate::parser::game_data::GameData;

/// Parse a single save file to GameData struct (no DB access)
pub fn parse_save_file(file_path: &str) -> Result<GameData> {
    let xml_content = validate_and_extract_xml(file_path)?;
    let doc = parse_xml(xml_content)?;
    parse_save_to_structs(&doc)  // Pure function, no DB!
}

/// Insert parsed GameData to database (atomic transaction)
pub fn insert_save_to_db(
    conn: &Connection,
    game_data: &GameData,
    file_path: &str,
) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;

    // Extract match_id from game_data or generate
    let match_id = generate_match_id(&tx)?;

    // Insert all game data
    insert_game_data(&tx, game_data, match_id)?;

    // Save metadata
    save_import_metadata(&tx, match_id, file_path)?;

    tx.commit()?;

    Ok(match_id)
}
```

### Frontend Integration

#### API Layer

```typescript
// src/lib/api.ts

export interface BatchImportProgress {
  totalFiles: number;
  completed: number;
  currentFile: string;
  failedFiles: Array<[string, string]>;
}

export interface BatchImportResult {
  successful: Array<{ matchId: number; filePath: string }>;
  failed: Array<[string, string]>;
}

export const api = {
  // ... existing commands ...

  importSavesBatch: (filePaths: string[]) =>
    invoke<BatchImportResult>("import_saves_batch", { filePaths }),
} as const;
```

#### Progress UI Component

```svelte
<!-- src/lib/components/BatchImportProgress.svelte -->
<script lang="ts">
  import { listen } from "@tauri-apps/api/event";
  import { onMount, onDestroy } from "svelte";
  import type { BatchImportProgress } from "$lib/api";

  let progress = $state<BatchImportProgress>({
    totalFiles: 0,
    completed: 0,
    currentFile: "",
    failedFiles: [],
  });

  let unlisten: (() => void) | null = null;

  onMount(async () => {
    unlisten = await listen<BatchImportProgress>("import-progress", (event) => {
      progress = event.payload;
    });
  });

  onDestroy(() => {
    if (unlisten) unlisten();
  });

  $derived percentage = progress.totalFiles > 0
    ? (progress.completed / progress.totalFiles) * 100
    : 0;
</script>

<div class="import-progress">
  <div class="progress-header">
    <h3>Importing Save Files</h3>
    <span class="progress-count">
      {progress.completed} / {progress.totalFiles}
    </span>
  </div>

  <div class="progress-bar-container">
    <div class="progress-bar" style="width: {percentage}%"></div>
  </div>

  {#if progress.currentFile}
    <p class="current-file">
      Importing: <span class="filename">{progress.currentFile}</span>
    </p>
  {/if}

  {#if progress.failedFiles.length > 0}
    <details class="failed-imports">
      <summary>
        {progress.failedFiles.length} failed import{progress.failedFiles.length !== 1 ? 's' : ''}
      </summary>
      <ul>
        {#each progress.failedFiles as [file, error]}
          <li>
            <strong>{file}:</strong> {error}
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</div>

<style>
  .import-progress {
    padding: 1rem;
    background: var(--color-tan);
    border: 2px solid var(--color-brown);
    border-radius: 4px;
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .progress-bar-container {
    width: 100%;
    height: 24px;
    background: var(--color-sand);
    border: 1px solid var(--color-brown);
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    background: var(--color-brown);
    transition: width 0.3s ease;
  }

  .current-file {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: var(--color-brown);
  }

  .filename {
    font-family: monospace;
    font-weight: bold;
  }

  .failed-imports {
    margin-top: 1rem;
    padding: 0.5rem;
    background: rgba(255, 0, 0, 0.1);
    border-radius: 4px;
  }

  .failed-imports summary {
    cursor: pointer;
    font-weight: bold;
    color: #d32f2f;
  }

  .failed-imports ul {
    margin-top: 0.5rem;
    padding-left: 1.5rem;
  }

  .failed-imports li {
    margin-bottom: 0.25rem;
    font-size: 0.875rem;
  }
</style>
```

#### Import Page

```svelte
<!-- src/routes/import/+page.svelte -->
<script lang="ts">
  import { api } from "$lib/api";
  import { open } from "@tauri-apps/plugin-dialog";
  import BatchImportProgress from "$lib/components/BatchImportProgress.svelte";

  let isImporting = $state(false);
  let importResult = $state<BatchImportResult | null>(null);

  async function selectAndImportSaves() {
    const files = await open({
      multiple: true,
      filters: [{
        name: "Old World Saves",
        extensions: ["zip"]
      }]
    });

    if (!files || files.length === 0) return;

    isImporting = true;

    try {
      importResult = await api.importSavesBatch(files);
    } catch (error) {
      console.error("Batch import failed:", error);
      alert(`Import failed: ${error}`);
    } finally {
      isImporting = false;
    }
  }
</script>

<div class="import-page">
  <h1>Import Save Files</h1>

  {#if !isImporting && !importResult}
    <button onclick={selectAndImportSaves}>
      Select Save Files to Import
    </button>
  {/if}

  {#if isImporting}
    <BatchImportProgress />
  {/if}

  {#if importResult}
    <div class="import-results">
      <h2>Import Complete</h2>
      <p>Successfully imported {importResult.successful.length} save(s)</p>

      {#if importResult.failed.length > 0}
        <p class="error">
          Failed to import {importResult.failed.length} save(s)
        </p>
      {/if}

      <button onclick={() => importResult = null}>
        Import More Saves
      </button>
    </div>
  {/if}
</div>
```

---

## Memory Management

### Memory Usage Per Save

From hybrid parser architecture doc:
```
GameData struct: ~60MB per save (compressed in memory)
```

### Batch Size Calculation

```rust
// src-tauri/src/parser/batch.rs

fn calculate_optimal_batch_size() -> usize {
    let available_cpus = num_cpus::get();
    let available_memory = sys_info::mem_info()
        .map(|info| info.avail * 1024)
        .unwrap_or(4 * 1024 * 1024 * 1024); // Default to 4GB

    // Reserve 60MB per GameData struct + 500MB for overhead
    let memory_per_save = 60 * 1024 * 1024;
    let memory_overhead = 500 * 1024 * 1024;
    let max_by_memory = ((available_memory - memory_overhead) / memory_per_save) as usize;

    // Use fewer of: CPU cores or memory-constrained batch size
    // But minimum of 2, maximum of 16
    available_cpus.min(max_by_memory).max(2).min(16)
}
```

### Streaming for Very Large Batches

If importing 200+ saves, process in chunks:

```rust
pub async fn import_saves_batch_streaming(
    app_handle: tauri::AppHandle,
    file_paths: Vec<String>,
) -> Result<BatchImportResult> {
    let batch_size = calculate_optimal_batch_size();
    let conn = get_connection()?;

    let mut successful = Vec::new();
    let mut failed = Vec::new();

    // Process in chunks to avoid loading all GameData at once
    for (chunk_idx, chunk) in file_paths.chunks(batch_size * 4).enumerate() {
        log::info!("Processing chunk {} ({} files)", chunk_idx + 1, chunk.len());

        // Parse batch in parallel
        let parsed = parse_saves_parallel(chunk)?;

        // Insert batch sequentially
        for (path, game_data) in parsed {
            match insert_save_to_db(&conn, &game_data, &path) {
                Ok(match_id) => successful.push((match_id, path)),
                Err(e) => failed.push((path, e.to_string())),
            }

            // Update progress after each insert
            emit_progress_event(&app_handle, &successful, &failed, file_paths.len());
        }
    }

    Ok(BatchImportResult { successful, failed })
}
```

---

## Error Handling Strategy

### Parse Errors

**Philosophy**: One bad save shouldn't block the entire batch

```rust
// Continue parsing remaining saves even if one fails
let batch_results: Vec<_> = chunk
    .par_iter()
    .map(|path| {
        match parse_save_file(path) {
            Ok(game_data) => Ok((path.clone(), game_data)),
            Err(e) => {
                log::warn!("Failed to parse {}: {}", path, e);
                Err((path.clone(), e.to_string()))
            }
        }
    })
    .collect();
```

### Insert Errors

**Philosophy**: Each save gets its own transaction, isolated failures

```rust
for (path, game_data) in parsed_saves {
    // Each save has its own transaction
    match insert_save_to_db(&conn, &game_data, &path) {
        Ok(match_id) => {
            successful.push(match_id);
        }
        Err(e) => {
            // Transaction rolled back automatically
            // Save continues to next file
            log::error!("Failed to insert {}: {}", path, e);
            failed.push((path.clone(), e.to_string()));
        }
    }
}
```

### User Experience

- Show which files failed and why
- Allow user to retry failed imports individually
- Don't block on failures - import as much as possible

---

## Testing Strategy

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_save_file_no_db() {
        let path = "test-data/saves/OW-Assyria-Year119-2025-11-02-10-50-56.zip";
        let game_data = parse_save_file(path).unwrap();

        assert!(game_data.players.len() > 0);
        assert!(game_data.characters.len() > 0);
        // No database needed! ✅
    }

    #[test]
    fn test_parallel_parse_isolation() {
        let paths = vec![
            "test-data/saves/save1.zip",
            "test-data/saves/save2.zip",
            "test-data/saves/save3.zip",
        ];

        // Parse in parallel - should not interfere with each other
        let results: Vec<_> = paths
            .par_iter()
            .map(|p| parse_save_file(p))
            .collect();

        // All should succeed independently
        assert_eq!(results.len(), 3);
        for result in results {
            assert!(result.is_ok());
        }
    }
}
```

### Integration Tests

```rust
#[test]
fn test_batch_import_atomicity() {
    let conn = Connection::open_in_memory().unwrap();
    setup_schema(&conn).unwrap();

    let saves = vec![
        parse_save_file("test-data/saves/save1.zip").unwrap(),
        parse_save_file("test-data/saves/invalid.zip").unwrap_err(), // Will fail
        parse_save_file("test-data/saves/save3.zip").unwrap(),
    ];

    // Import batch
    let results = insert_saves_batch(&conn, &saves);

    // Should have imported 2 successfully, 1 failed
    assert_eq!(results.successful.len(), 2);
    assert_eq!(results.failed.len(), 1);

    // Verify database state
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM games",
        [],
        |r| r.get(0)
    ).unwrap();
    assert_eq!(count, 2); // Only successful imports
}
```

### Benchmark Tests

```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn bench_batch_import(c: &mut Criterion) {
    let saves: Vec<_> = (1..=50)
        .map(|i| format!("test-data/saves/save{}.zip", i))
        .collect();

    let mut group = c.benchmark_group("batch_import");

    group.bench_function("sequential", |b| {
        b.iter(|| {
            for path in &saves {
                let data = parse_save_file(black_box(path)).unwrap();
                insert_save_to_db(&conn, &data, path).unwrap();
            }
        })
    });

    group.bench_function("parallel_batch", |b| {
        b.iter(|| {
            import_saves_batch_streaming(black_box(&saves)).unwrap();
        })
    });

    group.finish();
}
```

---

## Migration Path

### Phase 1: Implement Hybrid Parser (Week 1-5)

From `hybrid_parser_architecture.md`:
1. Create GameData structs
2. Create pure parser functions
3. Create inserter functions
4. Migrate all entity parsers

**Prerequisite for parallel batch import**

### Phase 2: Add Batch Import Backend (Week 6)

1. Implement `parse_save_file()` function
2. Implement `import_saves_batch()` Tauri command
3. Add memory management logic
4. Write tests

### Phase 3: Add Batch Import UI (Week 7)

1. Create `BatchImportProgress` component
2. Add event listener for progress updates
3. Update import page UI
4. Add error display

### Phase 4: Optimize & Polish (Week 8)

1. Benchmark real-world performance
2. Tune batch size based on profiling
3. Add retry logic for failed imports
4. Add "import folder" feature

---

## Performance Targets

### Success Criteria

| Scenario | Current | Target | Improvement |
|----------|---------|--------|-------------|
| 1 save | 213ms | 157ms | 1.4x faster |
| 10 saves | 2.1s | 0.8s | 2.6x faster |
| 76 saves | 16.2s | 3.8s | 4.3x faster |
| 266 saves | 56.6s | 13.3s | 4.3x faster |

**Primary goal**: Import 266 saves in under 15 seconds ✅

---

## Open Questions

1. **Should we cache parsed GameData to disk?**
   - Pro: Faster re-imports if DB corrupted
   - Con: Disk space (60MB × 266 = 16GB!)
   - Recommendation: Optional feature, off by default

2. **Should we deduplicate imports?**
   - Check if save already imported before parsing
   - Use file hash or game metadata
   - Recommendation: Yes, add duplicate detection

3. **Should we support "watch folder" for auto-import?**
   - Monitor saves directory, auto-import new files
   - Recommendation: Future enhancement, not v1

4. **Memory pressure handling?**
   - What if system has < 2GB available?
   - Recommendation: Fallback to smaller batch sizes, warn user

---

## Appendix: Alternative Designs Considered

### Alternative 1: Fully Parallel (DB per Thread)

```rust
// Open separate DB connection per thread
rayon::scope(|s| {
    for path in &file_paths {
        s.spawn(|_| {
            let conn = Connection::open("per-ankh.db").unwrap();
            let data = parse_and_insert(path, &conn).unwrap();
        });
    }
});
```

**Rejected because**:
- DuckDB connection pool complexity
- Lock contention on single DB file
- No atomicity guarantee
- Marginal benefit over sequential insertion

### Alternative 2: Parse-and-Insert Interleaved

```rust
// Parse one, insert one, repeat
for path in file_paths {
    let data = parse_save_file(path)?;
    insert_save_to_db(&conn, &data, path)?;
}
```

**Rejected because**:
- No parallelism benefit
- Simpler but much slower
- Doesn't address user pain point

### Alternative 3: Background Thread Pool

```rust
// Queue all imports to background thread pool
for path in file_paths {
    thread_pool.execute(move || {
        import_save_file(path);
    });
}
```

**Rejected because**:
- Progress tracking complexity
- Error handling complexity
- No clear advantage over two-stage pipeline

---

## Summary

The parallel batch import architecture leverages the hybrid parser to achieve:

✅ **4.3x faster** batch imports (56s → 13s for 266 saves)
✅ **Atomic per-save transactions** (rollback on failure)
✅ **Memory efficient** (bounded by batch size)
✅ **Progressive UX** (real-time progress updates)
✅ **Robust error handling** (one bad save doesn't block batch)

**Next Steps**:
1. Complete hybrid parser migration (Weeks 1-5)
2. Implement batch import backend (Week 6)
3. Build batch import UI (Week 7)
4. Benchmark and optimize (Week 8)
