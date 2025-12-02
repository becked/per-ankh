# Collections Feature Implementation Plan

Allow users to organize matches into collections (e.g., "Personal", "Challenge Games") to filter stats and prevent player name pollution in Primary User detection.

## Phase 1: Backend (Schema + Rust)

### Affected Files

| File | Changes |
|------|---------|
| `docs/schema.sql` | Add `collections` table, add `collection_id` column to `matches` |
| `src-tauri/src/db/mod.rs` | Export new `collections` module |
| `src-tauri/src/db/collections.rs` | New file: CRUD operations for collections |
| `src-tauri/src/lib.rs` | Add Tauri commands, update `get_known_online_ids` query |

### Schema Changes

Add to `docs/schema.sql` after the `matches` table:

```sql
CREATE TABLE collections (
    collection_id INTEGER PRIMARY KEY,
    name VARCHAR NOT NULL UNIQUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE
);

-- Seed default collection
INSERT INTO collections (collection_id, name, is_default) VALUES (1, 'Personal', TRUE);

-- Add to matches table
ALTER TABLE matches ADD COLUMN collection_id INTEGER NOT NULL DEFAULT 1
    REFERENCES collections(collection_id);

CREATE INDEX idx_matches_collection ON matches(collection_id);
```

### New File: `src-tauri/src/db/collections.rs`

```rust
use duckdb::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Collection {
    pub collection_id: i32,
    pub name: String,
    pub is_default: bool,
    pub match_count: i64,
}

pub fn get_collections(conn: &Connection) -> duckdb::Result<Vec<Collection>> {
    let mut stmt = conn.prepare(
        "SELECT c.collection_id, c.name, c.is_default, COUNT(m.match_id) as match_count
         FROM collections c
         LEFT JOIN matches m ON c.collection_id = m.collection_id
         GROUP BY c.collection_id, c.name, c.is_default
         ORDER BY c.collection_id"
    )?;

    let results = stmt.query_map([], |row| {
        Ok(Collection {
            collection_id: row.get(0)?,
            name: row.get(1)?,
            is_default: row.get(2)?,
            match_count: row.get(3)?,
        })
    })?
    .collect::<Result<Vec<_>, _>>()?;

    Ok(results)
}

pub fn create_collection(conn: &Connection, name: &str) -> duckdb::Result<Collection> {
    conn.execute(
        "INSERT INTO collections (name, is_default) VALUES (?, FALSE)",
        [name],
    )?;

    conn.query_row(
        "SELECT collection_id, name, is_default, 0 as match_count
         FROM collections WHERE name = ?",
        [name],
        |row| Ok(Collection {
            collection_id: row.get(0)?,
            name: row.get(1)?,
            is_default: row.get(2)?,
            match_count: 0,
        }),
    )
}

pub fn rename_collection(conn: &Connection, collection_id: i32, name: &str) -> duckdb::Result<()> {
    conn.execute(
        "UPDATE collections SET name = ? WHERE collection_id = ?",
        duckdb::params![name, collection_id],
    )?;
    Ok(())
}

pub fn delete_collection(conn: &Connection, collection_id: i32) -> duckdb::Result<()> {
    // Get default collection ID
    let default_id: i32 = conn.query_row(
        "SELECT collection_id FROM collections WHERE is_default = TRUE",
        [],
        |row| row.get(0),
    )?;

    // Move matches to default collection before deleting
    conn.execute(
        "UPDATE matches SET collection_id = ? WHERE collection_id = ?",
        duckdb::params![default_id, collection_id],
    )?;

    conn.execute(
        "DELETE FROM collections WHERE collection_id = ? AND is_default = FALSE",
        [collection_id],
    )?;
    Ok(())
}

pub fn set_default_collection(conn: &Connection, collection_id: i32) -> duckdb::Result<()> {
    conn.execute("UPDATE collections SET is_default = FALSE", [])?;
    conn.execute(
        "UPDATE collections SET is_default = TRUE WHERE collection_id = ?",
        [collection_id],
    )?;
    Ok(())
}

pub fn move_matches_to_collection(
    conn: &Connection,
    match_ids: &[i64],
    collection_id: i32,
) -> duckdb::Result<usize> {
    if match_ids.is_empty() {
        return Ok(0);
    }

    // DuckDB doesn't support array parameters, so build IN clause
    let placeholders: Vec<String> = match_ids.iter().map(|_| "?".to_string()).collect();
    let query = format!(
        "UPDATE matches SET collection_id = ? WHERE match_id IN ({})",
        placeholders.join(", ")
    );

    let mut params: Vec<Box<dyn duckdb::ToSql>> = vec![Box::new(collection_id)];
    for id in match_ids {
        params.push(Box::new(*id));
    }

    let count = conn.execute(&query, duckdb::params_from_iter(params.iter().map(|p| p.as_ref())))?;
    Ok(count)
}

pub fn move_matches_by_game_name(
    conn: &Connection,
    pattern: &str,
    collection_id: i32,
) -> duckdb::Result<usize> {
    let count = conn.execute(
        "UPDATE matches SET collection_id = ? WHERE game_name LIKE ?",
        duckdb::params![collection_id, pattern],
    )?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::create_schema;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn test_get_collections_returns_default() {
        let conn = setup_test_db();
        let collections = get_collections(&conn).unwrap();

        assert_eq!(collections.len(), 1);
        assert_eq!(collections[0].name, "Personal");
        assert!(collections[0].is_default);
    }

    #[test]
    fn test_create_collection() {
        let conn = setup_test_db();
        let collection = create_collection(&conn, "Challenge Games").unwrap();

        assert_eq!(collection.name, "Challenge Games");
        assert!(!collection.is_default);

        let all = get_collections(&conn).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_delete_collection_moves_matches_to_default() {
        let conn = setup_test_db();

        // Create a new collection
        let challenge = create_collection(&conn, "Challenge").unwrap();

        // Insert a match in the challenge collection
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns, collection_id)
             VALUES (1, 'test', 'test.zip', 'abc', 100, ?)",
            [challenge.collection_id],
        ).unwrap();

        // Delete the collection
        delete_collection(&conn, challenge.collection_id).unwrap();

        // Match should be moved to default collection (id=1)
        let collection_id: i32 = conn.query_row(
            "SELECT collection_id FROM matches WHERE match_id = 1",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(collection_id, 1);
    }

    #[test]
    fn test_move_matches_by_game_name() {
        let conn = setup_test_db();

        // Create challenge collection
        let challenge = create_collection(&conn, "Challenge").unwrap();

        // Insert matches
        conn.execute(
            "INSERT INTO matches (match_id, game_id, game_name, file_name, file_hash, total_turns)
             VALUES (1, 'g1', 'Challenge Map 24', 'a.zip', 'a', 100)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO matches (match_id, game_id, game_name, file_name, file_hash, total_turns)
             VALUES (2, 'g2', 'Challenge Map 25', 'b.zip', 'b', 100)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO matches (match_id, game_id, game_name, file_name, file_hash, total_turns)
             VALUES (3, 'g3', 'My Normal Game', 'c.zip', 'c', 100)",
            [],
        ).unwrap();

        // Move challenge maps
        let moved = move_matches_by_game_name(&conn, "Challenge Map%", challenge.collection_id).unwrap();
        assert_eq!(moved, 2);

        // Verify
        let challenge_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM matches WHERE collection_id = ?",
            [challenge.collection_id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(challenge_count, 2);
    }
}
```

### Update `src-tauri/src/db/mod.rs`

Add:
```rust
pub mod collections;
```

### Update `src-tauri/src/lib.rs`

Add Tauri commands:

```rust
use crate::db::collections::{self, Collection};

#[tauri::command]
async fn get_collections(
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<Collection>, String> {
    pool.with_connection(|conn| collections::get_collections(conn))
        .context("Failed to get collections")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_collection(
    pool: tauri::State<'_, db::connection::DbPool>,
    name: String,
) -> Result<Collection, String> {
    pool.with_connection(|conn| collections::create_collection(conn, &name))
        .context("Failed to create collection")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn rename_collection(
    pool: tauri::State<'_, db::connection::DbPool>,
    collection_id: i32,
    name: String,
) -> Result<(), String> {
    pool.with_connection(|conn| collections::rename_collection(conn, collection_id, &name))
        .context("Failed to rename collection")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_collection(
    pool: tauri::State<'_, db::connection::DbPool>,
    collection_id: i32,
) -> Result<(), String> {
    pool.with_connection(|conn| collections::delete_collection(conn, collection_id))
        .context("Failed to delete collection")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_default_collection(
    pool: tauri::State<'_, db::connection::DbPool>,
    collection_id: i32,
) -> Result<(), String> {
    pool.with_connection(|conn| collections::set_default_collection(conn, collection_id))
        .context("Failed to set default collection")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn move_matches_to_collection(
    pool: tauri::State<'_, db::connection::DbPool>,
    match_ids: Vec<i64>,
    collection_id: i32,
) -> Result<usize, String> {
    pool.with_connection(|conn| collections::move_matches_to_collection(conn, &match_ids, collection_id))
        .context("Failed to move matches")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn move_matches_by_game_name(
    pool: tauri::State<'_, db::connection::DbPool>,
    pattern: String,
    collection_id: i32,
) -> Result<usize, String> {
    pool.with_connection(|conn| collections::move_matches_by_game_name(conn, &pattern, collection_id))
        .context("Failed to move matches by name")
        .map_err(|e| e.to_string())
}
```

Register commands in `invoke_handler`:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    get_collections,
    create_collection,
    rename_collection,
    delete_collection,
    set_default_collection,
    move_matches_to_collection,
    move_matches_by_game_name,
])
```

Update `get_known_online_ids` query to filter by default collection:

```rust
let mut stmt = conn.prepare(
    "SELECT p.online_id,
            string_agg(DISTINCT p.player_name, '|||' ORDER BY p.player_name) as player_names,
            COUNT(*) as save_count
     FROM players p
     JOIN matches m ON p.match_id = m.match_id
     JOIN collections c ON m.collection_id = c.collection_id
     WHERE p.online_id IS NOT NULL
       AND p.online_id != ''
       AND c.is_default = TRUE
     GROUP BY p.online_id
     ORDER BY save_count DESC"
)?;
```

Update `get_games_list` to include `collection_id` in response (add to `GameInfo` struct).

---

## Phase 2: Frontend (UI)

### Affected Files

| File | Changes |
|------|---------|
| `src/lib/types/Collection.ts` | Generated by ts-rs (run tests after Phase 1) |
| `src/lib/api.ts` | Add collection API functions |
| `src/lib/stores/collection.ts` | New file: active collection store |
| `src/lib/GameSidebar.svelte` | Add collection filter dropdown |
| `src/lib/SettingsModal.svelte` | Add "Manage Collections" section |
| `src/lib/CollectionManager.svelte` | New file: collection CRUD UI |
| `src/lib/MoveToCollectionModal.svelte` | New file: bulk move UI |

### Update `src/lib/api.ts`

```typescript
import type { Collection } from "$lib/types/Collection";

export const api = {
  // ... existing ...

  // Collections
  getCollections: () =>
    invoke<Collection[]>("get_collections"),

  createCollection: (name: string) =>
    invoke<Collection>("create_collection", { name }),

  renameCollection: (collectionId: number, name: string) =>
    invoke<void>("rename_collection", { collectionId, name }),

  deleteCollection: (collectionId: number) =>
    invoke<void>("delete_collection", { collectionId }),

  setDefaultCollection: (collectionId: number) =>
    invoke<void>("set_default_collection", { collectionId }),

  moveMatchesToCollection: (matchIds: number[], collectionId: number) =>
    invoke<number>("move_matches_to_collection", { matchIds, collectionId }),

  moveMatchesByGameName: (pattern: string, collectionId: number) =>
    invoke<number>("move_matches_by_game_name", { pattern, collectionId }),
} as const;
```

### New File: `src/lib/stores/collection.ts`

```typescript
import { writable } from "svelte/store";

// null means "show all", number means filter to that collection
export const activeCollectionId = writable<number | null>(null);
```

### Update `src/lib/GameSidebar.svelte`

Add collection filter dropdown above game list:

```svelte
<script lang="ts">
  import { api } from "$lib/api";
  import { activeCollectionId } from "$lib/stores/collection";
  import type { Collection } from "$lib/types/Collection";

  let collections = $state<Collection[]>([]);
  let selectedCollectionId = $state<number | null>(null);

  // Sync with store
  $effect(() => {
    const unsubscribe = activeCollectionId.subscribe(v => {
      selectedCollectionId = v;
    });
    return unsubscribe;
  });

  async function loadCollections() {
    collections = await api.getCollections();
  }

  function handleCollectionChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    const id = value === "all" ? null : Number(value);
    activeCollectionId.set(id);
  }

  onMount(() => {
    loadCollections();
  });
</script>

<!-- Add above game list -->
<div class="px-2 py-1 border-b border-black">
  <select
    class="w-full bg-brown text-tan text-xs p-1 rounded border border-black"
    value={selectedCollectionId ?? "all"}
    onchange={handleCollectionChange}
  >
    <option value="all">All Collections</option>
    {#each collections as c}
      <option value={c.collection_id}>
        {c.name} ({c.match_count})
      </option>
    {/each}
  </select>
</div>
```

Update `get_games_list` call to pass `collection_id` filter, or filter client-side using the store value.

### New File: `src/lib/CollectionManager.svelte`

Inline component for Settings modal - shows list of collections with:
- Create new collection (text input + button)
- Rename collection (inline edit)
- Delete collection (with confirmation)
- Set as default (radio or button)

### New File: `src/lib/MoveToCollectionModal.svelte`

Modal for bulk moving matches:
- Dropdown to select target collection
- Text input for "Move by game name pattern" (e.g., "Challenge Map%")
- Preview count of matches to be moved
- Confirm/Cancel buttons

### Update `src/lib/SettingsModal.svelte`

Add "Collections" section below Primary User:

```svelte
<div class="mb-6">
  <h3 class="text-lg font-semibold text-tan mb-2">Collections</h3>
  <p class="text-sm text-gray-400 mb-4">
    Organize games into collections. Only the default collection is used for Primary User detection.
  </p>
  <CollectionManager />
</div>
```

### Context Menu on Game Items

Add right-click context menu to game items in `GameSidebar.svelte`:
- "Move to Collection >" submenu with collection list
- Opens `MoveToCollectionModal` for bulk operations

---

## Migration

Users must reset their database after this change. The schema changes are not backwards-compatible.

On app startup, detect schema version mismatch and prompt user to reset database.
