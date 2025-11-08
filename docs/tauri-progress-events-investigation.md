# Tauri 2.x Progress Events Investigation

**Date**: 2025-11-08
**Status**: Real-time progress events not working; using workaround
**Tauri Version**: 2.x
**Issue**: Backend successfully emits events, but frontend never receives them

## Goal

Implement real-time progress tracking for the file import feature, showing users:
- Current file being processed
- Progress bar (X of Y files)
- Elapsed time
- Estimated time remaining
- Import speed (files/sec)

## Architecture

### Backend (Rust)
Location: `src-tauri/src/lib.rs` - `import_files_batch()` function

The backend:
1. Iterates through files sequentially
2. Imports each file using `parser::import_save_file()`
3. Calculates progress metrics (current/total, elapsed, ETA, speed)
4. Creates `ImportProgress` struct with metrics
5. Emits event after each file completes
6. Returns `BatchImportResult` when all files are done

### Frontend (Svelte/TypeScript)
Location: `src/lib/Header.svelte` and `src/lib/ImportModal.svelte`

The frontend:
1. Sets up event listener before starting import
2. Opens modal when first progress event arrives
3. Updates progress UI as events arrive
4. Shows final results when import completes

## What We Tried

### Attempt 1: Basic `app.emit()`
**Backend**:
```rust
app.emit("import-progress", &progress)
```

**Frontend**:
```typescript
import { listen } from "@tauri-apps/api/event";
unlisten = await listen("import-progress", (event) => { ... });
```

**Result**: ❌ Events not received
**Backend Logs**: "Progress event emitted successfully"
**Frontend Logs**: No "Progress event received" logs

### Attempt 2: Window-specific emission
**Backend**:
```rust
app.emit_to("main", "import-progress", &progress)
```

**Frontend**: Same as Attempt 1

**Result**: ❌ Events not received
**Issue**: Window might not have label "main"

### Attempt 3: Get first window and emit to it
**Backend**:
```rust
match app.webview_windows().values().next() {
    Some(window) => {
        window.emit("import-progress", &progress)
    }
    None => { ... }
}
```

**Frontend**:
```typescript
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
const appWindow = getCurrentWebviewWindow();
unlisten = await appWindow.listen("import-progress", (event) => { ... });
```

**Result**: ❌ Events not received
**Backend Logs**: "Progress event emitted successfully to window"
**Frontend Logs**: Still no events received

### Attempt 4: EventTarget::Any (Current attempt)
**Backend**:
```rust
app.emit_to(tauri::EventTarget::Any, "import-progress", &progress)
```

**Frontend**: Back to global `listen()`
```typescript
import { listen } from "@tauri-apps/api/event";
unlisten = await listen("import-progress", (event) => { ... });
```

**Result**: ❌ Events still not received
**Backend Logs**: "Progress event emitted successfully"
**Frontend Logs**: No events received

## What We Verified

✅ Backend IS emitting events (confirmed via backend logs)
✅ Backend imports ARE working (files successfully imported to database)
✅ Frontend listener IS being set up (confirmed via console logs)
✅ Frontend CAN receive the final result (BatchImportResult works)
✅ Modal rendering works (when manually opened or with result)
✅ Hot reload is working (Vite shows module updates)

❌ Events are NOT crossing the Rust → JavaScript bridge
❌ No errors in backend or frontend logs
❌ No network/IPC errors visible

## Current Workaround

Since real-time events don't work, we implemented a simpler solution:

**Frontend** (`src/lib/Header.svelte`):
```typescript
async function handleImportFiles() {
  // Show modal immediately with generic "Importing..." message
  isImportModalOpen = true;

  // Start import (blocking call)
  const result = await api.importFiles();

  // Update modal with results
  importResult = result;
}
```

**Modal States**:
1. No result yet → Shows "Importing... Please wait"
2. Result available → Shows "Import Complete!" with stats

**User Experience**:
- ✅ User gets immediate feedback (modal appears)
- ✅ User sees results when complete
- ❌ No real-time progress updates
- ❌ No ETA or current file name
- ❌ Appears frozen during 20-40 second import

## Possible Future Solutions

### 1. Investigate Tauri 2.x Event System Changes
Tauri 2.x made significant changes to the event system. Check:
- Official migration guide for event API changes
- Tauri 2.x examples for event emission patterns
- GitHub issues related to event delivery in Tauri 2.x

### 2. Try Different Event Scopes
Tauri has multiple event scopes:
```rust
// App-level events
app.emit(...)

// Window-level events
window.emit(...)

// Webview-level events
webview.emit(...)
```

Try each systematically with matching frontend listeners.

### 3. Use Tauri's State Management
Instead of events, use Tauri's state management:

**Backend**:
```rust
#[tauri::command]
async fn get_import_progress(state: State<ImportState>) -> ImportProgress {
    state.current_progress.lock().unwrap().clone()
}
```

**Frontend**: Poll every 500ms
```typescript
const interval = setInterval(async () => {
    const progress = await invoke("get_import_progress");
    updateUI(progress);
}, 500);
```

### 4. Use WebSockets
Bypass Tauri events entirely:
- Backend opens WebSocket server
- Frontend connects and receives progress updates
- More complex but more reliable

### 5. Server-Sent Events (SSE)
Similar to WebSockets but simpler:
- Backend creates SSE endpoint
- Frontend uses EventSource API
- One-way communication (server → client)

### 6. Check CSP Settings
Content Security Policy might be blocking events:

**Check**: `src-tauri/tauri.conf.json`
```json
{
  "tauri": {
    "security": {
      "csp": null  // Currently set to null
    }
  }
}
```

Try explicitly allowing required protocols.

### 7. Add Middleware/Debugging
Instrument the event pipeline:

**Backend**:
```rust
// Add detailed logging
log::info!("Event channel: {:?}", app.event_channel());
log::info!("Windows: {:?}", app.webview_windows().keys());
```

**Frontend**:
```typescript
// Try catching ALL events
listen("*", (event) => {
    console.log("Any event received:", event);
});
```

## Files Modified

### Backend
- `src-tauri/src/lib.rs` - Event emission in `import_files_batch()`
- `src-tauri/Cargo.toml` - Added `tauri-plugin-dialog = "2"`

### Frontend
- `src/lib/Header.svelte` - Import handling and modal control
- `src/lib/ImportModal.svelte` - Progress/results display
- `src/lib/api.ts` - Added `importFiles()` and `importDirectory()` commands
- `package.json` - Added `"@tauri-apps/plugin-dialog": "^2"`

### Generated Types
- `src/lib/types/ImportProgress.ts`
- `src/lib/types/BatchImportResult.ts`
- `src/lib/types/FileImportError.ts`

## Key Code Locations

**Backend event emission**: `src-tauri/src/lib.rs:635-643`
```rust
app.emit_to(tauri::EventTarget::Any, "import-progress", &progress)
```

**Frontend event listening**: `src/lib/Header.svelte:34-43` (currently disabled)
```typescript
unlisten = await listen<ImportProgress>("import-progress", (event) => {
    importProgress = event.payload;
});
```

**Modal rendering**: `src/lib/ImportModal.svelte:85-186`

## Debugging Checklist for Next Attempt

Before trying to fix this again:

1. ✅ Verify Tauri version: `cargo tree | grep tauri`
2. ✅ Check Tauri changelog for event system changes
3. ⬜ Search Tauri Discord for similar issues
4. ⬜ Check Tauri GitHub issues: "events not received"
5. ⬜ Try minimal reproduction in new Tauri project
6. ⬜ Enable verbose Tauri logging
7. ⬜ Use browser DevTools Network tab to inspect IPC
8. ⬜ Check if other Tauri events work (e.g., window events)

## References

- Tauri Events Documentation: https://tauri.app/v2/reference/javascript/api/namespaces/event/
- Tauri Migration Guide: https://tauri.app/v2/guides/upgrade-migrate/
- Event Emit API: https://tauri.app/v2/reference/javascript/api/namespaces/event/#listen
