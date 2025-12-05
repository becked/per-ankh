// Religion entity parser - pure parsing (no DB dependency)

use crate::parser::game_data::ReligionData;
use crate::parser::xml_loader::XmlDocument;
use crate::parser::Result;
use std::collections::HashMap;

/// Parse religions to structs (no DB dependency)
///
/// Religions are not exported as individual elements in Old World saves.
/// Instead, they appear in aggregate containers under the Game element:
/// - ReligionFounded: Maps religion names to founding turn
/// - ReligionHeadID: Maps religion names to current head character ID
/// - ReligionHolyCity: Maps religion names to holy city ID
/// - ReligionFounder: Maps religion names to founding player ID
pub fn parse_religions_struct(doc: &XmlDocument) -> Result<Vec<ReligionData>> {
    let root = doc.root_element();

    // Religion containers are inside the Game element
    let game_node = match root.children().find(|n| n.has_tag_name("Game")) {
        Some(node) => node,
        None => return Ok(Vec::new()),
    };

    // Collect all religion names and their data from various containers
    let mut religions: HashMap<String, ReligionDataBuilder> = HashMap::new();

    // Parse ReligionFounded container
    if let Some(founded_node) = game_node
        .children()
        .find(|n| n.has_tag_name("ReligionFounded"))
    {
        for child in founded_node.children().filter(|n| n.is_element()) {
            let religion_name = child.tag_name().name();
            let founded_turn = child.text().and_then(|s| s.parse::<i32>().ok());
            religions
                .entry(religion_name.to_string())
                .or_default()
                .founded_turn = founded_turn;
        }
    }

    // Parse ReligionHeadID container
    if let Some(head_node) = game_node
        .children()
        .find(|n| n.has_tag_name("ReligionHeadID"))
    {
        for child in head_node.children().filter(|n| n.is_element()) {
            let religion_name = child.tag_name().name();
            let head_id = child.text().and_then(|s| s.parse::<i32>().ok());
            religions
                .entry(religion_name.to_string())
                .or_default()
                .head_character_xml_id = head_id;
        }
    }

    // Parse ReligionHolyCity container
    if let Some(holy_city_node) = game_node
        .children()
        .find(|n| n.has_tag_name("ReligionHolyCity"))
    {
        for child in holy_city_node.children().filter(|n| n.is_element()) {
            let religion_name = child.tag_name().name();
            let city_id = child.text().and_then(|s| s.parse::<i32>().ok());
            religions
                .entry(religion_name.to_string())
                .or_default()
                .holy_city_xml_id = city_id;
        }
    }

    // Parse ReligionFounder container
    if let Some(founder_node) = game_node
        .children()
        .find(|n| n.has_tag_name("ReligionFounder"))
    {
        for child in founder_node.children().filter(|n| n.is_element()) {
            let religion_name = child.tag_name().name();
            let founder_id = child.text().and_then(|s| s.parse::<i32>().ok());
            religions
                .entry(religion_name.to_string())
                .or_default()
                .founder_player_xml_id = founder_id;
        }
    }

    // Convert to Vec<ReligionData>
    let result = religions
        .into_iter()
        .map(|(religion_name, builder)| ReligionData {
            religion_name,
            founded_turn: builder.founded_turn,
            founder_player_xml_id: builder.founder_player_xml_id,
            head_character_xml_id: builder.head_character_xml_id,
            holy_city_xml_id: builder.holy_city_xml_id,
        })
        .collect();

    Ok(result)
}

#[derive(Default)]
struct ReligionDataBuilder {
    founded_turn: Option<i32>,
    head_character_xml_id: Option<i32>,
    holy_city_xml_id: Option<i32>,
    founder_player_xml_id: Option<i32>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_religions_struct() {
        let xml = r#"<Root GameId="test-123">
            <Game>
                <ReligionFounded>
                    <RELIGION_CHRISTIANITY>45</RELIGION_CHRISTIANITY>
                    <RELIGION_JUDAISM>12</RELIGION_JUDAISM>
                </ReligionFounded>
                <ReligionHeadID>
                    <RELIGION_CHRISTIANITY>100</RELIGION_CHRISTIANITY>
                </ReligionHeadID>
                <ReligionHolyCity>
                    <RELIGION_CHRISTIANITY>5</RELIGION_CHRISTIANITY>
                    <RELIGION_JUDAISM>3</RELIGION_JUDAISM>
                </ReligionHolyCity>
                <ReligionFounder>
                    <RELIGION_CHRISTIANITY>0</RELIGION_CHRISTIANITY>
                </ReligionFounder>
            </Game>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let religions = parse_religions_struct(&doc).unwrap();

        assert_eq!(religions.len(), 2);

        let christianity = religions
            .iter()
            .find(|r| r.religion_name == "RELIGION_CHRISTIANITY")
            .unwrap();
        assert_eq!(christianity.founded_turn, Some(45));
        assert_eq!(christianity.head_character_xml_id, Some(100));
        assert_eq!(christianity.holy_city_xml_id, Some(5));
        assert_eq!(christianity.founder_player_xml_id, Some(0));
    }
}
