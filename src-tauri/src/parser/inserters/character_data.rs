// Character extended data inserter (hybrid architecture)
//
// Inserts character-specific nested data into DB tables:
// - CharacterStat -> character_stats table
// - CharacterTrait -> character_traits table
// - CharacterRelationship -> character_relationships table
// - CharacterMarriage -> character_marriages table

use crate::parser::game_data::{
    CharacterMarriage, CharacterRelationship, CharacterStat, CharacterTrait,
};
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::{deduplicate_rows_first_wins, deduplicate_rows_last_wins};
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert character stats using Appender
///
/// Maps XML IDs to database IDs and bulk inserts with deduplication.
pub fn insert_character_stats(
    conn: &Connection,
    stats: &[CharacterStat],
    id_mapper: &IdMapper,
) -> Result<()> {
    // Collect rows (XML ID -> DB ID mapping)
    let mut rows = Vec::new();
    for stat in stats {
        let character_id = id_mapper.get_character(stat.character_xml_id)?;

        rows.push((
            character_id,
            id_mapper.match_id,
            stat.stat_name.clone(),
            stat.stat_value,
        ));
    }

    // Deduplicate (last-wins matches DO UPDATE behavior)
    // Primary key: (character_id, match_id, stat_name)
    let unique_rows = deduplicate_rows_last_wins(rows, |(char_id, match_id, stat_name, _)| {
        (*char_id, *match_id, stat_name.clone())
    });

    // Bulk insert
    let mut app = conn.appender("character_stats")?;
    for (character_id, match_id, stat_name, stat_value) in unique_rows {
        app.append_row(params![character_id, match_id, stat_name, stat_value])?;
    }

    drop(app);
    Ok(())
}

/// Insert character traits using Appender
///
/// Maps XML IDs to database IDs and bulk inserts with deduplication.
pub fn insert_character_traits(
    conn: &Connection,
    traits: &[CharacterTrait],
    id_mapper: &IdMapper,
) -> Result<()> {
    // Collect rows (XML ID -> DB ID mapping)
    let mut rows = Vec::new();
    for trait_data in traits {
        let character_id = id_mapper.get_character(trait_data.character_xml_id)?;

        rows.push((
            character_id,
            id_mapper.match_id,
            trait_data.trait_name.clone(),
            trait_data.acquired_turn,
            trait_data.removed_turn,
        ));
    }

    // Deduplicate (last-wins matches DO UPDATE behavior)
    // Primary key: (character_id, match_id, trait, acquired_turn)
    let unique_rows = deduplicate_rows_last_wins(
        rows,
        |(char_id, match_id, trait_name, acquired, _)| {
            (*char_id, *match_id, trait_name.clone(), *acquired)
        },
    );

    // Bulk insert
    let mut app = conn.appender("character_traits")?;
    for (character_id, match_id, trait_name, acquired_turn, removed_turn) in unique_rows {
        app.append_row(params![
            character_id,
            match_id,
            trait_name,
            acquired_turn,
            removed_turn
        ])?;
    }

    drop(app);
    Ok(())
}

/// Insert character relationships using Appender
///
/// Maps XML IDs to database IDs and bulk inserts with deduplication.
pub fn insert_character_relationships(
    conn: &Connection,
    relationships: &[CharacterRelationship],
    id_mapper: &IdMapper,
) -> Result<()> {
    // Collect rows (XML ID -> DB ID mapping)
    let mut rows = Vec::new();
    for rel in relationships {
        let character_id = id_mapper.get_character(rel.character_xml_id)?;
        let related_character_id = id_mapper.get_character(rel.related_character_xml_id)?;

        rows.push((
            character_id,
            id_mapper.match_id,
            related_character_id,
            rel.relationship_type.clone(),
            rel.relationship_value,
            rel.started_turn,
            rel.ended_turn,
        ));
    }

    // Deduplicate (last-wins matches DO UPDATE behavior)
    // Primary key: (character_id, match_id, related_character_id, relationship_type)
    let unique_rows = deduplicate_rows_last_wins(
        rows,
        |(char_id, match_id, related_id, rel_type, _, _, _)| {
            (*char_id, *match_id, *related_id, rel_type.clone())
        },
    );

    // Bulk insert
    let mut app = conn.appender("character_relationships")?;
    for (
        character_id,
        match_id,
        related_character_id,
        relationship_type,
        relationship_value,
        started_turn,
        ended_turn,
    ) in unique_rows
    {
        app.append_row(params![
            character_id,
            match_id,
            related_character_id,
            relationship_type,
            relationship_value,
            started_turn,
            ended_turn
        ])?;
    }

    drop(app);
    Ok(())
}

/// Insert character marriages using Appender
///
/// Maps XML IDs to database IDs and bulk inserts with deduplication.
/// Note: Each marriage is stored from both character perspectives (symmetric storage).
pub fn insert_character_marriages(
    conn: &Connection,
    marriages: &[CharacterMarriage],
    id_mapper: &IdMapper,
) -> Result<()> {
    // Collect rows (XML ID -> DB ID mapping)
    let mut rows = Vec::new();
    for marriage in marriages {
        let character_id = id_mapper.get_character(marriage.character_xml_id)?;
        let spouse_id = id_mapper.get_character(marriage.spouse_xml_id)?;

        rows.push((
            character_id,
            id_mapper.match_id,
            spouse_id,
            marriage.married_turn,
            marriage.divorced_turn,
        ));
    }

    // Deduplicate (first-wins matches DO NOTHING behavior)
    // Primary key: (character_id, match_id, spouse_id)
    let unique_rows = deduplicate_rows_first_wins(
        rows,
        |(char_id, match_id, spouse_id, _, _)| (*char_id, *match_id, *spouse_id),
    );

    // Bulk insert
    let mut app = conn.appender("character_marriages")?;
    for (character_id, match_id, spouse_id, married_turn, divorced_turn) in unique_rows {
        app.append_row(params![
            character_id,
            match_id,
            spouse_id,
            married_turn,
            divorced_turn
        ])?;
    }

    drop(app);
    Ok(())
}
