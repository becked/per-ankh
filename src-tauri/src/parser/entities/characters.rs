// Character entity parser
//
// Two-pass strategy:
// - Pass 1 (this): Core character data without relationships
// - Pass 2 (separate): Parent relationships, marriages, relationships

use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::Result;
use duckdb::{params, Connection};

/// Parse all characters from the XML document (Pass 1: Core data only)
///
/// This inserts characters WITHOUT parent relationships (birth_father_id, birth_mother_id)
/// Those will be filled in Pass 2 after all characters exist
pub fn parse_characters_core(
    doc: &XmlDocument,
    conn: &Connection,
    id_mapper: &mut IdMapper,
) -> Result<usize> {
    let root = doc.root_element();

    // Collect all character rows first
    let mut characters = Vec::new();

    // Find all Character elements as direct children of Root
    for char_node in root.children().filter(|n| n.has_tag_name("Character")) {
        let xml_id = char_node.req_attr("ID")?.parse::<i32>()?;
        let db_id = id_mapper.map_character(xml_id);

        // Identity - stored as ATTRIBUTES on Character element
        let first_name = char_node.opt_attr("FirstName").map(|s| s.to_string());
        let gender = char_node.opt_attr("Gender").map(|s| s.to_string());

        // Player affiliation (optional - tribal characters have Player="-1")
        let player_xml_id = char_node
            .opt_attr("Player")
            .and_then(|s| s.parse::<i32>().ok())
            .filter(|&id| id >= 0); // Filter out -1 (tribal characters)
        let player_db_id = match player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        let tribe = char_node.opt_child_text("Tribe").map(|s| s.to_string());

        // Birth and death - BirthTurn is an attribute, DeathTurn is a child element
        let birth_turn = char_node
            .req_attr("BirthTurn")?
            .parse::<i32>()?;
        let death_turn = char_node
            .opt_child_text("DeathTurn")
            .and_then(|s| s.parse::<i32>().ok());
        let death_reason = char_node.opt_child_text("DeathReason").map(|s| s.to_string());

        // NOTE: Parent relationships (birth_father_id, birth_mother_id) are NULL in Pass 1
        // They will be filled in Pass 2 via UPDATE statements

        // Affiliations
        let family = char_node.opt_child_text("Family").map(|s| s.to_string());
        let nation = char_node.opt_child_text("Nation").map(|s| s.to_string());
        let religion = char_node.opt_child_text("Religion").map(|s| s.to_string());

        // Titles and roles
        let cognomen = char_node.opt_child_text("Cognomen").map(|s| s.to_string());
        let archetype = char_node.opt_child_text("Archetype").map(|s| s.to_string());
        let portrait = char_node.opt_child_text("Portrait").map(|s| s.to_string());

        // Progression
        let xp = char_node
            .opt_child_text("XP")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);
        let level = char_node
            .opt_child_text("Level")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(1);

        // Note: Core attributes (wisdom, charisma, courage, discipline) are stored in
        // character_stats table via Rating elements, not as direct columns on characters

        // Status flags
        let is_royal = char_node
            .opt_child_text("IsRoyal")
            .and_then(|s| s.parse::<bool>().ok())
            .unwrap_or(false);
        let is_infertile = char_node
            .opt_child_text("IsInfertile")
            .and_then(|s| s.parse::<bool>().ok())
            .unwrap_or(false);

        // Leadership
        let became_leader_turn = char_node
            .opt_child_text("BecameLeaderTurn")
            .and_then(|s| s.parse::<i32>().ok());

        // Collect row data (Pass 1: NULL for parent relationships)
        // Must match schema column order exactly
        characters.push((
            db_id,                  // character_id
            id_mapper.match_id,     // match_id
            xml_id,                 // xml_id
            first_name,             // first_name
            gender,                 // gender
            player_db_id,           // player_id
            tribe,                  // tribe
            birth_turn,             // birth_turn
            None::<i32>,            // birth_city_id - not parsed yet
            death_turn,             // death_turn
            death_reason,           // death_reason
            None::<i64>,            // birth_father_id - NULL in Pass 1
            None::<i64>,            // birth_mother_id - NULL in Pass 1
            family,                 // family
            nation,                 // nation
            religion,               // religion
            cognomen,               // cognomen
            archetype,              // archetype
            portrait,               // portrait
            xp,                     // xp
            level,                  // level
            is_royal,               // is_royal
            is_infertile,           // is_infertile
            became_leader_turn,     // became_leader_turn
            None::<i32>,            // abdicated_turn - not parsed yet
            false,                  // was_religion_head - default false
            false,                  // was_family_head - default false
            None::<i32>,            // nation_joined_turn - not parsed yet
            None::<i64>             // seed - not parsed yet
        ));
    }

    // Deduplicate (last-wins strategy)
    // Primary key: (character_id, match_id)
    let unique_characters = deduplicate_rows_last_wins(
        characters,
        |(char_id, match_id, ..)| (*char_id, *match_id)
    );

    let count = unique_characters.len();

    // Bulk insert deduplicated rows
    let mut app = conn.appender("characters")?;
    for (db_id, match_id, xml_id, first_name, gender, player_db_id, tribe, birth_turn,
         birth_city_id, death_turn, death_reason, birth_father_id, birth_mother_id,
         family, nation, religion, cognomen, archetype, portrait, xp, level, is_royal,
         is_infertile, became_leader_turn, abdicated_turn, was_religion_head,
         was_family_head, nation_joined_turn, seed) in unique_characters
    {
        app.append_row(params![
            db_id, match_id, xml_id, first_name, gender, player_db_id, tribe, birth_turn,
            birth_city_id, death_turn, death_reason, birth_father_id, birth_mother_id,
            family, nation, religion, cognomen, archetype, portrait, xp, level, is_royal,
            is_infertile, became_leader_turn, abdicated_turn, was_religion_head,
            was_family_head, nation_joined_turn, seed
        ])?;
    }

    // Flush appender to commit all rows
    drop(app);

    log::info!("Parsed {} characters (Pass 1: core data)", count);
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_characters_basic() {
        let xml = r#"<Root GameId="test-123">
            <Character ID="5">
                <FirstName>Hantili</FirstName>
                <Gender>GENDER_MALE</Gender>
                <BirthTurn>10</BirthTurn>
                <Wisdom>8</Wisdom>
                <Charisma>6</Charisma>
            </Character>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();

        let root = doc.root_element();
        let char_node = root
            .children()
            .find(|n| n.has_tag_name("Character"))
            .unwrap();

        assert_eq!(char_node.req_attr("ID").unwrap(), "5");
        assert_eq!(char_node.req_child_text("FirstName").unwrap(), "Hantili");
    }
}
