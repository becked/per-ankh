// Insert parsed character data into database

use crate::parser::game_data::CharacterData;
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert characters from parsed structs into database (Pass 1: Core data only)
///
/// Takes pre-parsed CharacterData structs and inserts them using DuckDB's Appender.
/// Preserves existing behavior:
/// - Uses IdMapper to convert XML IDs → DB IDs
/// - Deduplicates with last-wins strategy
/// - Bulk insertion via Appender
/// - Inserts WITHOUT parent relationships (those are updated in Pass 2a)
pub fn insert_characters_core(
    conn: &Connection,
    characters: &[CharacterData],
    id_mapper: &mut IdMapper,
) -> Result<usize> {
    let mut rows = Vec::new();

    // Convert parsed data to DB rows
    for character in characters {
        let db_id = id_mapper.map_character(character.xml_id);

        // Look up player FK (may be None for tribal characters)
        let player_db_id = match character.player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        // Collect row data - must match schema column order exactly
        // NOTE: Parent IDs (birth_father_id, birth_mother_id) are NULL in Pass 1
        rows.push((
            db_id,                                  // character_id
            id_mapper.match_id,                     // match_id
            character.xml_id,                       // xml_id
            character.first_name.clone(),           // first_name
            character.gender.clone(),               // gender
            player_db_id,                           // player_id
            character.tribe.clone(),                // tribe
            character.birth_turn,                   // birth_turn
            None::<i32>,                            // birth_city_id - not set yet
            character.death_turn,                   // death_turn
            character.death_reason.clone(),         // death_reason
            None::<i64>,                            // birth_father_id - NULL in Pass 1
            None::<i64>,                            // birth_mother_id - NULL in Pass 1
            character.family.clone(),               // family
            character.nation.clone(),               // nation
            character.religion.clone(),             // religion
            character.cognomen.clone(),             // cognomen
            character.archetype.clone(),            // archetype
            character.portrait.clone(),             // portrait
            character.xp,                           // xp
            character.level,                        // level
            character.is_royal,                     // is_royal
            character.is_infertile,                 // is_infertile
            character.became_leader_turn,           // became_leader_turn
            character.abdicated_turn,               // abdicated_turn
            character.was_religion_head,            // was_religion_head
            character.was_family_head,              // was_family_head
            character.nation_joined_turn,           // nation_joined_turn
            character.seed,                         // seed
        ));
    }

    // Deduplicate (last-wins strategy)
    // Primary key: (character_id, match_id)
    let unique_rows = deduplicate_rows_last_wins(rows, |(char_id, match_id, ..)| {
        (*char_id, *match_id)
    });

    let count = unique_rows.len();

    // Bulk insert deduplicated rows
    let mut app = conn.appender("characters")?;
    for (
        db_id,
        match_id,
        xml_id,
        first_name,
        gender,
        player_db_id,
        tribe,
        birth_turn,
        birth_city_id,
        death_turn,
        death_reason,
        birth_father_id,
        birth_mother_id,
        family,
        nation,
        religion,
        cognomen,
        archetype,
        portrait,
        xp,
        level,
        is_royal,
        is_infertile,
        became_leader_turn,
        abdicated_turn,
        was_religion_head,
        was_family_head,
        nation_joined_turn,
        seed,
    ) in unique_rows
    {
        app.append_row(params![
            db_id,
            match_id,
            xml_id,
            first_name,
            gender,
            player_db_id,
            tribe,
            birth_turn,
            birth_city_id,
            death_turn,
            death_reason,
            birth_father_id,
            birth_mother_id,
            family,
            nation,
            religion,
            cognomen,
            archetype,
            portrait,
            xp,
            level,
            is_royal,
            is_infertile,
            became_leader_turn,
            abdicated_turn,
            was_religion_head,
            was_family_head,
            nation_joined_turn,
            seed
        ])?;
    }

    // Flush appender to commit all rows
    drop(app);

    log::debug!("Inserted {} characters (Pass 1: core data)", count);
    Ok(count)
}
