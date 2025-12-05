// XML parsing with roxmltree
//
// Strategy from plan:
// - For files < 20 MB: Full DOM with roxmltree
// - For files >= 20 MB: Hybrid streaming + targeted DOM (future optimization)
//
// Currently implements full DOM approach for simplicity

use super::{ParseError, Result};
use roxmltree::Document;

const LARGE_FILE_THRESHOLD: usize = 20 * 1024 * 1024; // 20 MB

/// XML parse strategy
pub enum XmlDocument {
    /// Full DOM for small files (< 20 MB)
    FullDom(String, Document<'static>),
    // Future: StreamingHybrid for large files
}

impl XmlDocument {
    /// Get the root element
    pub fn root_element(&self) -> roxmltree::Node<'_, '_> {
        match self {
            XmlDocument::FullDom(_, doc) => doc.root_element(),
        }
    }

    /// Get the underlying document (for full DOM strategy)
    pub fn document(&self) -> &Document<'_> {
        match self {
            XmlDocument::FullDom(_, doc) => doc,
        }
    }

    /// Get the XML content string
    pub fn xml_content(&self) -> &str {
        match self {
            XmlDocument::FullDom(content, _) => content,
        }
    }
}

/// Parse XML content into an XmlDocument
///
/// For files < 20 MB: Full DOM parsing
/// For files >= 20 MB: Same as small files for now (future: hybrid streaming)
pub fn parse_xml(xml_content: String) -> Result<XmlDocument> {
    if xml_content.len() < LARGE_FILE_THRESHOLD {
        // Small file: full DOM
        parse_full_dom(xml_content)
    } else {
        // Large file: use full DOM for now (future: hybrid streaming)
        log::warn!(
            "Parsing large XML file ({} bytes) with full DOM. Consider implementing hybrid streaming.",
            xml_content.len()
        );
        parse_full_dom(xml_content)
    }
}

fn parse_full_dom(xml_content: String) -> Result<XmlDocument> {
    // Parse into Document
    // Note: We need to leak the string to get a 'static lifetime for Document
    // This is safe because XmlDocument owns the string
    let content_static: &'static str = Box::leak(xml_content.clone().into_boxed_str());
    let doc = Document::parse(content_static).map_err(|e| {
        let position = e.pos();
        ParseError::MalformedXML {
            location: format!("line {}, col {}", position.row, position.col),
            message: e.to_string(),
            context: super::create_xml_context(&xml_content, 0),
        }
    })?;

    // Validate root element is <Root>
    let root = doc.root_element();
    if !root.has_tag_name("Root") {
        return Err(ParseError::MalformedXML {
            location: "root element".to_string(),
            message: format!("Expected <Root>, found <{}>", root.tag_name().name()),
            context: "XML must have <Root> as the root element".to_string(),
        });
    }

    Ok(XmlDocument::FullDom(xml_content, doc))
}

/// Helper trait for roxmltree nodes with better error handling
pub trait XmlNodeExt {
    /// Get required attribute with error context
    fn req_attr(&self, name: &str) -> Result<&str>;

    /// Get optional attribute
    fn opt_attr(&self, name: &str) -> Option<&str>;

    /// Get required child element text
    fn req_child_text(&self, name: &str) -> Result<&str>;

    /// Get optional child element text
    fn opt_child_text(&self, name: &str) -> Option<&str>;

    /// Get element path for error messages (e.g., "/Root/Player[ID=0]/Character[ID=5]")
    fn element_path(&self) -> String;
}

impl<'a, 'input: 'a> XmlNodeExt for roxmltree::Node<'a, 'input> {
    fn req_attr(&self, name: &str) -> Result<&str> {
        let path = self.element_path();
        self.attribute(name).ok_or_else(|| {
            ParseError::MissingAttribute(format!("{}.{}", path, name))
        })
    }

    fn opt_attr(&self, name: &str) -> Option<&str> {
        self.attribute(name)
    }

    fn req_child_text(&self, name: &str) -> Result<&str> {
        let path = self.element_path();
        self.children()
            .find(|n| n.has_tag_name(name))
            .and_then(|n| n.text())
            .ok_or_else(|| ParseError::MissingElement(format!("{}/{}", path, name)))
    }

    fn opt_child_text(&self, name: &str) -> Option<&str> {
        self.children()
            .find(|n| n.has_tag_name(name))
            .and_then(|n| n.text())
    }

    fn element_path(&self) -> String {
        let mut path = String::new();
        let mut current = Some(*self);

        while let Some(node) = current {
            if node.is_element() {
                let tag_name = node.tag_name().name();

                // Add ID attribute if present for disambiguation
                let id_suffix = node
                    .attribute("ID")
                    .map(|id| format!("[ID={}]", id))
                    .unwrap_or_default();

                path = format!("/{}{}{}", tag_name, id_suffix, path);
            }
            current = node.parent_element();
        }

        if path.is_empty() {
            "/".to_string()
        } else {
            path
        }
    }
}

/// Centralized sentinel value constants and normalization
pub mod sentinels {
    pub const ID_NONE: i32 = -1;
    pub const TURN_INVALID: i32 = -1;
    pub const COUNT_NONE: i32 = -1;

    /// Normalize sentinel ID to None
    pub fn normalize_id(id: i32) -> Option<i32> {
        if id == ID_NONE {
            None
        } else {
            Some(id)
        }
    }

    /// Normalize sentinel turn to None
    pub fn normalize_turn(turn: i32) -> Option<i32> {
        if turn == TURN_INVALID || turn < 0 {
            None
        } else {
            Some(turn)
        }
    }

    /// Normalize empty string to None
    pub fn normalize_string(s: &str) -> Option<String> {
        if s.is_empty() {
            None
        } else {
            Some(s.to_string())
        }
    }

    /// Validate turn is in reasonable range (strict mode)
    pub fn validate_turn(turn: i32, max_expected: i32) -> bool {
        turn >= 0 && turn <= max_expected
    }

    /// Validate count is non-negative (strict mode)
    pub fn validate_count(count: i32) -> bool {
        count >= 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_xml() {
        let xml = r#"<Root GameId="test-123"><Player ID="0">Player1</Player></Root>"#;
        let doc = parse_xml(xml.to_string()).unwrap();

        let root = doc.root_element();
        assert_eq!(root.tag_name().name(), "Root");
        assert_eq!(root.attribute("GameId"), Some("test-123"));
    }

    #[test]
    fn test_parse_invalid_root() {
        let xml = r#"<Game><Player ID="0">Player1</Player></Game>"#;
        let result = parse_xml(xml.to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_xml_node_ext_req_attr() {
        let xml = r#"<Root GameId="test-123"></Root>"#;
        let doc = parse_xml(xml.to_string()).unwrap();
        let root = doc.root_element();

        assert_eq!(root.req_attr("GameId").unwrap(), "test-123");
        assert!(root.req_attr("Missing").is_err());
    }

    #[test]
    fn test_xml_node_ext_element_path() {
        let xml = r#"<Root><Player ID="5"><Character ID="10">Test</Character></Player></Root>"#;
        let doc = parse_xml(xml.to_string()).unwrap();
        let char_node = doc
            .root_element()
            .children()
            .find(|n| n.has_tag_name("Player"))
            .unwrap()
            .children()
            .find(|n| n.has_tag_name("Character"))
            .unwrap();

        let path = char_node.element_path();
        assert_eq!(path, "/Root/Player[ID=5]/Character[ID=10]");
    }

    #[test]
    fn test_sentinel_normalize_id() {
        assert_eq!(sentinels::normalize_id(-1), None);
        assert_eq!(sentinels::normalize_id(5), Some(5));
    }

    #[test]
    fn test_sentinel_normalize_string() {
        assert_eq!(sentinels::normalize_string(""), None);
        assert_eq!(sentinels::normalize_string("test"), Some("test".to_string()));
    }
}
