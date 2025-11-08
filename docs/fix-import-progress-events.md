# Fix Import Progress Events - Implementation Plan

**Date**: 2025-11-08
**Status**: Ready to implement
**Validation**: Event test in `/event-test` confirms events work correctly

## Problem

Import progress events are emitted but never received by frontend because the command handler blocks the Tauri event loop. See `docs/tauri-progress-events-investigation.md` for background.

## Root Cause

The `import_files_batch()` function does synchronous blocking work in a loop, preventing event delivery until the entire import completes.

## Solution

Return the command immediately and spawn a thread to do the work + emit events.

## Implementation Steps

### 1. Refactor Backend Event Emission

**File**: `src-tauri/src/lib.rs`

**Current** (lines 516-547):
```rust
#[tauri::command]
async fn import_files_cmd(
    app: tauri::AppHandle,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<BatchImportResult, String> {
    // ... file picker code ...
    import_files_batch(files_pathbuf, app, pool).await
}
```

**New**:
```rust
#[tauri::command]
async fn import_files_cmd(
    app: tauri::AppHandle,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let files = app.dialog().file()
        .set_title("Select Save Files to Import")
        .add_filter("Old World Save Files", &["zip"])
        .blocking_pick_files();

    let files = match files {
        Some(files) => files,
        None => return Err("No files selected".to_string()),
    };

    if files.is_empty() {
        return Err("No files selected".to_string());
    }

    let files_pathbuf: Vec<PathBuf> = files
        .iter()
        .filter_map(|f| f.as_path().map(|p| p.to_path_buf()))
        .collect();

    // Spawn thread for actual work
    std::thread::spawn(move || {
        import_files_batch(files_pathbuf, app, pool);
    });

    Ok("Import started".to_string())
}
```

Apply same pattern to `import_directory_cmd` (lines 465-511).

**Change `import_files_batch` signature** (line 550):
```rust
// Remove async, change return type
fn import_files_batch(
    files: Vec<PathBuf>,
    app: tauri::AppHandle,
    pool: tauri::State<'_, db::connection::DbPool>,
) {
    // Keep same logic, just remove Result wrapper
    // Emit final event instead of returning result
}
```

**At end of `import_files_batch`** (replace return statement at line 648):
```rust
let final_result = BatchImportResult {
    total_files: total,
    successful,
    failed,
    skipped,
    errors,
    duration_ms: start_time.elapsed().as_millis() as u64,
};

// Emit completion event
if let Err(e) = app.emit("import-complete", &final_result) {
    log::error!("Failed to emit completion event: {}", e);
}
```

**Simplify event emission** (line 640):
```rust
// Change from:
app.emit_to(tauri::EventTarget::Any, "import-progress", &progress)

// To:
if let Err(e) = app.emit("import-progress", &progress) {
    log::error!("Failed to emit progress event: {}", e);
}
// Don't return error - continue importing
```

### 2. Update Frontend to Handle Completion Event

**File**: `src/lib/Header.svelte`

**Replace `handleImportFiles()`** (lines 22-45):
```typescript
async function handleImportFiles() {
  isSettingsOpen = false;
  importProgress = null;
  importResult = null;
  isImportModalOpen = true;

  try {
    // This now returns immediately
    await api.importFiles();
    // Modal stays open, listening for events
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes("No files selected") || errorMsg.includes("cancelled")) {
      isImportModalOpen = false;
    }
  }
}
```

**Add event listeners in onMount** (after existing code around line 64):
```typescript
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

let progressUnlisten: UnlistenFn | null = null;
let completeUnlisten: UnlistenFn | null = null;

onMount(async () => {
  // Listen for progress events
  progressUnlisten = await listen<ImportProgress>("import-progress", (event) => {
    importProgress = event.payload;
  });

  // Listen for completion event
  completeUnlisten = await listen<BatchImportResult>("import-complete", (event) => {
    importResult = event.payload;
  });
});

onDestroy(() => {
  if (progressUnlisten) progressUnlisten();
  if (completeUnlisten) completeUnlisten();
});
```

**Add import statements** (top of file):
```typescript
import { onMount, onDestroy } from "svelte";
```

### 3. Update ImportModal to Show Real-time Progress

**File**: `src/lib/ImportModal.svelte`

The modal already handles `initialProgress` prop correctly. Just verify it displays:
- `progress.current` / `progress.total`
- `progress.current_file`
- `progress.elapsed_ms` and `progress.estimated_remaining_ms`
- `progress.speed`

No changes needed if already implemented.

### 4. Update API Types

**File**: `src/lib/api.ts`

```typescript
// Update return type
importFiles: () =>
  invoke<string>("import_files_cmd"),

importDirectory: () =>
  invoke<string>("import_directory_cmd"),
```

## Testing

1. Start dev server: `npm run tauri dev`
2. Click settings → Import Save Files
3. Select multiple files
4. **Expected behavior**:
   - Modal opens immediately
   - Shows current file name updating in real-time
   - Progress bar moves smoothly
   - Speed/ETA updates every file
   - Final results shown when complete
5. Check backend logs for "Event X/Y emitted successfully"
6. Check frontend console for received events (if you add logging)

## Rollback Plan

If this doesn't work:
1. Revert changes
2. Keep current workaround (modal shows after completion)
3. Document in `tauri-progress-events-investigation.md`

## Reference

Working example: `/event-test` page and `run_event_test` command in `src-tauri/src/lib.rs:661-691`
