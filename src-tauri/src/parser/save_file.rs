// ZIP extraction and validation for Old World save files
//
// Security constraints from plan:
// - Maximum compressed size: 50 MB
// - Maximum uncompressed size: 100 MB
// - Maximum entries: 10
// - Reject path traversal attempts
// - Only accept files with .xml extension
// - Maximum compression ratio: 100.0 (zip bomb detection)

use super::{ParseError, Result};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

const MAX_COMPRESSED_SIZE: u64 = 50 * 1024 * 1024; // 50 MB
const MAX_UNCOMPRESSED_SIZE: u64 = 100 * 1024 * 1024; // 100 MB
const MAX_ENTRIES: usize = 10;
const MAX_COMPRESSION_RATIO: f64 = 100.0;

/// Validate and sanitize a file path from ZIP archive
fn validate_zip_path(path: &str) -> Result<()> {
    use std::path::Path;

    // Normalize path separators (handle Windows backslashes)
    let normalized = path.replace('\\', "/");

    // Check for absolute paths
    if normalized.starts_with('/') || Path::new(&normalized).is_absolute() {
        return Err(ParseError::SecurityViolation(format!(
            "Absolute path in ZIP: {}",
            path
        )));
    }

    // Check for path traversal after normalization
    if normalized.contains("..") {
        return Err(ParseError::SecurityViolation(format!(
            "Path traversal attempt: {}",
            path
        )));
    }

    // Check for control characters in filename (potential exploit vector)
    if path.chars().any(|c| c.is_control()) {
        return Err(ParseError::SecurityViolation(format!(
            "Control characters in filename: {}",
            path
        )));
    }

    // Path component validation (no empty segments)
    for component in normalized.split('/') {
        if component.is_empty() || component == "." {
            return Err(ParseError::SecurityViolation(format!(
                "Invalid path component: {}",
                path
            )));
        }
    }

    Ok(())
}

/// Validate and extract XML content from a ZIP file
///
/// # Security
/// - Validates file size limits (compressed and uncompressed)
/// - Checks for zip bombs via compression ratio
/// - Validates paths for traversal attacks
/// - Ensures single XML file in archive
///
/// # Returns
/// The XML content as a String
pub fn validate_and_extract_xml(file_path: &str) -> Result<String> {
    let file = File::open(file_path)?;
    let file_size = file.metadata()?.len();

    // Check compressed file size
    if file_size > MAX_COMPRESSED_SIZE {
        return Err(ParseError::FileTooLarge(file_size, MAX_COMPRESSED_SIZE));
    }

    let mut archive = ZipArchive::new(file)
        .map_err(|e| ParseError::InvalidZipFile(e.to_string()))?;

    // Check number of entries
    if archive.len() > MAX_ENTRIES {
        return Err(ParseError::InvalidArchiveStructure(format!(
            "Too many entries: {} (max: {})",
            archive.len(),
            MAX_ENTRIES
        )));
    }

    // Find and validate XML file
    let mut xml_file = None;
    for i in 0..archive.len() {
        let file = archive.by_index(i)?;

        // Security: Validate path (traversal, absolute paths, control chars)
        let file_name = file.name();
        validate_zip_path(file_name)?;

        // Security: Check uncompressed size
        if file.size() > MAX_UNCOMPRESSED_SIZE {
            return Err(ParseError::FileTooLarge(
                file.size(),
                MAX_UNCOMPRESSED_SIZE,
            ));
        }

        // Security: Check compression ratio (zip bomb detection)
        let compression_ratio = if file.compressed_size() > 0 {
            file.size() as f64 / file.compressed_size() as f64
        } else {
            1.0
        };

        if compression_ratio > MAX_COMPRESSION_RATIO {
            log::warn!(
                "High compression ratio detected: {:.1}x for file: {}",
                compression_ratio,
                file_name
            );
            return Err(ParseError::SecurityViolation(format!(
                "Suspicious compression ratio: {:.1}x (threshold: {:.1}x)",
                compression_ratio, MAX_COMPRESSION_RATIO
            )));
        }

        // Log compression ratio for monitoring/tuning
        if compression_ratio > 10.0 {
            log::debug!(
                "File {} has compression ratio: {:.1}x",
                file_name,
                compression_ratio
            );
        }

        // Find XML file
        if file_name.to_lowercase().ends_with(".xml") {
            if xml_file.is_some() {
                return Err(ParseError::InvalidArchiveStructure(
                    "Multiple XML files found".to_string(),
                ));
            }
            xml_file = Some(i);
        }
    }

    // Extract XML content
    let xml_index = xml_file.ok_or_else(|| {
        ParseError::InvalidArchiveStructure("No XML file found".to_string())
    })?;

    let file = archive.by_index(xml_index)?;
    let mut xml_content = String::new();

    // Read with size limit (redundant check but good defense-in-depth)
    let bytes_read = file
        .take(MAX_UNCOMPRESSED_SIZE + 1)
        .read_to_string(&mut xml_content)?;

    if bytes_read as u64 > MAX_UNCOMPRESSED_SIZE {
        return Err(ParseError::FileTooLarge(
            bytes_read as u64,
            MAX_UNCOMPRESSED_SIZE,
        ));
    }

    // Validate UTF-8 encoding (roxmltree requires UTF-8)
    if !xml_content.is_char_boundary(xml_content.len()) {
        return Err(ParseError::MalformedXML {
            location: "XML file".to_string(),
            message: "Invalid UTF-8 encoding".to_string(),
            context: "File must be UTF-8 encoded".to_string(),
        });
    }

    // Check for XML encoding declaration and warn if non-UTF-8
    if let Some(first_line) = xml_content.lines().next() {
        if first_line.contains("<?xml") {
            if first_line.contains("encoding") && !first_line.contains("UTF-8") {
                log::warn!(
                    "XML declares non-UTF-8 encoding: {}. Attempting to parse as UTF-8.",
                    first_line
                );
            }
        }
    }

    Ok(xml_content)
}

/// Compute SHA-256 hash of file contents
pub fn compute_file_hash(file_path: &str) -> Result<String> {
    use std::fs;

    let contents = fs::read(file_path)?;
    let hash = sha256::digest(&contents[..]);
    Ok(hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_zip_path_normal() {
        assert!(validate_zip_path("file.xml").is_ok());
        assert!(validate_zip_path("subdir/file.xml").is_ok());
    }

    #[test]
    fn test_validate_zip_path_traversal() {
        assert!(validate_zip_path("../file.xml").is_err());
        assert!(validate_zip_path("subdir/../../file.xml").is_err());
    }

    #[test]
    fn test_validate_zip_path_absolute() {
        assert!(validate_zip_path("/etc/passwd").is_err());
    }

    #[test]
    fn test_validate_zip_path_control_chars() {
        assert!(validate_zip_path("file\0.xml").is_err());
    }

    #[test]
    fn test_validate_zip_path_empty_component() {
        assert!(validate_zip_path("./file.xml").is_err());
        assert!(validate_zip_path("subdir//file.xml").is_err());
    }
}
