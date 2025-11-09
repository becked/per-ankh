// Insert parsed player data into database

use crate::parser::game_data::PlayerData;
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert players from parsed structs into database
///
/// Takes pre-parsed PlayerData structs and inserts them using DuckDB's Appender.
/// Preserves existing behavior:
/// - Uses IdMapper to convert XML IDs → DB IDs
/// - Deduplicates with last-wins strategy
/// - Bulk insertion via Appender
pub fn insert_players(
    conn: &Connection,
    players: &[PlayerData],
    id_mapper: &mut IdMapper,
) -> Result<usize> {
    let mut rows = Vec::new();

    // Convert parsed data to DB rows
    for player in players {
        let db_id = id_mapper.map_player(player.xml_id);

        // Look up FK references (may fail if referenced entity doesn't exist yet)
        let founder_character_db_id = match player.founder_character_xml_id {
            Some(id) => id_mapper.get_character(id).ok(),
            None => None,
        };
        let chosen_heir_db_id = match player.chosen_heir_xml_id {
            Some(id) => id_mapper.get_character(id).ok(),
            None => None,
        };
        let original_capital_city_db_id = match player.original_capital_city_xml_id {
            Some(id) => id_mapper.get_city(id).ok(),
            None => None,
        };

        // Collect row data - must match schema column order exactly
        rows.push((
            db_id,                                          // player_id
            id_mapper.match_id,                             // match_id
            player.xml_id,                                  // xml_id
            player.player_name.clone(),                     // player_name
            player.player_name.to_lowercase(),              // player_name_normalized
            player.nation.clone(),                          // nation
            player.dynasty.clone(),                         // dynasty
            player.team_id.clone(),                         // team_id
            player.is_human,                                // is_human
            player.online_id.clone(),                       // online_id
            player.email.clone(),                           // email
            player.difficulty.clone(),                      // difficulty
            player.last_turn_completed,                     // last_turn_completed
            player.turn_ended,                              // turn_ended
            player.legitimacy,                              // legitimacy
            player.time_stockpile,                          // time_stockpile
            player.state_religion.clone(),                  // state_religion
            player.succession_gender.clone(),               // succession_gender
            founder_character_db_id,                        // founder_character_id
            chosen_heir_db_id,                              // chosen_heir_id
            original_capital_city_db_id,                    // original_capital_city_id
            player.tech_researching.clone(),                // tech_researching
            player.ambition_delay,                          // ambition_delay
            player.tiles_purchased,                         // tiles_purchased
            player.state_religion_changes,                  // state_religion_changes
            player.tribe_mercenaries_hired,                 // tribe_mercenaries_hired
        ));
    }

    // Deduplicate (last-wins strategy)
    // Primary key: (player_id, match_id)
    let unique_rows = deduplicate_rows_last_wins(rows, |(player_id, match_id, ..)| {
        (*player_id, *match_id)
    });

    let count = unique_rows.len();

    // Bulk insert deduplicated rows
    let mut app = conn.appender("players")?;
    for (
        db_id,
        match_id,
        xml_id,
        player_name,
        player_name_normalized,
        nation,
        dynasty,
        team_id,
        is_human,
        online_id,
        email,
        difficulty,
        last_turn_completed,
        turn_ended,
        legitimacy,
        time_stockpile,
        state_religion,
        succession_gender,
        founder_character_db_id,
        chosen_heir_db_id,
        original_capital_city_db_id,
        tech_researching,
        ambition_delay,
        tiles_purchased,
        state_religion_changes,
        tribe_mercenaries_hired,
    ) in unique_rows
    {
        app.append_row(params![
            db_id,
            match_id,
            xml_id,
            player_name,
            player_name_normalized,
            nation,
            dynasty,
            team_id,
            is_human,
            online_id,
            email,
            difficulty,
            last_turn_completed,
            turn_ended,
            legitimacy,
            time_stockpile,
            state_religion,
            succession_gender,
            founder_character_db_id,
            chosen_heir_db_id,
            original_capital_city_db_id,
            tech_researching,
            ambition_delay,
            tiles_purchased,
            state_religion_changes,
            tribe_mercenaries_hired
        ])?;
    }

    // Flush appender to commit all rows
    drop(app);

    log::debug!("Inserted {} players", count);
    Ok(count)
}
