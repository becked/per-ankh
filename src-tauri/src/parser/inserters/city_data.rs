// City extended data inserter (hybrid architecture)
//
// Inserts city-specific nested data into DB tables:
// - CityProductionItem -> city_production_queue table
// - CityProjectCompleted -> city_projects_completed table
// - CityYield -> city_yields table
// - CityReligion -> city_religions table
// - CityCulture -> city_culture table

use crate::parser::game_data::{
    CityCulture, CityProductionItem, CityProjectCompleted, CityReligion, CityYield,
};
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert city production queue items using Appender
pub fn insert_city_production_queue(
    conn: &Connection,
    items: &[CityProductionItem],
    id_mapper: &IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for item in items {
        let city_id = id_mapper.get_city(item.city_xml_id)?;

        // Generate unique queue_id (match_id + city_id + position)
        let queue_id =
            (id_mapper.match_id * 1_000_000) + (city_id * 1000) + item.queue_position as i64;

        rows.push((
            queue_id,
            city_id,
            id_mapper.match_id,
            item.queue_position,
            item.build_type.clone(),
            item.item_type.clone(),
            item.progress,
            item.is_repeat,
        ));
    }

    // Deduplicate by queue_id (last-wins)
    let unique_rows = deduplicate_rows_last_wins(rows, |(queue_id, ..)| *queue_id);

    let mut app = conn.appender("city_production_queue")?;
    for (queue_id, city_id, match_id, queue_position, build_type, item_type, progress, is_repeat) in
        unique_rows
    {
        app.append_row(params![
            queue_id,
            city_id,
            match_id,
            queue_position,
            build_type,
            item_type,
            progress,
            is_repeat,
            None::<String>, // yield_costs (JSON, not currently parsed from XML)
        ])?;
    }

    drop(app);
    Ok(())
}

/// Insert city completed projects using Appender
pub fn insert_city_projects_completed(
    conn: &Connection,
    projects: &[CityProjectCompleted],
    id_mapper: &IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for project in projects {
        let city_id = id_mapper.get_city(project.city_xml_id)?;

        rows.push((
            city_id,
            id_mapper.match_id,
            project.project_type.clone(),
            project.count,
        ));
    }

    // Deduplicate by (city_id, match_id, project_type) - last-wins
    let unique_rows =
        deduplicate_rows_last_wins(rows, |(city_id, match_id, project_type, _)| {
            (*city_id, *match_id, project_type.clone())
        });

    let mut app = conn.appender("city_projects_completed")?;
    for (city_id, match_id, project_type, count) in unique_rows {
        app.append_row(params![city_id, match_id, project_type, count])?;
    }

    drop(app);
    Ok(())
}

/// Insert city yields using Appender
pub fn insert_city_yields(
    conn: &Connection,
    yields: &[CityYield],
    id_mapper: &IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for yield_data in yields {
        let city_id = id_mapper.get_city(yield_data.city_xml_id)?;

        rows.push((
            city_id,
            id_mapper.match_id,
            yield_data.yield_type.clone(),
            yield_data.progress,
        ));
    }

    // Deduplicate by (city_id, match_id, yield_type) - last-wins
    let unique_rows = deduplicate_rows_last_wins(rows, |(city_id, match_id, yield_type, _)| {
        (*city_id, *match_id, yield_type.clone())
    });

    let mut app = conn.appender("city_yields")?;
    for (city_id, match_id, yield_type, progress) in unique_rows {
        app.append_row(params![city_id, match_id, yield_type, progress, 0, 0])?;
    }

    drop(app);
    Ok(())
}

/// Insert city religions using Appender
pub fn insert_city_religions(
    conn: &Connection,
    religions: &[CityReligion],
    id_mapper: &IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for religion_data in religions {
        let city_id = id_mapper.get_city(religion_data.city_xml_id)?;

        rows.push((
            city_id,
            id_mapper.match_id,
            religion_data.religion.clone(),
        ));
    }

    // Deduplicate by (city_id, match_id, religion) - last-wins
    let unique_rows = deduplicate_rows_last_wins(rows, |(city_id, match_id, religion)| {
        (*city_id, *match_id, religion.clone())
    });

    let mut app = conn.appender("city_religions")?;
    for (city_id, match_id, religion) in unique_rows {
        app.append_row(params![city_id, match_id, religion, None::<i32>])?; // acquired_turn not available in XML
    }

    drop(app);
    Ok(())
}

/// Insert city culture data using Appender
pub fn insert_city_culture(
    conn: &Connection,
    culture_data: &[CityCulture],
    id_mapper: &IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for culture in culture_data {
        let city_id = id_mapper.get_city(culture.city_xml_id)?;

        rows.push((
            city_id,
            id_mapper.match_id,
            culture.team_id,
            culture.culture_level,
            culture.happiness_level,
        ));
    }

    // Deduplicate by (city_id, match_id, team_id) - last-wins
    let unique_rows =
        deduplicate_rows_last_wins(rows, |(city_id, match_id, team_id, _, _)| {
            (*city_id, *match_id, *team_id)
        });

    let mut app = conn.appender("city_culture")?;
    for (city_id, match_id, team_id, culture_level, happiness_level) in unique_rows {
        app.append_row(params![
            city_id,
            match_id,
            team_id,
            culture_level,
            0, // culture_progress (not available in XML)
            happiness_level
        ])?;
    }

    drop(app);
    Ok(())
}
