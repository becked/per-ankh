// Family entity inserter - DB insertion logic

use crate::parser::game_data::FamilyData;
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// Insert families using Appender (preserves existing deduplication)
pub fn insert_families(
    conn: &Connection,
    families: &[FamilyData],
    id_mapper: &mut IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for family in families {
        // Generate stable xml_id from family name (same as old code)
        let xml_id = generate_family_xml_id(&family.family_name);
        let db_id = id_mapper.map_family(xml_id);

        // Map player ID
        let player_db_id = id_mapper.get_player(family.player_xml_id)?;

        // Map character and city IDs
        let head_character_db_id = match family.head_character_xml_id {
            Some(id) => Some(id_mapper.get_character(id)?),
            None => None,
        };

        let seat_city_db_id = match family.seat_city_xml_id {
            Some(id) => Some(id_mapper.get_city(id)?),
            None => None,
        };

        // Column order: family_id, match_id, xml_id, player_id, family_name,
        //               family_class, head_character_id, seat_city_id, turns_without_leader
        rows.push((
            db_id,
            id_mapper.match_id,
            xml_id,
            player_db_id,
            family.family_name.clone(),
            family.family_class.clone(),
            head_character_db_id,
            seat_city_db_id,
            family.turns_without_leader,
        ));
    }

    // Deduplicate (last-wins strategy)
    let unique_rows = deduplicate_rows_last_wins(rows, |(family_id, match_id, ..)| {
        (*family_id, *match_id)
    });

    // Bulk insert
    let mut app = conn.appender("families")?;
    for (
        db_id,
        match_id,
        xml_id,
        player_db_id,
        family_name,
        family_class,
        head_character_db_id,
        seat_city_db_id,
        turns_without_leader,
    ) in unique_rows
    {
        app.append_row(params![
            db_id,
            match_id,
            xml_id,
            player_db_id,
            family_name,
            family_class,
            head_character_db_id,
            seat_city_db_id,
            turns_without_leader
        ])?;
    }

    app.flush()?;
    Ok(())
}

/// Generate a stable xml_id for a family based on its name
/// Uses a simple hash to convert the family name to an i32
fn generate_family_xml_id(family_name: &str) -> i32 {
    let mut hasher = DefaultHasher::new();
    family_name.hash(&mut hasher);
    let hash = hasher.finish();

    // Take lower 31 bits to ensure positive i32
    (hash & 0x7FFF_FFFF) as i32
}
