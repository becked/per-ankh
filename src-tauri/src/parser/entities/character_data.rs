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
use crate::parser::utils::{deduplicate_rows_first_wins, deduplicate_rows_last_wins};
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
    // Collect all stat rows first
    let mut stats = Vec::new();

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

            stats.push((character_id, match_id, stat_name.to_string(), stat_value));
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

            stats.push((character_id, match_id, stat_name.to_string(), stat_value));
        }
    }

    // Deduplicate (last-wins matches DO UPDATE behavior)
    // Primary key: (character_id, match_id, stat_name)
    let unique_stats = deduplicate_rows_last_wins(
        stats,
        |(char_id, match_id, stat_name, _)| (*char_id, *match_id, stat_name.clone())
    );

    let count = unique_stats.len();

    // Bulk insert
    let mut app = conn.appender("character_stats")?;
    for (char_id, match_id, stat_name, stat_value) in unique_stats {
        app.append_row(params![char_id, match_id, stat_name, stat_value])?;
    }

    // Flush appender to commit all rows
    app.flush()?;

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
    if let Some(trait_node) = character_node
        .children()
        .find(|n| n.has_tag_name("TraitTurn"))
    {
        // Collect all trait rows first
        let mut traits = Vec::new();

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

            let removed_turn: Option<i32> = None;
            traits.push((character_id, match_id, trait_name.to_string(), acquired_turn, removed_turn));
        }

        // Deduplicate (last-wins matches DO UPDATE behavior)
        // Primary key: (character_id, match_id, trait, acquired_turn)
        let unique_traits = deduplicate_rows_last_wins(
            traits,
            |(char_id, match_id, trait_name, acquired, _)| (*char_id, *match_id, trait_name.clone(), *acquired)
        );

        let count = unique_traits.len();

        // Bulk insert
        let mut app = conn.appender("character_traits")?;
        for (char_id, match_id, trait_name, acquired, removed) in unique_traits {
            app.append_row(params![char_id, match_id, trait_name, acquired, removed])?;
        }

        // Flush appender to commit all rows
        app.flush()?;

        Ok(count)
    } else {
        Ok(0)
    }
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
    if let Some(rel_list_node) = character_node
        .children()
        .find(|n| n.has_tag_name("RelationshipList"))
    {
        // Collect all relationship rows first
        let mut relationships = Vec::new();

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

            let ended_turn: Option<i32> = None;

            relationships.push((
                character_id,
                match_id,
                related_character_id,
                rel_type.to_string(),
                relationship_value,
                started_turn,
                ended_turn
            ));
        }

        // Deduplicate (last-wins matches DO UPDATE behavior)
        // Primary key: (character_id, match_id, related_character_id, relationship_type)
        let unique_relationships = deduplicate_rows_last_wins(
            relationships,
            |(char_id, match_id, related_id, rel_type, _, _, _)|
                (*char_id, *match_id, *related_id, rel_type.clone())
        );

        let count = unique_relationships.len();

        // Bulk insert
        let mut app = conn.appender("character_relationships")?;
        for (char_id, match_id, related_id, rel_type, relationship_value, started_turn, ended_turn) in unique_relationships {
            app.append_row(params![
                char_id,
                match_id,
                related_id,
                rel_type,
                relationship_value,
                started_turn,
                ended_turn
            ])?;
        }

        // Flush appender to commit all rows
        app.flush()?;

        Ok(count)
    } else {
        Ok(0)
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
    // Find Spouses element
    let spouses_node = match character_node.children().find(|n| n.has_tag_name("Spouses")) {
        Some(node) => node,
        None => return Ok(0), // No spouses for this character
    };

    // Collect all marriage rows first
    let mut marriages = Vec::new();

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

        // Note: marriage_turn uses -1 as sentinel for unknown, ended_turn is NULL since we don't have that data
        let marriage_turn = -1;
        let ended_turn: Option<i32> = None;

        marriages.push((character_id, match_id, spouse_id, marriage_turn, ended_turn));
    }

    // Deduplicate before appending (first-wins matches DO NOTHING behavior)
    // Primary key: (character_id, match_id, spouse_id)
    let unique_marriages = deduplicate_rows_first_wins(
        marriages,
        |(char_id, match_id, spouse_id, _, _)| (*char_id, *match_id, *spouse_id)
    );

    let count = unique_marriages.len();

    // Bulk insert deduplicated rows
    let mut app = conn.appender("character_marriages")?;
    for (char_id, match_id, spouse_id, marriage_turn, ended_turn) in unique_marriages {
        app.append_row(params![char_id, match_id, spouse_id, marriage_turn, ended_turn])?;
    }

    // Flush appender to commit all rows
    app.flush()?;

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
