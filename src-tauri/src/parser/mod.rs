// Parser module for Old World save file ingestion
//
// This module handles:
// - ZIP extraction and validation
// - XML parsing
// - ID mapping (XML IDs -> Database IDs)
// - Match identification

pub mod save_file;
pub mod xml_loader;
pub mod id_mapper;
pub mod import;
pub mod entities;
pub mod utils;
pub mod game_data;
pub mod parsers;
pub mod inserters;

#[cfg(test)]
mod tests;

pub use import::{import_save_file, ImportResult};

use std::num::ParseIntError;

/// Parser error types
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("Invalid ZIP file: {0}")]
    InvalidZipFile(String),

    #[error("Invalid archive structure: {0}")]
    InvalidArchiveStructure(String),

    #[error("File too large: {0} bytes (max: {1} bytes)")]
    FileTooLarge(u64, u64),

    #[error("Security violation: {0}")]
    SecurityViolation(String),

    #[error("Malformed XML at {location}: {message}\nContext: {context}")]
    MalformedXML {
        location: String,
        message: String,
        context: String,
    },

    #[error("Missing required attribute: {0}")]
    MissingAttribute(String),

    #[error("Missing required element: {0}")]
    MissingElement(String),

    #[error("Invalid data format: {0}")]
    InvalidFormat(String),

    #[error("Schema not initialized: {0}")]
    SchemaNotInitialized(String),

    #[error("Concurrency lock error: {0}")]
    ConcurrencyLock(String),

    #[error("Schema upgrade required: {0}")]
    SchemaUpgrade(String),

    #[error("Database error: {0}")]
    DatabaseError(#[from] duckdb::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("ZIP error: {0}")]
    ZipError(#[from] zip::result::ZipError),

    #[error("XML error: {0}")]
    XmlError(#[from] roxmltree::Error),

    #[error("Parse int error: {0}")]
    ParseIntError(#[from] ParseIntError),

    #[error("Unknown player ID: {0} at {1}")]
    UnknownPlayerId(i32, String),

    #[error("Unknown character ID: {0} at {1}")]
    UnknownCharacterId(i32, String),

    #[error("Unknown city ID: {0} at {1}")]
    UnknownCityId(i32, String),

    #[error("Unknown unit ID: {0} at {1}")]
    UnknownUnitId(i32, String),

    #[error("Unknown tile ID: {0} at {1}")]
    UnknownTileId(i32, String),

    #[error("Unknown family ID: {0} at {1}")]
    UnknownFamilyId(i32, String),

    #[error("Unknown religion ID: {0} at {1}")]
    UnknownReligionId(i32, String),

    #[error("Unknown tribe ID: {0} at {1}")]
    UnknownTribeId(i32, String),
}

/// Result type alias for parser operations
pub type Result<T> = std::result::Result<T, ParseError>;

/// Helper to create XML context excerpt (capped at 300 chars)
pub fn create_xml_context(xml: &str, position: usize) -> String {
    const CONTEXT_SIZE: usize = 150;
    let start = position.saturating_sub(CONTEXT_SIZE);
    let end = (position + CONTEXT_SIZE).min(xml.len());
    let excerpt = &xml[start..end];

    if start > 0 && end < xml.len() {
        format!("...{}...", excerpt)
    } else if start > 0 {
        format!("...{}", excerpt)
    } else if end < xml.len() {
        format!("{}...", excerpt)
    } else {
        excerpt.to_string()
    }
}
