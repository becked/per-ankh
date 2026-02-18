// Cities inserter - bulk insertion to database

use crate::parser::game_data::CityData;
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert cities using Appender (preserves existing deduplication)
pub fn insert_cities(
    conn: &Connection,
    cities: &[CityData],
    id_mapper: &mut IdMapper,
) -> Result<()> {
    // Collect rows for bulk insertion
    let mut rows = Vec::new();
    for city in cities {
        let db_id = id_mapper.map_city(city.xml_id);

        // Map player XML ID to DB ID
        let player_db_id = match city.player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        // Map tile XML ID to DB ID
        let tile_db_id = id_mapper.get_tile(city.tile_xml_id)?;

        // Map character XML IDs to DB IDs
        let governor_db_id = match city.governor_xml_id {
            Some(id) => Some(id_mapper.get_character(id)?),
            None => None,
        };

        // Map first owner player XML ID to DB ID
        let first_owner_player_db_id = match city.first_owner_player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        // Map last owner player XML ID to DB ID
        let last_owner_player_db_id = match city.last_owner_player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        // Collect row data - must match schema column order exactly
        rows.push((
            db_id,                          // city_id
            id_mapper.match_id,             // match_id
            city.xml_id,                    // xml_id
            player_db_id,                   // player_id
            tile_db_id,                     // tile_id
            city.city_name.clone(),         // city_name
            city.family.clone(),            // family
            city.founded_turn,              // founded_turn
            city.is_capital,                // is_capital
            city.citizens,                  // citizens
            governor_db_id,                 // governor_id
            city.governor_turn,             // governor_turn
            city.hurry_civics_count,        // hurry_civics_count
            city.hurry_money_count,         // hurry_money_count
            city.hurry_training_count,      // hurry_training_count
            city.hurry_population_count,    // hurry_population_count
            city.specialist_count,          // specialist_count
            city.growth_count,              // growth_count
            city.unit_production_count,     // unit_production_count
            city.buy_tile_count,            // buy_tile_count
            first_owner_player_db_id,       // first_owner_player_id
            last_owner_player_db_id,        // last_owner_player_id
        ));
    }

    // Deduplicate (last-wins strategy)
    // Primary key: (city_id, match_id)
    let unique_cities = deduplicate_rows_last_wins(
        rows,
        |(city_id, match_id, ..)| (*city_id, *match_id)
    );

    // Bulk insert deduplicated rows
    let mut app = conn.appender("cities")?;
    for (db_id, match_id, xml_id, player_db_id, tile_db_id, city_name, family, founded_turn,
         is_capital, citizens, governor_db_id, governor_turn,
         hurry_civics_count, hurry_money_count, hurry_training_count, hurry_population_count,
         specialist_count, growth_count, unit_production_count, buy_tile_count,
         first_owner_player_db_id, last_owner_player_db_id) in unique_cities
    {
        app.append_row(params![
            db_id, match_id, xml_id, player_db_id, tile_db_id, city_name, family, founded_turn,
            is_capital, citizens, governor_db_id, governor_turn,
            hurry_civics_count, hurry_money_count, hurry_training_count, hurry_population_count,
            specialist_count, growth_count, unit_production_count, buy_tile_count,
            first_owner_player_db_id, last_owner_player_db_id
        ])?;
    }

    // Flush appender to commit all rows
    app.flush()?;

    log::info!("Inserted {} cities", cities.len());
    Ok(())
}
