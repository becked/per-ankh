# Appender Deduplication Implementation

## Problem

DuckDB's Appender API doesn't support `ON CONFLICT` clauses. When duplicate rows exist in save file data, the Appender fails with constraint violations. This document outlines how to handle duplicates before passing data to Appenders.

## Design Principles

- **DRY**: Create a single reusable deduplication abstraction
- **YAGNI**: Only implement what's needed to handle duplicates
- **Performance**: Maintain the 10-15x speedup from Appenders

## Solution: Generic Deduplication Helper

Create a single helper function that handles deduplication for all tables.

### Core Abstraction

```rust
use std::collections::HashMap;
use std::hash::Hash;

/// Deduplicate rows before bulk insert using a key extraction function.
/// Uses last-wins strategy: if duplicate keys exist, the last row is kept.
fn deduplicate_rows<T, K, F>(rows: Vec<T>, key_fn: F) -> Vec<T>
where
    K: Eq + Hash,
    F: Fn(&T) -> K,
{
    let mut map: HashMap<K, T> = HashMap::new();
    for row in rows {
        let key = key_fn(&row);
        map.insert(key, row); // Last-wins: overwrites previous value
    }
    map.into_values().collect()
}
```

**Rationale**:

- Generic over row type `T` and key type `K`
- Uses HashMap (last-wins) instead of HashSet to match old `DO UPDATE` behavior
- Simple closure `key_fn` extracts composite key from each row
- Returns deduplicated Vec ready for Appender

## Affected Tables

### 1. character_marriages (CRITICAL - blocking imports)

**Location**: `src-tauri/src/parser/entities/character_data.rs:412-435`

**Primary Key**: `(character_id, match_id, spouse_id, marriage_turn)`

**Old Behavior**: `ON CONFLICT (...) DO NOTHING`

**Implementation**:

```rust
// Collect all marriage rows first
let mut marriages = Vec::new();
for id_node in spouses_node.children().filter(|n| n.has_tag_name("ID")) {
    if let Some(id_value) = id_node.text() {
        let xml_id = id_value.parse::<i32>()
            .context("Failed to parse spouse ID")?;

        let spouse_id = id_mapper
            .get_or_create_character_id(xml_id, match_id, &conn, game_node)?;

        marriages.push((character_id, match_id, spouse_id, -1, None::<i32>));
    }
}

// Deduplicate before appending
let unique_marriages = deduplicate_rows(
    marriages,
    |(char_id, match_id, spouse_id, turn, _)| (*char_id, *match_id, *spouse_id, *turn)
);

// Bulk insert deduplicated rows
let mut app = conn.appender("character_marriages")?;
for (char_id, match_id, spouse_id, turn, ended) in unique_marriages {
    app.append_row(params![char_id, match_id, spouse_id, turn, ended])?;
}
app.flush()?;
```

---

### 2. character_stats

**Location**: `src-tauri/src/parser/entities/character_data.rs:61-110`

**Primary Key**: `(character_id, match_id, stat_name)`

**Old Behavior**: `ON CONFLICT (...) DO UPDATE SET stat_value = excluded.stat_value`

**Implementation**:

```rust
// Collect all stat rows first
let mut stats = Vec::new();
for (stat_name, xml_name) in stat_mappings {
    if let Some(value) = get_node_value(character_node, xml_name) {
        if let Ok(stat_value) = value.parse::<i32>() {
            stats.push((character_id, match_id, stat_name.to_string(), stat_value));
        }
    }
}

// Deduplicate (last-wins matches old DO UPDATE behavior)
let unique_stats = deduplicate_rows(
    stats,
    |(char_id, match_id, stat_name, _)| (*char_id, *match_id, stat_name.clone())
);

// Bulk insert
let mut app = conn.appender("character_stats")?;
for (char_id, match_id, stat_name, stat_value) in unique_stats {
    app.append_row(params![char_id, match_id, stat_name, stat_value])?;
}
app.flush()?;
```

---

### 3. character_traits

**Location**: `src-tauri/src/parser/entities/character_data.rs:137-163`

**Primary Key**: `(character_id, match_id, trait, acquired_turn)`

**Old Behavior**: `ON CONFLICT (...) DO UPDATE SET removed_turn = excluded.removed_turn`

**Implementation**:

```rust
// Collect all trait rows first
let mut traits = Vec::new();
for trait_node in traits_list.children().filter(|n| n.has_tag_name("ID")) {
    if let Some(trait_value) = trait_node.text() {
        traits.push((
            character_id,
            match_id,
            trait_value.to_string(),
            -1, // acquired_turn unknown
            None::<i32> // removed_turn
        ));
    }
}

// Deduplicate
let unique_traits = deduplicate_rows(
    traits,
    |(char_id, match_id, trait, acquired, _)| (*char_id, *match_id, trait.clone(), *acquired)
);

// Bulk insert
let mut app = conn.appender("character_traits")?;
for (char_id, match_id, trait, acquired, removed) in unique_traits {
    app.append_row(params![char_id, match_id, trait, acquired, removed])?;
}
app.flush()?;
```

---

### 4. character_relationships

**Location**: `src-tauri/src/parser/entities/character_data.rs:195-262`

**Primary Key**: `(character_id, match_id, related_character_id, relationship_type)`

**Old Behavior**: `ON CONFLICT (...) DO UPDATE SET opinion = excluded.opinion, ...`

**Implementation**:

```rust
// Collect all relationship rows first
let mut relationships = Vec::new();

// Process each relationship type (children, parents, siblings, etc.)
for child_node in children_list.children().filter(|n| n.has_tag_name("ID")) {
    if let Some(child_id) = parse_and_map_character_id(child_node, match_id, &conn, game_node, id_mapper)? {
        relationships.push((character_id, match_id, child_id, "CHILD".to_string(), None, None, None, None));
    }
}
// ... repeat for other relationship types ...

// Deduplicate
let unique_relationships = deduplicate_rows(
    relationships,
    |(char_id, match_id, related_id, rel_type, _, _, _, _)|
        (*char_id, *match_id, *related_id, rel_type.clone())
);

// Bulk insert
let mut app = conn.appender("character_relationships")?;
for (char_id, match_id, related_id, rel_type, opinion, is_rival, is_friend, is_lover) in unique_relationships {
    app.append_row(params![char_id, match_id, related_id, rel_type, opinion, is_rival, is_friend, is_lover])?;
}
app.flush()?;
```

---

### 5. id_mappings

**Location**: `src-tauri/src/parser/id_mapper.rs:154-183`

**Primary Key**: `(match_id, entity_type, xml_id)`

**Old Behavior**: `ON CONFLICT (...) DO UPDATE SET db_id = excluded.db_id`

**Implementation**:

```rust
// In IdMapper struct, collect mappings during parsing
pub struct IdMapper {
    pending_mappings: Vec<(i32, String, i32, i32)>, // (match_id, entity_type, xml_id, db_id)
}

impl IdMapper {
    // Modify existing methods to collect instead of insert immediately
    pub fn add_mapping(&mut self, match_id: i32, entity_type: &str, xml_id: i32, db_id: i32) {
        self.pending_mappings.push((match_id, entity_type.to_string(), xml_id, db_id));
    }

    // New method: flush all mappings at once
    pub fn flush_mappings(&mut self, conn: &Connection) -> Result<()> {
        // Deduplicate
        let unique_mappings = deduplicate_rows(
            std::mem::take(&mut self.pending_mappings),
            |(match_id, entity_type, xml_id, _)| (*match_id, entity_type.clone(), *xml_id)
        );

        // Bulk insert
        let mut app = conn.appender("id_mappings")?;
        for (match_id, entity_type, xml_id, db_id) in unique_mappings {
            app.append_row(params![match_id, entity_type, xml_id, db_id])?;
        }
        app.flush()?;

        Ok(())
    }
}
```

**Note**: id_mappings requires more significant refactoring since IdMapper is used throughout parsing. Consider doing this last or separately.

---

## Implementation Strategy

### Phase 1: Core Helper (Required)

1. Add `deduplicate_rows` function to `src-tauri/src/parser/utils.rs` or create new `src-tauri/src/parser/dedup.rs`
2. Add unit tests for the helper function

### Phase 2: Fix Blocking Issue (High Priority)

1. **character_marriages** - fixes immediate import failure

### Phase 3: Fix Remaining Tables (Medium Priority)

2. **character_stats** - likely to have duplicates
3. **character_traits** - likely to have duplicates
4. **character_relationships** - possible duplicates

### Phase 4: Refactor id_mappings (Optional)

5. **id_mappings** - requires larger refactoring, lower priority

---

## Testing

### Unit Test for Helper

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deduplicate_rows_last_wins() {
        let rows = vec![
            (1, "A", 10),
            (2, "B", 20),
            (1, "A", 30), // Duplicate key (1, "A") - should win
            (3, "C", 40),
        ];

        let result = deduplicate_rows(rows, |(id, name, _)| (*id, name.to_string()));

        assert_eq!(result.len(), 3);
        assert!(result.contains(&(1, "A", 30))); // Last value for (1, "A")
        assert!(result.contains(&(2, "B", 20)));
        assert!(result.contains(&(3, "C", 40)));
    }
}
```

### Integration Test

```bash
# Run the import that previously failed
./per-ankh.sh clean
./per-ankh.sh import-all test-data/saves src-tauri/per-ankh.db "*2025-10*"

# Should now import all 10 saves successfully
# Verify count: SELECT COUNT(*) FROM matches; -- should be 10
```

---

## Performance Impact

- **Memory overhead**: Minimal - only stores rows in Vec/HashMap temporarily during each table's import
- **Time overhead**: Negligible - O(n) deduplication vs O(n) Appender bulk insert
- **Net result**: Maintains ~10-15x speedup compared to individual INSERT statements

---

## Alternative: First-Wins Strategy

If last-wins (HashMap) doesn't match desired behavior for a specific table, use HashSet with a wrapper:

```rust
fn deduplicate_rows_first_wins<T, K, F>(rows: Vec<T>, key_fn: F) -> Vec<T>
where
    K: Eq + Hash,
    F: Fn(&T) -> K,
{
    let mut seen = HashSet::new();
    rows.into_iter()
        .filter(|row| seen.insert(key_fn(row)))
        .collect()
}
```

**When to use**:

- Last-wins (HashMap): Matches `DO UPDATE` behavior - use for stats, traits, relationships
- First-wins (HashSet): Matches `DO NOTHING` behavior - use for marriages

**Update**: Use first-wins for character_marriages since old code had `DO NOTHING`.

---

## Files to Modify

1. `src-tauri/src/parser/entities/character_data.rs` - 4 tables (marriages, stats, traits, relationships)
2. `src-tauri/src/parser/id_mapper.rs` - 1 table (id_mappings)
3. `src-tauri/src/parser/utils.rs` or new `dedup.rs` - helper function

---

## Rollback Plan

If issues arise:

1. Revert to commit `a1d2caf^` (before Appender changes)
2. Or selectively revert individual tables to INSERT with ON CONFLICT
3. Performance will regress but imports will work

---

## Questions for Code Review

1. Should character_marriages use first-wins (DO NOTHING) or last-wins (DO UPDATE)?
2. Is id_mappings refactoring worth the effort, or should we revert it to INSERT?
3. Should we add logging when duplicates are found to track data quality issues?
