// Insert parsed character data into database

use crate::parser::game_data::CharacterData;
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert characters from parsed structs into database
///
/// Takes pre-parsed CharacterData structs and inserts them using DuckDB's Appender.
/// Uses two-phase ID mapping to handle parent relationships:
/// - Phase 1: Assign DB IDs to ALL characters first
/// - Phase 2: Build rows with parent lookups (now guaranteed to find all IDs)
///
/// Features:
/// - Uses IdMapper to convert XML IDs → DB IDs
/// - Deduplicates with last-wins strategy
/// - Bulk insertion via Appender
/// - Parent relationships set in single pass (no separate UPDATE needed)
/// - Birth city left NULL (updated after cities are inserted)
pub fn insert_characters(
    conn: &Connection,
    characters: &[CharacterData],
    id_mapper: &mut IdMapper,
) -> Result<usize> {
    // Phase 1: Assign DB IDs to ALL characters first
    // This ensures parent lookups will succeed even for forward references
    for character in characters {
        id_mapper.map_character(character.xml_id);
    }

    // Phase 2: Build rows with parent lookups (now guaranteed to find all IDs)
    let mut rows = Vec::new();
    for character in characters {
        let db_id = id_mapper.get_character(character.xml_id)?;

        // Look up player FK (may be None for tribal characters)
        let player_db_id = match character.player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        // Parent lookups now work because all characters have DB IDs
        // Gracefully handle missing parents (e.g., parents not in save file)
        let birth_father_db_id = character
            .birth_father_xml_id
            .and_then(|id| id_mapper.get_character(id).ok());

        let birth_mother_db_id = character
            .birth_mother_xml_id
            .and_then(|id| id_mapper.get_character(id).ok());

        // Birth city still NULL here - updated after cities inserted
        let birth_city_db_id: Option<i64> = None;

        // Collect row data - must match schema column order exactly
        rows.push((
            db_id,                                  // character_id
            id_mapper.match_id,                     // match_id
            character.xml_id,                       // xml_id
            character.first_name.clone(),           // first_name
            character.gender.clone(),               // gender
            player_db_id,                           // player_id
            character.tribe.clone(),                // tribe
            character.birth_turn,                   // birth_turn
            birth_city_db_id,                       // birth_city_id - updated after cities
            character.death_turn,                   // death_turn
            character.death_reason.clone(),         // death_reason
            birth_father_db_id,                     // birth_father_id
            birth_mother_db_id,                     // birth_mother_id
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

    log::debug!("Inserted {} characters", count);
    Ok(count)
}

/// Update character birth cities after cities have been inserted
///
/// This is called after cities are inserted because birth_city_id references
/// the cities table. Uses already-parsed birth_city_xml_id from CharacterData.
pub fn update_character_birth_cities(
    conn: &Connection,
    characters: &[CharacterData],
    id_mapper: &IdMapper,
) -> Result<usize> {
    let mut updated_count = 0;

    for character in characters {
        if let Some(city_xml_id) = character.birth_city_xml_id {
            // Gracefully handle missing cities (city may not be in save file)
            if let Ok(city_db_id) = id_mapper.get_city(city_xml_id) {
                let char_db_id = id_mapper.get_character(character.xml_id)?;
                conn.execute(
                    "UPDATE characters SET birth_city_id = ? WHERE character_id = ? AND match_id = ?",
                    params![city_db_id, char_db_id, id_mapper.match_id],
                )?;
                updated_count += 1;
            }
        }
    }

    log::debug!("Updated {} characters with birth city", updated_count);
    Ok(updated_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::create_schema;
    use crate::parser::id_mapper::IdMapper;
    use duckdb::Connection;
    use tempfile::tempdir;

    fn setup_test_db() -> (Connection, tempfile::TempDir) {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();
        // Insert a test match
        conn.execute(
            "INSERT INTO matches (match_id, file_name, file_hash, game_id, total_turns)
             VALUES (1, 'test.zip', 'hash', 'game1', 100)",
            [],
        )
        .unwrap();
        (conn, dir)
    }

    fn make_test_character(xml_id: i32) -> CharacterData {
        CharacterData {
            xml_id,
            first_name: Some(format!("Character{}", xml_id)),
            gender: Some("GENDER_MALE".to_string()),
            player_xml_id: None,
            tribe: None,
            family: None,
            nation: None,
            religion: None,
            birth_turn: 0,
            death_turn: None,
            death_reason: None,
            birth_father_xml_id: None,
            birth_mother_xml_id: None,
            birth_city_xml_id: None,
            cognomen: None,
            archetype: None,
            portrait: None,
            xp: 0,
            level: 1,
            is_royal: false,
            is_infertile: false,
            became_leader_turn: None,
            abdicated_turn: None,
            was_religion_head: false,
            was_family_head: false,
            nation_joined_turn: None,
            seed: None,
        }
    }

    #[test]
    fn test_insert_characters_with_parent_ids() {
        let (conn, _dir) = setup_test_db();
        let mut id_mapper = IdMapper::new(1, &conn, true).unwrap();

        // Create parent character
        let mut parent = make_test_character(1);
        parent.first_name = Some("Parent".to_string());

        // Create child with parent reference
        let mut child = make_test_character(2);
        child.first_name = Some("Child".to_string());
        child.birth_turn = 10;
        child.birth_father_xml_id = Some(1); // References parent

        let characters = vec![parent, child];
        let count = insert_characters(&conn, &characters, &mut id_mapper).unwrap();
        assert_eq!(count, 2);

        // Verify parent relationship was set
        let child_father: Option<i64> = conn
            .query_row(
                "SELECT birth_father_id FROM characters WHERE xml_id = 2 AND match_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();

        let parent_db_id = id_mapper.get_character(1).unwrap();
        assert_eq!(child_father, Some(parent_db_id));
    }

    #[test]
    fn test_insert_characters_missing_parent_graceful() {
        let (conn, _dir) = setup_test_db();
        let mut id_mapper = IdMapper::new(1, &conn, true).unwrap();

        // Create child with non-existent parent reference
        let mut child = make_test_character(2);
        child.first_name = Some("Orphan".to_string());
        child.birth_turn = 10;
        child.birth_father_xml_id = Some(999); // Non-existent parent

        let characters = vec![child];
        let count = insert_characters(&conn, &characters, &mut id_mapper).unwrap();
        assert_eq!(count, 1);

        // Parent should be NULL (graceful handling)
        let child_father: Option<i64> = conn
            .query_row(
                "SELECT birth_father_id FROM characters WHERE xml_id = 2 AND match_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(child_father, None);
    }

    #[test]
    fn test_insert_characters_forward_reference() {
        // Test that a child can reference a parent that appears later in the list
        let (conn, _dir) = setup_test_db();
        let mut id_mapper = IdMapper::new(1, &conn, true).unwrap();

        // Child appears first but references parent that appears second
        let mut child = make_test_character(2);
        child.first_name = Some("Child".to_string());
        child.birth_father_xml_id = Some(1); // References parent (not yet seen)

        let mut parent = make_test_character(1);
        parent.first_name = Some("Parent".to_string());

        // Child first, parent second (forward reference)
        let characters = vec![child, parent];
        let count = insert_characters(&conn, &characters, &mut id_mapper).unwrap();
        assert_eq!(count, 2);

        // Verify parent relationship was correctly set despite forward reference
        let child_father: Option<i64> = conn
            .query_row(
                "SELECT birth_father_id FROM characters WHERE xml_id = 2 AND match_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();

        let parent_db_id = id_mapper.get_character(1).unwrap();
        assert_eq!(child_father, Some(parent_db_id));
    }
}
