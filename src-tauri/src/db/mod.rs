// Database module for DuckDB operations

pub mod connection;
pub mod schema;
pub mod settings;

pub use connection::get_connection;
pub use schema::{create_schema, delete_database_files, drop_all_schema_objects, ensure_schema_ready};
pub use settings::{get_primary_user_online_id, set_primary_user_online_id};
