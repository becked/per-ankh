// Parser utility functions
//
// This module provides reusable helpers for parsing operations.

use std::collections::{HashMap, HashSet};
use std::hash::Hash;

/// Deduplicate rows using a last-wins strategy (matches SQL ON CONFLICT DO UPDATE).
///
/// When duplicate keys exist, the **last** row with that key is kept.
/// This matches the behavior of SQL `ON CONFLICT DO UPDATE` where the latest
/// value overwrites previous values.
///
/// # Arguments
/// * `rows` - Vector of rows to deduplicate
/// * `key_fn` - Closure that extracts the unique key from each row
///
/// # Returns
/// Vector of deduplicated rows (order is not preserved)
///
/// # Example
/// ```
/// let rows = vec![
///     (1, "A", 10),
///     (2, "B", 20),
///     (1, "A", 30), // Duplicate key (1, "A") - this one wins
/// ];
///
/// let result = deduplicate_rows_last_wins(rows, |(id, name, _)| (*id, name.to_string()));
/// // Result contains (1, "A", 30) - the last value for key (1, "A")
/// ```
pub fn deduplicate_rows_last_wins<T, K, F>(rows: Vec<T>, key_fn: F) -> Vec<T>
where
    K: Eq + Hash,
    F: Fn(&T) -> K,
{
    let initial_count = rows.len();
    let mut map: HashMap<K, T> = HashMap::new();

    for row in rows {
        let key = key_fn(&row);
        map.insert(key, row); // Last-wins: overwrites previous value
    }

    let result: Vec<T> = map.into_values().collect();
    let duplicates_removed = initial_count - result.len();

    if duplicates_removed > 0 {
        log::debug!(
            "Deduplicated {} duplicate row(s) using last-wins strategy ({} rows → {} unique rows)",
            duplicates_removed,
            initial_count,
            result.len()
        );
    }

    result
}

/// Deduplicate rows using a first-wins strategy (matches SQL ON CONFLICT DO NOTHING).
///
/// When duplicate keys exist, the **first** row with that key is kept.
/// This matches the behavior of SQL `ON CONFLICT DO NOTHING` where duplicate
/// inserts are silently ignored.
///
/// # Arguments
/// * `rows` - Vector of rows to deduplicate
/// * `key_fn` - Closure that extracts the unique key from each row
///
/// # Returns
/// Vector of deduplicated rows (order is preserved)
///
/// # Example
/// ```
/// let rows = vec![
///     (1, "A", 10), // First occurrence - this one wins
///     (2, "B", 20),
///     (1, "A", 30), // Duplicate key (1, "A") - ignored
/// ];
///
/// let result = deduplicate_rows_first_wins(rows, |(id, name, _)| (*id, name.to_string()));
/// // Result contains (1, "A", 10) - the first value for key (1, "A")
/// ```
pub fn deduplicate_rows_first_wins<T, K, F>(rows: Vec<T>, key_fn: F) -> Vec<T>
where
    K: Eq + Hash,
    F: Fn(&T) -> K,
{
    let initial_count = rows.len();
    let mut seen = HashSet::new();
    let result: Vec<T> = rows
        .into_iter()
        .filter(|row| {
            let key = key_fn(row);
            seen.insert(key) // Returns false if key already exists
        })
        .collect();

    let duplicates_removed = initial_count - result.len();

    if duplicates_removed > 0 {
        log::debug!(
            "Deduplicated {} duplicate row(s) using first-wins strategy ({} rows → {} unique rows)",
            duplicates_removed,
            initial_count,
            result.len()
        );
    }

    result
}

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

        let result = deduplicate_rows_last_wins(rows, |(id, name, _)| (*id, name.to_string()));

        assert_eq!(result.len(), 3);

        // Find the row with key (1, "A")
        let row_1a = result.iter().find(|(id, name, _)| *id == 1 && *name == "A").unwrap();
        assert_eq!(row_1a.2, 30); // Last value for (1, "A")

        assert!(result.contains(&(2, "B", 20)));
        assert!(result.contains(&(3, "C", 40)));
    }

    #[test]
    fn test_deduplicate_rows_first_wins() {
        let rows = vec![
            (1, "A", 10), // First occurrence - should win
            (2, "B", 20),
            (1, "A", 30), // Duplicate key (1, "A") - should be ignored
            (3, "C", 40),
        ];

        let result = deduplicate_rows_first_wins(rows, |(id, name, _)| (*id, name.to_string()));

        assert_eq!(result.len(), 3);
        assert_eq!(result[0], (1, "A", 10)); // First value for (1, "A")
        assert_eq!(result[1], (2, "B", 20));
        assert_eq!(result[2], (3, "C", 40));
    }

    #[test]
    fn test_deduplicate_no_duplicates() {
        let rows = vec![
            (1, "A", 10),
            (2, "B", 20),
            (3, "C", 30),
        ];

        let result_last = deduplicate_rows_last_wins(rows.clone(), |(id, name, _)| (*id, name.to_string()));
        let result_first = deduplicate_rows_first_wins(rows.clone(), |(id, name, _)| (*id, name.to_string()));

        // Both strategies should return all rows when no duplicates exist
        assert_eq!(result_last.len(), 3);
        assert_eq!(result_first.len(), 3);
    }

    #[test]
    fn test_deduplicate_all_duplicates() {
        let rows = vec![
            (1, "A", 10),
            (1, "A", 20),
            (1, "A", 30),
        ];

        let result_last = deduplicate_rows_last_wins(rows.clone(), |(id, name, _)| (*id, name.to_string()));
        let result_first = deduplicate_rows_first_wins(rows.clone(), |(id, name, _)| (*id, name.to_string()));

        assert_eq!(result_last.len(), 1);
        assert_eq!(result_first.len(), 1);

        // Last-wins should keep 30, first-wins should keep 10
        assert_eq!(result_last[0].2, 30);
        assert_eq!(result_first[0].2, 10);
    }

    #[test]
    fn test_deduplicate_composite_key() {
        let rows = vec![
            (1, 100, "A", 10),
            (1, 200, "B", 20),
            (1, 100, "A", 30), // Duplicate composite key (1, 100, "A")
        ];

        let result = deduplicate_rows_last_wins(rows, |(id, num, name, _)| (*id, *num, name.to_string()));

        assert_eq!(result.len(), 2);

        let row_1_100 = result.iter().find(|(id, num, name, _)| *id == 1 && *num == 100 && *name == "A").unwrap();
        assert_eq!(row_1_100.3, 30); // Last value
    }
}
