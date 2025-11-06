use duckdb::Connection;
use std::collections::HashMap;
use std::env;

fn main() -> anyhow::Result<()> {
    // Get database path from command line or use default
    let args: Vec<String> = env::args().collect();
    let db_path = if args.len() > 1 {
        &args[1]
    } else {
        "per-ankh.db"
    };

    println!("Analyzing database: {}", db_path);
    println!("{}", "=".repeat(80));

    let conn = Connection::open(db_path)?;

    // Get all table names
    let mut stmt = conn.prepare(
        "SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'main' AND table_type = 'BASE TABLE'
         ORDER BY table_name"
    )?;

    let tables: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;

    println!("\nTotal tables found: {}", tables.len());
    println!();

    // Analyze each table
    let mut empty_tables = Vec::new();
    let mut populated_tables = Vec::new();
    let mut tables_with_empty_columns: HashMap<String, Vec<(String, String)>> = HashMap::new();

    for table_name in &tables {
        // Get row count
        let count_query = format!("SELECT COUNT(*) FROM \"{}\"", table_name);
        let row_count: i64 = conn.query_row(&count_query, [], |row| row.get(0))?;

        if row_count == 0 {
            empty_tables.push(table_name.clone());
        } else {
            populated_tables.push((table_name.clone(), row_count));

            // For populated tables, check for empty columns
            let columns_query = format!(
                "SELECT column_name, data_type FROM information_schema.columns
                 WHERE table_name = '{}' ORDER BY ordinal_position",
                table_name
            );

            let mut col_stmt = conn.prepare(&columns_query)?;
            let columns: Vec<(String, String)> = col_stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<Result<Vec<_>, _>>()?;

            let mut empty_cols = Vec::new();
            for (col_name, col_type) in &columns {
                let check_query = format!(
                    "SELECT COUNT(*) FROM \"{}\" WHERE \"{}\" IS NOT NULL",
                    table_name, col_name
                );
                let non_null_count: i64 = conn.query_row(&check_query, [], |row| row.get(0))?;

                if non_null_count == 0 {
                    empty_cols.push((col_name.clone(), col_type.clone()));
                }
            }

            if !empty_cols.is_empty() {
                tables_with_empty_columns.insert(table_name.clone(), empty_cols);
            }
        }
    }

    // Sort populated tables by row count (descending)
    populated_tables.sort_by(|a, b| b.1.cmp(&a.1));

    // Print summary
    println!("\n{}", "=".repeat(80));
    println!("SUMMARY");
    println!("{}", "=".repeat(80));
    println!("Total tables: {}", tables.len());
    println!("Empty tables: {}", empty_tables.len());
    println!("Populated tables: {}", populated_tables.len());
    println!("Tables with empty columns: {}", tables_with_empty_columns.len());
    println!();

    // Print row counts
    println!("\n{}", "=".repeat(80));
    println!("TABLE ROW COUNTS");
    println!("{}", "=".repeat(80));
    println!("{:<40} {:>15} {}", "Table Name", "Row Count", "Status");
    println!("{}", "-".repeat(80));

    for (table_name, count) in &populated_tables {
        println!("{:<40} {:>15} Populated", table_name, count);
    }

    for table_name in &empty_tables {
        println!("{:<40} {:>15} Empty", table_name, 0);
    }

    // Print empty tables
    if !empty_tables.is_empty() {
        println!("\n{}", "=".repeat(80));
        println!("EMPTY TABLES ({})", empty_tables.len());
        println!("{}", "=".repeat(80));
        for table_name in &empty_tables {
            println!("- {}", table_name);
        }
    }

    // Print tables with empty columns
    if !tables_with_empty_columns.is_empty() {
        println!("\n{}", "=".repeat(80));
        println!("TABLES WITH EMPTY COLUMNS ({})", tables_with_empty_columns.len());
        println!("{}", "=".repeat(80));

        let mut sorted_tables: Vec<_> = tables_with_empty_columns.iter().collect();
        sorted_tables.sort_by_key(|(name, _)| *name);

        for (table_name, empty_cols) in sorted_tables {
            let row_count = populated_tables.iter()
                .find(|(name, _)| name == table_name)
                .map(|(_, count)| *count)
                .unwrap_or(0);

            println!("\n### {} ({} rows)", table_name, row_count);
            println!("\n| Column Name | Data Type |");
            println!("|-------------|-----------|");
            for (col_name, col_type) in empty_cols {
                println!("| {} | {} |", col_name, col_type);
            }
        }
    }

    // Calculate completeness percentage
    let completeness = (populated_tables.len() as f64 / tables.len() as f64) * 100.0;

    println!("\n{}", "=".repeat(80));
    println!("DATA COMPLETENESS");
    println!("{}", "=".repeat(80));
    println!("Overall Table Completeness: {:.1}% ({}/{})",
        completeness, populated_tables.len(), tables.len());

    Ok(())
}
