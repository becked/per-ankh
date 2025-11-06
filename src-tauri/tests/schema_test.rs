// Direct schema test

use duckdb::Connection;
use tempfile::tempdir;

#[test]
fn test_schema_direct() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("test.db");

    let conn = Connection::open(&db_path).unwrap();

    // Get first 1000 characters of schema to see what we're executing
    let schema_sql = include_str!("../../docs/schema.sql");
    println!("Schema length: {} chars", schema_sql.len());
    println!("First 1000 chars: {}", &schema_sql[..schema_sql.len().min(1000)]);

    // Try executing without filtering
    match conn.execute_batch(schema_sql) {
        Ok(_) => println!("Schema executed successfully"),
        Err(e) => {
            println!("Schema execution failed: {}", e);
            // Try to see what went wrong
            panic!("Schema failed: {}", e);
        }
    }

    // Verify tables exist
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM players", [], |row| row.get(0))
        .unwrap();
    println!("Players table has {} rows", count);
}
