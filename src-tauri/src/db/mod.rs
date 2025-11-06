// Database module for DuckDB operations

pub mod connection;
pub mod schema;

pub use connection::get_connection;
pub use schema::ensure_schema_ready;
