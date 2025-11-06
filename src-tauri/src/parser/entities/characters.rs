// Character entity parser
//
// Two-pass strategy:
// - Pass 1 (this): Core character data without relationships
// - Pass 2 (separate): Parent relationships, marriages, relationships

use crate::parser::id_mapper::IdMapper;
use crate::parser::xml_loader::{sentinels, XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};
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
    let mut count = 0;

    // Find all Character elements as direct children of Root
    for char_node in root.children().filter(|n| n.has_tag_name("Character")) {
        let xml_id = char_node.req_attr("ID")?.parse::<i32>()?;
        let db_id = id_mapper.map_character(xml_id);

        // Identity - stored as ATTRIBUTES on Character element
        let first_name = char_node.opt_attr("FirstName");
        let gender = char_node.opt_attr("Gender");

        // Player affiliation (optional - tribal characters have Player="-1")
        let player_xml_id = char_node
            .opt_attr("Player")
            .and_then(|s| s.parse::<i32>().ok())
            .filter(|&id| id >= 0); // Filter out -1 (tribal characters)
        let player_db_id = match player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        let tribe = char_node.opt_child_text("Tribe");

        // Birth and death - BirthTurn is an attribute, DeathTurn is a child element
        let birth_turn = char_node
            .req_attr("BirthTurn")?
            .parse::<i32>()?;
        let death_turn = char_node
            .opt_child_text("DeathTurn")
            .and_then(|s| s.parse::<i32>().ok());
        let death_reason = char_node.opt_child_text("DeathReason");

        // NOTE: Parent relationships (birth_father_id, birth_mother_id) are NULL in Pass 1
        // They will be filled in Pass 2 via UPDATE statements

        // Affiliations
        let family = char_node.opt_child_text("Family");
        let nation = char_node.opt_child_text("Nation");
        let religion = char_node.opt_child_text("Religion");

        // Titles and roles
        let cognomen = char_node.opt_child_text("Cognomen");
        let archetype = char_node.opt_child_text("Archetype");
        let portrait = char_node.opt_child_text("Portrait");

        // Progression
        let xp = char_node
            .opt_child_text("XP")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);
        let level = char_node
            .opt_child_text("Level")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(1);

        // Core attributes (1-10)
        let wisdom = char_node
            .opt_child_text("Wisdom")
            .and_then(|s| s.parse::<i32>().ok());
        let charisma = char_node
            .opt_child_text("Charisma")
            .and_then(|s| s.parse::<i32>().ok());
        let courage = char_node
            .opt_child_text("Courage")
            .and_then(|s| s.parse::<i32>().ok());
        let discipline = char_node
            .opt_child_text("Discipline")
            .and_then(|s| s.parse::<i32>().ok());

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

        // Insert character using UPSERT (Pass 1: NULL for parent relationships)
        // Note: character_id is NOT updated on conflict - it must remain stable
        conn.execute(
            "INSERT INTO characters (
                character_id, match_id, xml_id, first_name, gender, player_id, tribe,
                birth_turn, death_turn, death_reason,
                birth_father_id, birth_mother_id,
                family, nation, religion,
                cognomen, archetype, portrait,
                xp, level,
                wisdom, charisma, courage, discipline,
                is_royal, is_infertile, became_leader_turn
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (match_id, xml_id) DO UPDATE SET
                first_name = excluded.first_name,
                gender = excluded.gender,
                player_id = excluded.player_id,
                tribe = excluded.tribe,
                birth_turn = excluded.birth_turn,
                death_turn = excluded.death_turn,
                death_reason = excluded.death_reason,
                family = excluded.family,
                nation = excluded.nation,
                religion = excluded.religion,
                cognomen = excluded.cognomen,
                archetype = excluded.archetype,
                portrait = excluded.portrait,
                xp = excluded.xp,
                level = excluded.level,
                wisdom = excluded.wisdom,
                charisma = excluded.charisma,
                courage = excluded.courage,
                discipline = excluded.discipline,
                is_royal = excluded.is_royal,
                is_infertile = excluded.is_infertile,
                became_leader_turn = excluded.became_leader_turn",
            params![
                db_id,
                id_mapper.match_id,
                xml_id,
                first_name,
                gender,
                player_db_id,
                tribe,
                birth_turn,
                death_turn,
                death_reason,
                // birth_father_id and birth_mother_id are NULL in Pass 1
                family,
                nation,
                religion,
                cognomen,
                archetype,
                portrait,
                xp,
                level,
                wisdom,
                charisma,
                courage,
                discipline,
                is_royal,
                is_infertile,
                became_leader_turn
            ],
        )?;

        count += 1;
    }

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
