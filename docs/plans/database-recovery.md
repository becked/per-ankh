# Database Corruption Recovery

## Phase 1: Improve Error Context

**Files:**

- `src-tauri/src/db/schema.rs` - Add detailed error logging, return original error

**Changes:**

### `src-tauri/src/db/schema.rs`

Update `ensure_schema_ready` to log the actual DuckDB error before returning:

```rust
pub fn ensure_schema_ready(db_path: &Path) -> Result<()> {
    log::info!("ensure_schema_ready called for path: {:?}", db_path);

    let conn = match Connection::open(db_path) {
        Ok(c) => {
            log::info!("Database connection opened successfully");
            c
        }
        Err(e) => {
            log::error!("Failed to open database at {:?}: {}", db_path, e);
            log::error!("This may indicate database corruption. Consider deleting the database file to recover.");
            return Err(e.into());
        }
    };

    // ... rest unchanged
}
```

Remove the `.context("Failed to initialize schema")` wrapper in `lib.rs` setup hook since the error now has sufficient context from the log.

**Test:** Manually corrupt a database file and verify the error message includes the DuckDB error details.

---

## Phase 2: Add Recovery Command

**Files:**

- `src-tauri/src/db/schema.rs` - Add `delete_database_files` function
- `src-tauri/src/db/mod.rs` - Export new function
- `src-tauri/src/lib.rs` - Add `recover_database` Tauri command

**Changes:**

### `src-tauri/src/db/schema.rs`

Add function to delete database and WAL files:

```rust
/// Delete database files for recovery from corruption
///
/// Removes the main database file and any associated WAL/journal files.
/// Returns the paths that were deleted for logging.
pub fn delete_database_files(db_path: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut deleted = Vec::new();

    // Main database file
    if db_path.exists() {
        std::fs::remove_file(db_path)?;
        deleted.push(db_path.to_path_buf());
    }

    // WAL file (DuckDB uses .wal extension)
    let wal_path = db_path.with_extension("db.wal");
    if wal_path.exists() {
        std::fs::remove_file(&wal_path)?;
        deleted.push(wal_path);
    }

    Ok(deleted)
}
```

Unit test:

```rust
#[test]
fn test_delete_database_files() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("test.db");
    let wal_path = dir.path().join("test.db.wal");

    // Create fake files
    std::fs::write(&db_path, b"db").unwrap();
    std::fs::write(&wal_path, b"wal").unwrap();

    let deleted = delete_database_files(&db_path).unwrap();

    assert_eq!(deleted.len(), 2);
    assert!(!db_path.exists());
    assert!(!wal_path.exists());
}

#[test]
fn test_delete_database_files_missing_wal() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("test.db");

    std::fs::write(&db_path, b"db").unwrap();

    let deleted = delete_database_files(&db_path).unwrap();

    assert_eq!(deleted.len(), 1);
    assert!(!db_path.exists());
}
```

### `src-tauri/src/db/mod.rs`

Export the new function:

```rust
pub use schema::{create_schema, delete_database_files, drop_all_schema_objects, ensure_schema_ready};
```

### `src-tauri/src/lib.rs`

Add Tauri command for frontend to trigger recovery:

```rust
#[tauri::command]
async fn recover_database(app_handle: tauri::AppHandle) -> Result<String, String> {
    let db_path = db::connection::get_db_path(&app_handle)
        .map_err(|e| e.to_string())?;

    log::warn!("Database recovery requested, deleting: {:?}", db_path);

    let deleted = db::delete_database_files(&db_path)
        .map_err(|e| format!("Failed to delete database files: {}", e))?;

    log::info!("Deleted {} files: {:?}", deleted.len(), deleted);

    // Reinitialize schema on fresh database
    db::ensure_schema_ready(&db_path)
        .map_err(|e| format!("Failed to reinitialize database: {}", e))?;

    Ok(format!("Database recovered. Deleted {} files.", deleted.len()))
}
```

Register in `tauri::Builder`:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    recover_database,
])
```

---

## Phase 3: Handle Startup Failure with Recovery Dialog

**Files:**

- `src-tauri/src/lib.rs` - Modify setup hook to catch errors and show recovery dialog
- `src-tauri/Cargo.toml` - May need `tauri-plugin-dialog` if not present
- `src-tauri/capabilities/default.json` - Add dialog permission if needed

**Changes:**

### `src-tauri/src/lib.rs`

Modify the setup hook to catch database errors and offer recovery:

```rust
.setup(|app| {
    let db_path = db::connection::get_db_path(app.handle())
        .context("Failed to get database path")
        .map_err(|e| e.to_string())?;

    // Try to initialize schema, offer recovery on failure
    if let Err(e) = db::ensure_schema_ready(&db_path) {
        log::error!("Database initialization failed: {}", e);

        use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

        let confirmed = app.dialog()
            .message(format!(
                "Database initialization failed:\n{}\n\nWould you like to reset the database? All existing data will be lost.",
                e
            ))
            .kind(MessageDialogKind::Error)
            .title("Database Error")
            .ok_button_label("Reset Database")
            .cancel_button_label("Quit")
            .blocking_show();

        if confirmed {
            log::warn!("User requested database recovery");
            db::delete_database_files(&db_path)
                .map_err(|e| format!("Failed to delete database: {}", e))?;
            db::ensure_schema_ready(&db_path)
                .map_err(|e| format!("Failed to reinitialize database: {}", e))?;
            log::info!("Database recovered successfully");
        } else {
            log::info!("User declined recovery, exiting");
            return Err("Database initialization failed".into());
        }
    }

    // Create connection pool (unchanged)
    let pool = db::connection::DbPool::new(&db_path)
        .context("Failed to create connection pool")
        .map_err(|e| e.to_string())?;
    app.manage(pool);

    Ok(())
})
```

### `src-tauri/Cargo.toml`

Verify `tauri-plugin-dialog` is in dependencies (check if already present).

### `src-tauri/capabilities/default.json`

Add dialog permission if not present:

```json
{
	"permissions": ["dialog:default", "dialog:allow-message"]
}
```

---

## Phase 4: Add Frontend API Binding

**Files:**

- `src/lib/api.ts` - Add `recoverDatabase` function

**Changes:**

### `src/lib/api.ts`

Add the recovery command binding:

```typescript
export const api = {
	// ... existing commands ...

	recoverDatabase: () => invoke<string>("recover_database"),
} as const;
```

This allows the frontend to trigger recovery programmatically if needed (e.g., from a settings page "Reset Database" button that could reuse this).
