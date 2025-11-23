# Save Owner Tracking Implementation Plan

## Phase 1: Schema Changes

### Affected Files
| File | Changes |
|------|---------|
| `docs/schema.sql` | Add `is_save_owner` column to `players` table; add `user_settings` table |

### Changes

Add to `players` table after `is_human`:
```sql
is_save_owner BOOLEAN DEFAULT false,  -- TRUE if this player is the save file owner
```

Add new table in Section 1 (after `matches` table):
```sql
-- User settings for save owner identification
CREATE TABLE user_settings (
    key VARCHAR NOT NULL PRIMARY KEY,
    value VARCHAR
);
```

---

## Phase 2: Rust Data Structures

### Affected Files
| File | Changes |
|------|---------|
| `src-tauri/src/parser/game_data.rs` | Add `is_save_owner` field to `PlayerData` struct |
| `src-tauri/src/db/settings.rs` | New file: functions to get/set user settings |
| `src-tauri/src/db/mod.rs` | Export `settings` module |

### Changes

**`src-tauri/src/parser/game_data.rs`**

Add field to `PlayerData` struct:
```rust
pub is_save_owner: bool,
```

Initialize as `false` in `PlayerData` construction.

**`src-tauri/src/db/settings.rs`** (new file)

```rust
use duckdb::Connection;
use anyhow::{Context, Result};

const PRIMARY_USER_ONLINE_ID_KEY: &str = "primary_user_online_id";

pub fn get_primary_user_online_id(conn: &Connection) -> Result<Option<String>> {
    let result = conn.query_row(
        "SELECT value FROM user_settings WHERE key = ?",
        [PRIMARY_USER_ONLINE_ID_KEY],
        |row| row.get(0),
    );

    match result {
        Ok(value) => Ok(value),
        Err(duckdb::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e).context("Failed to get primary user OnlineID"),
    }
}

pub fn set_primary_user_online_id(conn: &Connection, online_id: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
        [PRIMARY_USER_ONLINE_ID_KEY, online_id],
    ).context("Failed to set primary user OnlineID")?;
    Ok(())
}
```

Unit test:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_set_primary_user_online_id() {
        // Setup in-memory DB with schema
        let conn = /* create test connection with user_settings table */;

        // Initially none
        assert_eq!(get_primary_user_online_id(&conn).unwrap(), None);

        // Set and get
        set_primary_user_online_id(&conn, "12345").unwrap();
        assert_eq!(get_primary_user_online_id(&conn).unwrap(), Some("12345".to_string()));

        // Update
        set_primary_user_online_id(&conn, "67890").unwrap();
        assert_eq!(get_primary_user_online_id(&conn).unwrap(), Some("67890".to_string()));
    }
}
```

---

## Phase 3: Auto-Detection of Primary User at First Import

### Affected Files
| File | Changes |
|------|---------|
| `src-tauri/src/parser/import.rs` | Add `auto_detect_primary_user()` function; call at start of first import |

### Changes

Add function to auto-detect primary user from most common OnlineID:

```rust
/// Auto-detect and set primary user OnlineID on first import
///
/// Finds the most frequently occurring OnlineID across all players and sets it
/// as the primary user. Only runs if primary_user_online_id is not already set.
fn auto_detect_primary_user(conn: &Connection) -> Result<()> {
    // Skip if already configured
    if crate::db::settings::get_primary_user_online_id(conn)?.is_some() {
        return Ok(());
    }

    // Find most common OnlineID (excluding empty strings)
    let result: Option<String> = conn.query_row(
        "SELECT online_id FROM players
         WHERE online_id IS NOT NULL AND online_id != ''
         GROUP BY online_id
         ORDER BY COUNT(*) DESC
         LIMIT 1",
        [],
        |row| row.get(0),
    ).ok();

    if let Some(online_id) = result {
        crate::db::settings::set_primary_user_online_id(conn, &online_id)?;
        log::info!("Auto-detected primary user OnlineID: {}", online_id);
    }

    Ok(())
}
```

Call `auto_detect_primary_user(conn)` at the start of `import_save_file()`, before processing the new save.

Unit test:
```rust
#[test]
fn test_auto_detect_primary_user() {
    // Setup: DB with 3 saves, OnlineID "A" appears in 2, "B" in 1
    // Assert: primary_user_online_id is set to "A"
}

#[test]
fn test_auto_detect_skips_if_already_set() {
    // Setup: primary_user_online_id already set to "X", DB has "A" appearing most
    // Assert: primary_user_online_id remains "X"
}
```

---

## Phase 4: Save Owner Detection Logic

### Affected Files
| File | Changes |
|------|---------|
| `src-tauri/src/parser/import.rs` | Add `determine_save_owner()` function; call it after player insertion |

### Changes

Add new function after `update_winner()`:

```rust
/// Determine which player is the save owner (the person whose machine created this save)
///
/// Detection priority:
/// 1. If only one human player exists → they are the save owner
/// 2. If primary_user_online_id is set → match player by OnlineID
/// 3. Otherwise → leave is_save_owner = false for all players (unknown)
fn determine_save_owner(
    tx: &Connection,
    match_id: i64,
    players_data: &[PlayerData],
    id_mapper: &IdMapper,
) -> Result<()> {
    let human_players: Vec<_> = players_data.iter().filter(|p| p.is_human).collect();

    let save_owner_xml_id: Option<i32> = if human_players.len() == 1 {
        // Single human = save owner (covers all single-player games)
        Some(human_players[0].xml_id)
    } else if human_players.len() > 1 {
        // Multiple humans: try to match by primary user OnlineID
        let primary_online_id = crate::db::settings::get_primary_user_online_id(tx)?;

        if let Some(ref online_id) = primary_online_id {
            players_data
                .iter()
                .find(|p| p.online_id.as_ref() == Some(online_id))
                .map(|p| p.xml_id)
        } else {
            None // No primary user configured, can't determine save owner
        }
    } else {
        None // No human players
    };

    if let Some(xml_id) = save_owner_xml_id {
        let db_id = id_mapper.get_player(xml_id)?;
        tx.execute(
            "UPDATE players SET is_save_owner = TRUE WHERE player_id = ? AND match_id = ?",
            params![db_id, match_id],
        )?;
        log::debug!("Set save owner: player XML ID {} → DB ID {}", xml_id, db_id);
    }

    Ok(())
}
```

Call this function in `import_save_file()` after player insertion, before returning success.

Unit tests:
```rust
#[test]
fn test_determine_save_owner_single_human() {
    // Setup: one human player, two AI players
    // Assert: human player has is_save_owner = true
}

#[test]
fn test_determine_save_owner_multiple_humans_with_primary_user() {
    // Setup: two human players, primary_user_online_id set to one's OnlineID
    // Assert: matching player has is_save_owner = true, other has false
}

#[test]
fn test_determine_save_owner_multiple_humans_no_primary_user() {
    // Setup: two human players, no primary_user_online_id set
    // Assert: both players have is_save_owner = false
}
```

---

## Phase 5: Update human_won Query

### Affected Files
| File | Changes |
|------|---------|
| `src-tauri/src/lib.rs` | Update `get_game_statistics()` query to use `is_save_owner`; rename struct fields |
| `src/lib/types/` | Regenerate TypeScript types (automatic) |

### Changes

In `get_game_statistics()`, change the subquery that finds the human player:

**Before:**
```sql
LEFT JOIN (
    SELECT match_id, nation, player_id,
           ROW_NUMBER() OVER (PARTITION BY match_id ORDER BY player_id) as rn
    FROM players WHERE is_human = TRUE
) p ON m.match_id = p.match_id AND p.rn = 1
```

**After:**
```sql
LEFT JOIN (
    SELECT match_id, nation, player_id
    FROM players WHERE is_save_owner = TRUE
) p ON m.match_id = p.match_id
```

In `GameStatistics` struct, rename fields:
- `human_nation` → `save_owner_nation`
- `human_won` → `save_owner_won`

Update frontend code that references these fields accordingly.

---

## Phase 6: Tauri Commands for Settings

### Affected Files
| File | Changes |
|------|---------|
| `src-tauri/src/lib.rs` | Add `get_primary_user_online_id`, `set_primary_user_online_id`, and `get_known_online_ids` commands |
| `src/lib/api.ts` | Add API functions for settings |

### Changes

**`src-tauri/src/lib.rs`**

```rust
#[tauri::command]
fn get_primary_user_online_id(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    crate::db::settings::get_primary_user_online_id(&conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_primary_user_online_id(
    state: State<'_, AppState>,
    online_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    crate::db::settings::set_primary_user_online_id(&conn, &online_id)
        .map_err(|e| e.to_string())
}

#[derive(Serialize, TS)]
#[ts(export)]
struct KnownOnlineId {
    online_id: String,
    player_name: String,
    save_count: i64,
}

#[tauri::command]
fn get_known_online_ids(state: State<'_, AppState>) -> Result<Vec<KnownOnlineId>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT online_id, player_name, COUNT(*) as save_count
         FROM players
         WHERE online_id IS NOT NULL AND online_id != ''
         GROUP BY online_id, player_name
         ORDER BY save_count DESC, player_name"
    ).map_err(|e| e.to_string())?;

    let results = stmt.query_map([], |row| {
        Ok(KnownOnlineId {
            online_id: row.get(0)?,
            player_name: row.get(1)?,
            save_count: row.get(2)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(results)
}
```

Register all three commands in `invoke_handler`.

**`src/lib/api.ts`**

```typescript
getPrimaryUserOnlineId: () =>
  invoke<string | null>("get_primary_user_online_id"),

setPrimaryUserOnlineId: (onlineId: string) =>
  invoke<void>("set_primary_user_online_id", { onlineId }),

getKnownOnlineIds: () =>
  invoke<KnownOnlineId[]>("get_known_online_ids"),
```

---

## Phase 7: Frontend Settings UI

### Affected Files
| File | Changes |
|------|---------|
| `src/lib/components/Settings.svelte` | Add primary user configuration section (create file if doesn't exist) |
| `src/routes/+page.svelte` or equivalent | Add settings access point (gear icon, menu item, etc.) |

### Changes

Create settings UI that:
1. Displays current primary user (if set) with player name from `get_known_online_ids()`
2. Shows dropdown/list of known OnlineIDs with player names and save counts
3. Allows selecting one as the primary user
4. Displays helper text: "Select your identity to track wins/losses in multiplayer games"

The UI should call `get_known_online_ids()` on mount, and `set_primary_user_online_id()` when user makes a selection.
