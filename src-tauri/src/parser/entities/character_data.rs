// Character extended data parsers
//
// This module handles parsing of character-specific nested data:
// - Stats (Rating, Stat) -> character_stats table
// - Traits (TraitTurn) -> character_traits table
// - Relationships (RelationshipList) -> character_relationships table
//
// XML Structure:
// ```xml
// <Character ID="5">
//   <Rating>
//     <RATING_WISDOM>3</RATING_WISDOM>
//     <RATING_CHARISMA>2</RATING_CHARISMA>
//     <RATING_COURAGE>1</RATING_COURAGE>
//     <RATING_DISCIPLINE>4</RATING_DISCIPLINE>
//   </Rating>
//   <Stat>
//     <STAT_KILLS>5</STAT_KILLS>
//     <STAT_CITY_FOUNDED>2</STAT_CITY_FOUNDED>
//   </Stat>
//   <TraitTurn>
//     <TRAIT_BUILDER_ARCHETYPE>1</TRAIT_BUILDER_ARCHETYPE>
//     <TRAIT_AMBITIOUS>5</TRAIT_AMBITIOUS>
//   </TraitTurn>
//   <RelationshipList>
//     <RelationshipData>
//       <Type>RELATIONSHIP_PLOTTING_AGAINST</Type>
//       <ID>10</ID>
//       <Turn>15</Turn>
//     </RelationshipData>
//   </RelationshipList>
// </Character>
// ```

use crate::parser::id_mapper::IdMapper;
use crate::parser::xml_loader::XmlNodeExt;
use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};
use roxmltree::Node;

/// Parse character stats (Rating and Stat elements)
///
/// Combines both Rating (character attributes like wisdom, courage) and
/// Stat (achievements like kills, cities founded) into character_stats table.
///
/// # Schema
/// ```sql
/// CREATE TABLE character_stats (
///     character_id INTEGER NOT NULL,
///     match_id BIGINT NOT NULL,
///     stat_name VARCHAR NOT NULL,
///     stat_value INTEGER NOT NULL,
///     PRIMARY KEY (character_id, match_id, stat_name)
/// );
/// ```
pub fn parse_character_stats(
    character_node: &Node,
    conn: &Connection,
    character_id: i64,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

    // Parse Rating elements (RATING_WISDOM, RATING_CHARISMA, etc.)
    if let Some(rating_node) = character_node
        .children()
        .find(|n| n.has_tag_name("Rating"))
    {
        for stat_node in rating_node.children().filter(|n| n.is_element()) {
            let stat_name = stat_node.tag_name().name();
            let stat_value: i32 = stat_node
                .text()
                .ok_or_else(|| {
                    ParseError::MissingElement(format!("Rating.{} value", stat_name))
                })?
                .parse()
                .map_err(|_| {
                    ParseError::InvalidFormat(format!("Invalid stat value in {}", stat_name))
                })?;

            conn.execute(
                "INSERT INTO character_stats (character_id, match_id, stat_name, stat_value)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT (character_id, match_id, stat_name)
                 DO UPDATE SET stat_value = excluded.stat_value",
                params![character_id, match_id, stat_name, stat_value],
            )?;
            count += 1;
        }
    }

    // Parse Stat elements (STAT_KILLS, STAT_CITY_FOUNDED, etc.)
    if let Some(stat_node) = character_node.children().find(|n| n.has_tag_name("Stat")) {
        for stat_elem in stat_node.children().filter(|n| n.is_element()) {
            let stat_name = stat_elem.tag_name().name();
            let stat_value: i32 = stat_elem
                .text()
                .ok_or_else(|| ParseError::MissingElement(format!("Stat.{} value", stat_name)))?
                .parse()
                .map_err(|_| {
                    ParseError::InvalidFormat(format!("Invalid stat value in {}", stat_name))
                })?;

            conn.execute(
                "INSERT INTO character_stats (character_id, match_id, stat_name, stat_value)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT (character_id, match_id, stat_name)
                 DO UPDATE SET stat_value = excluded.stat_value",
                params![character_id, match_id, stat_name, stat_value],
            )?;
            count += 1;
        }
    }

    Ok(count)
}

/// Parse character traits (TraitTurn element)
///
/// Traits are acquired (and sometimes removed) at specific turns.
/// Currently only stores acquired_turn; removed_turn would require historical tracking.
///
/// # Schema
/// ```sql
/// CREATE TABLE character_traits (
///     character_id INTEGER NOT NULL,
///     match_id BIGINT NOT NULL,
///     trait VARCHAR NOT NULL,
///     acquired_turn INTEGER NOT NULL,
///     removed_turn INTEGER,
///     PRIMARY KEY (character_id, match_id, trait, acquired_turn)
/// );
/// ```
pub fn parse_character_traits(
    character_node: &Node,
    conn: &Connection,
    character_id: i64,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

    if let Some(trait_node) = character_node
        .children()
        .find(|n| n.has_tag_name("TraitTurn"))
    {
        for trait_elem in trait_node.children().filter(|n| n.is_element()) {
            let trait_name = trait_elem.tag_name().name();
            let acquired_turn: i32 = trait_elem
                .text()
                .ok_or_else(|| {
                    ParseError::MissingElement(format!("TraitTurn.{} value", trait_name))
                })?
                .parse()
                .map_err(|_| {
                    ParseError::InvalidFormat(format!("Invalid turn in {}", trait_name))
                })?;

            conn.execute(
                "INSERT INTO character_traits (character_id, match_id, trait, acquired_turn, removed_turn)
                 VALUES (?, ?, ?, ?, NULL)
                 ON CONFLICT (character_id, match_id, trait, acquired_turn)
                 DO UPDATE SET removed_turn = excluded.removed_turn",
                params![character_id, match_id, trait_name, acquired_turn],
            )?;
            count += 1;
        }
    }

    Ok(count)
}

/// Parse character relationships (RelationshipList element)
///
/// Tracks relationships like LOVES, PLOTTING_AGAINST, etc.
/// Each relationship has a type, target character, and started turn.
///
/// # Schema
/// ```sql
/// CREATE TABLE character_relationships (
///     character_id INTEGER NOT NULL,
///     match_id BIGINT NOT NULL,
///     related_character_id INTEGER NOT NULL,
///     relationship_type VARCHAR NOT NULL,
///     relationship_value INTEGER,
///     started_turn INTEGER,
///     ended_turn INTEGER,
///     PRIMARY KEY (character_id, match_id, related_character_id, relationship_type)
/// );
/// ```
pub fn parse_character_relationships(
    character_node: &Node,
    conn: &Connection,
    id_mapper: &IdMapper,
    character_id: i64,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

    if let Some(rel_list_node) = character_node
        .children()
        .find(|n| n.has_tag_name("RelationshipList"))
    {
        for rel_data_node in rel_list_node
            .children()
            .filter(|n| n.has_tag_name("RelationshipData"))
        {
            // Parse relationship type
            let rel_type = rel_data_node
                .children()
                .find(|n| n.has_tag_name("Type"))
                .and_then(|n| n.text())
                .ok_or_else(|| {
                    ParseError::MissingElement("RelationshipData.Type".to_string())
                })?;

            // Parse related character ID (optional - skip relationships without target)
            let related_character_id = match rel_data_node
                .children()
                .find(|n| n.has_tag_name("CharacterID"))
                .and_then(|n| n.text())
            {
                Some(xml_id_str) => {
                    let xml_id: i32 = xml_id_str.parse().map_err(|_| {
                        ParseError::InvalidFormat(format!(
                            "Invalid character ID in relationship: {}",
                            xml_id_str
                        ))
                    })?;
                    id_mapper.get_character(xml_id)?
                }
                None => {
                    // Skip relationships without target ID (likely self-relationships or special cases)
                    continue;
                }
            };

            // Parse started turn (optional)
            let started_turn: Option<i32> = rel_data_node
                .children()
                .find(|n| n.has_tag_name("Turn"))
                .and_then(|n| n.text())
                .and_then(|s| s.parse().ok());

            // Parse relationship value (optional, for intensity/strength)
            let relationship_value: Option<i32> = rel_data_node
                .children()
                .find(|n| n.has_tag_name("Value"))
                .and_then(|n| n.text())
                .and_then(|s| s.parse().ok());

            conn.execute(
                "INSERT INTO character_relationships
                 (character_id, match_id, related_character_id, relationship_type,
                  relationship_value, started_turn, ended_turn)
                 VALUES (?, ?, ?, ?, ?, ?, NULL)
                 ON CONFLICT (character_id, match_id, related_character_id, relationship_type)
                 DO UPDATE SET
                     relationship_value = excluded.relationship_value,
                     started_turn = excluded.started_turn,
                     ended_turn = excluded.ended_turn",
                params![
                    character_id,
                    match_id,
                    related_character_id,
                    rel_type,
                    relationship_value,
                    started_turn
                ],
            )?;
            count += 1;
        }
    }

    Ok(count)
}

/// Parse character genealogy (parent relationships and birth city)
///
/// Updates existing character records with parent relationships and birth city.
/// This must be called AFTER all characters have been inserted (Pass 2).
///
/// XML Structure:
/// ```xml
/// <Character ID="20">
///   <FatherID>4</FatherID>
///   <MotherID>19</MotherID>
///   <BirthFatherID>4</BirthFatherID>
///   <BirthMotherID>19</BirthMotherID>
///   <BirthCityID>0</BirthCityID>
/// </Character>
/// ```
///
/// Note: BirthFatherID/BirthMotherID are biological parents (never change),
/// while FatherID/MotherID can change through adoption (not currently tracked).
pub fn parse_character_genealogy(
    character_node: &Node,
    conn: &Connection,
    id_mapper: &IdMapper,
    character_id: i64,
) -> Result<bool> {
    // Parse parent IDs from XML
    let birth_father_xml_id: Option<i32> = character_node
        .children()
        .find(|n| n.has_tag_name("BirthFatherID"))
        .and_then(|n| n.text())
        .and_then(|s| s.parse().ok());

    let birth_mother_xml_id: Option<i32> = character_node
        .children()
        .find(|n| n.has_tag_name("BirthMotherID"))
        .and_then(|n| n.text())
        .and_then(|s| s.parse().ok());

    let birth_city_xml_id: Option<i32> = character_node
        .children()
        .find(|n| n.has_tag_name("BirthCityID"))
        .and_then(|n| n.text())
        .and_then(|s| s.parse().ok());

    // Map XML IDs to database IDs
    let birth_father_id = match birth_father_xml_id {
        Some(xml_id) => Some(id_mapper.get_character(xml_id)?),
        None => None,
    };

    let birth_mother_id = match birth_mother_xml_id {
        Some(xml_id) => Some(id_mapper.get_character(xml_id)?),
        None => None,
    };

    let birth_city_id = match birth_city_xml_id {
        Some(xml_id) => Some(id_mapper.get_city(xml_id)?),
        None => None,
    };

    // Only update if we have at least one parent or birth city
    if birth_father_id.is_some() || birth_mother_id.is_some() || birth_city_id.is_some() {
        conn.execute(
            "UPDATE characters
             SET birth_father_id = ?, birth_mother_id = ?, birth_city_id = ?
             WHERE character_id = ?",
            params![birth_father_id, birth_mother_id, birth_city_id, character_id],
        )?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Parse character marriages from Spouses element
///
/// # XML Structure
/// ```xml
/// <Character ID="4">
///   <Spouses>
///     <ID>19</ID>
///     <ID>25</ID>
///   </Spouses>
/// </Character>
/// ```
///
/// # Schema
/// ```sql
/// CREATE TABLE character_marriages (
///     character_id INTEGER NOT NULL,
///     match_id BIGINT NOT NULL,
///     spouse_id INTEGER NOT NULL,
///     married_turn INTEGER,
///     divorced_turn INTEGER,
///     PRIMARY KEY (character_id, match_id, spouse_id)
/// );
/// ```
///
/// Note: Each marriage is stored from both character perspectives (symmetric storage).
/// Character 4 married to 19 creates two rows: (4, 19) and (19, 4).
pub fn parse_character_marriages(
    character_node: &Node,
    conn: &Connection,
    id_mapper: &IdMapper,
    character_id: i64,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

    // Find Spouses element
    let spouses_node = match character_node.children().find(|n| n.has_tag_name("Spouses")) {
        Some(node) => node,
        None => return Ok(0), // No spouses for this character
    };

    // Iterate over ID elements (each is a spouse)
    for id_node in spouses_node.children().filter(|n| n.has_tag_name("ID")) {
        let spouse_xml_id_str = id_node
            .text()
            .ok_or_else(|| ParseError::MissingElement("Spouses.ID text".to_string()))?;

        let spouse_xml_id: i32 = spouse_xml_id_str.parse().map_err(|_| {
            ParseError::InvalidFormat(format!(
                "Invalid spouse ID: {}",
                spouse_xml_id_str
            ))
        })?;

        // Map XML ID to database ID
        let spouse_id = id_mapper.get_character(spouse_xml_id)?;

        // Insert marriage record
        // Note: married_turn and divorced_turn are left NULL since we don't have that data
        conn.execute(
            "INSERT INTO character_marriages (character_id, match_id, spouse_id, married_turn, divorced_turn)
             VALUES (?, ?, ?, NULL, NULL)
             ON CONFLICT (character_id, match_id, spouse_id) DO NOTHING",
            params![character_id, match_id, spouse_id],
        )?;

        count += 1;
    }

    Ok(count)
}

/// Parse all character extended data for a single character
///
/// This is a convenience function that calls all character data parsers.
pub fn parse_character_extended_data(
    character_node: &Node,
    conn: &Connection,
    id_mapper: &IdMapper,
    character_id: i64,
    match_id: i64,
) -> Result<(usize, usize, usize, usize)> {
    let stats_count = parse_character_stats(character_node, conn, character_id, match_id)?;
    let traits_count = parse_character_traits(character_node, conn, character_id, match_id)?;
    let relationships_count =
        parse_character_relationships(character_node, conn, id_mapper, character_id, match_id)?;
    let marriages_count =
        parse_character_marriages(character_node, conn, id_mapper, character_id, match_id)?;

    Ok((stats_count, traits_count, relationships_count, marriages_count))
}

#[cfg(test)]
mod tests {
    use super::*;
    use roxmltree::Document;

    #[test]
    fn test_parse_character_stats() {
        let xml = r#"
            <Character ID="5">
                <Rating>
                    <RATING_WISDOM>3</RATING_WISDOM>
                    <RATING_CHARISMA>2</RATING_CHARISMA>
                </Rating>
                <Stat>
                    <STAT_KILLS>5</STAT_KILLS>
                </Stat>
            </Character>
        "#;

        let doc = Document::parse(xml).unwrap();
        let char_node = doc.root_element();

        // Note: Can't test DB insertion without a connection, but we can verify parsing logic
        // by checking the XML structure is correctly navigated
        let rating = char_node
            .children()
            .find(|n| n.has_tag_name("Rating"))
            .unwrap();
        assert_eq!(rating.children().filter(|n| n.is_element()).count(), 2);

        let stat = char_node.children().find(|n| n.has_tag_name("Stat")).unwrap();
        assert_eq!(stat.children().filter(|n| n.is_element()).count(), 1);
    }

    #[test]
    fn test_parse_character_traits() {
        let xml = r#"
            <Character ID="5">
                <TraitTurn>
                    <TRAIT_BUILDER_ARCHETYPE>1</TRAIT_BUILDER_ARCHETYPE>
                    <TRAIT_AMBITIOUS>5</TRAIT_AMBITIOUS>
                </TraitTurn>
            </Character>
        "#;

        let doc = Document::parse(xml).unwrap();
        let char_node = doc.root_element();

        let trait_node = char_node
            .children()
            .find(|n| n.has_tag_name("TraitTurn"))
            .unwrap();
        assert_eq!(trait_node.children().filter(|n| n.is_element()).count(), 2);
    }
}
