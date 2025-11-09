// Player-nested gameplay data inserters (hybrid architecture)
//
// Inserts player-specific nested data into DB tables:
// - PlayerResource -> player_resources table
// - TechnologyProgress -> technology_progress table
// - TechnologyCompleted -> technologies_completed table
// - TechnologyState -> technology_states table
// - PlayerCouncil -> player_council table
// - Law -> laws table
// - PlayerGoal -> player_goals table

use crate::parser::game_data::{
    Law, PlayerCouncil, PlayerGoal, PlayerResource, TechnologyCompleted, TechnologyProgress,
    TechnologyState,
};
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert player resources using Appender
pub fn insert_player_resources(
    conn: &Connection,
    resources: &[PlayerResource],
    id_mapper: &IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for resource in resources {
        let player_id = id_mapper.get_player(resource.player_xml_id)?;

        rows.push((
            player_id,
            id_mapper.match_id,
            resource.yield_type.clone(),
            resource.amount,
        ));
    }

    let unique_rows = deduplicate_rows_last_wins(rows, |(player_id, match_id, yield_type, _)| {
        (*player_id, *match_id, yield_type.clone())
    });

    let mut app = conn.appender("player_resources")?;
    for (player_id, match_id, yield_type, amount) in unique_rows {
        app.append_row(params![player_id, match_id, yield_type, amount])?;
    }

    drop(app);
    Ok(())
}

/// Insert technology progress using Appender
pub fn insert_technology_progress(
    conn: &Connection,
    tech_progress: &[TechnologyProgress],
    id_mapper: &IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for progress in tech_progress {
        let player_id = id_mapper.get_player(progress.player_xml_id)?;

        rows.push((
            player_id,
            id_mapper.match_id,
            progress.tech.clone(),
            progress.progress,
        ));
    }

    let unique_rows = deduplicate_rows_last_wins(rows, |(player_id, match_id, tech, _)| {
        (*player_id, *match_id, tech.clone())
    });

    let mut app = conn.appender("technology_progress")?;
    for (player_id, match_id, tech, progress) in unique_rows {
        app.append_row(params![player_id, match_id, tech, progress])?;
    }

    drop(app);
    Ok(())
}

/// Insert completed technologies using Appender
pub fn insert_technologies_completed(
    conn: &Connection,
    completed: &[TechnologyCompleted],
    id_mapper: &IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for tech in completed {
        let player_id = id_mapper.get_player(tech.player_xml_id)?;

        rows.push((
            player_id,
            id_mapper.match_id,
            tech.tech.clone(),
            tech.completed_turn,
        ));
    }

    let unique_rows = deduplicate_rows_last_wins(rows, |(player_id, match_id, tech, _)| {
        (*player_id, *match_id, tech.clone())
    });

    let mut app = conn.appender("technologies_completed")?;
    for (player_id, match_id, tech, completed_turn) in unique_rows {
        app.append_row(params![player_id, match_id, tech, completed_turn])?;
    }

    drop(app);
    Ok(())
}

/// Insert technology states using Appender
pub fn insert_technology_states(
    conn: &Connection,
    states: &[TechnologyState],
    id_mapper: &IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for state in states {
        let player_id = id_mapper.get_player(state.player_xml_id)?;

        rows.push((
            player_id,
            id_mapper.match_id,
            state.tech.clone(),
            state.state.clone(),
        ));
    }

    let unique_rows = deduplicate_rows_last_wins(rows, |(player_id, match_id, tech, _)| {
        (*player_id, *match_id, tech.clone())
    });

    let mut app = conn.appender("technology_states")?;
    for (player_id, match_id, tech, state) in unique_rows {
        app.append_row(params![player_id, match_id, tech, state])?;
    }

    drop(app);
    Ok(())
}

/// Insert player council positions using Appender
pub fn insert_player_council(
    conn: &Connection,
    council: &[PlayerCouncil],
    id_mapper: &IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for position in council {
        let player_id = id_mapper.get_player(position.player_xml_id)?;
        let character_id = id_mapper.get_character(position.character_xml_id)?;

        rows.push((
            player_id,
            id_mapper.match_id,
            position.position.clone(),
            character_id,
            position.appointed_turn,
        ));
    }

    let unique_rows =
        deduplicate_rows_last_wins(rows, |(player_id, match_id, position, _, _)| {
            (*player_id, *match_id, position.clone())
        });

    let mut app = conn.appender("player_council")?;
    for (player_id, match_id, position, character_id, appointed_turn) in unique_rows {
        app.append_row(params![
            player_id,
            match_id,
            position,
            character_id,
            appointed_turn
        ])?;
    }

    drop(app);
    Ok(())
}

/// Insert laws using Appender
pub fn insert_laws(conn: &Connection, laws: &[Law], id_mapper: &IdMapper) -> Result<()> {
    let mut rows = Vec::new();

    for law in laws {
        let player_id = id_mapper.get_player(law.player_xml_id)?;

        rows.push((
            player_id,
            id_mapper.match_id,
            law.law_category.clone(),
            law.law.clone(),
            law.adopted_turn,
            law.change_count,
        ));
    }

    let unique_rows =
        deduplicate_rows_last_wins(rows, |(player_id, match_id, law_category, _, _, _)| {
            (*player_id, *match_id, law_category.clone())
        });

    let mut app = conn.appender("laws")?;
    for (player_id, match_id, law_category, law, adopted_turn, change_count) in unique_rows {
        app.append_row(params![
            player_id,
            match_id,
            law_category,
            law,
            adopted_turn,
            change_count
        ])?;
    }

    drop(app);
    Ok(())
}

/// Insert player goals using Appender
pub fn insert_player_goals(
    conn: &Connection,
    goals: &[PlayerGoal],
    id_mapper: &IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for goal in goals {
        let player_id = id_mapper.get_player(goal.player_xml_id)?;

        // Map leader_character_xml_id to DB ID if present
        let leader_character_id: Option<i64> = if let Some(xml_id) = goal.leader_character_xml_id {
            Some(id_mapper.get_character(xml_id)?)
        } else {
            None
        };

        // Generate stable goal_id
        let goal_id = (id_mapper.match_id * 1_000_000) + (player_id * 1000) + goal.goal_xml_id as i64;

        rows.push((
            goal_id,
            player_id,
            id_mapper.match_id,
            goal.goal_type.clone(),
            leader_character_id,
            goal.started_turn,
            goal.completed_turn,
            goal.failed_turn,
            goal.max_turns,
            goal.progress,
            goal.goal_state.clone(),
        ));
    }

    let unique_rows = deduplicate_rows_last_wins(rows, |(goal_id, ..)| *goal_id);

    let mut app = conn.appender("player_goals")?;
    for (
        goal_id,
        player_id,
        match_id,
        goal_type,
        leader_character_id,
        started_turn,
        completed_turn,
        failed_turn,
        max_turns,
        progress,
        goal_state,
    ) in unique_rows
    {
        app.append_row(params![
            goal_id,
            player_id,
            match_id,
            goal_type,
            leader_character_id,
            started_turn,
            completed_turn,
            failed_turn,
            max_turns,
            progress,
            goal_state
        ])?;
    }

    drop(app);
    Ok(())
}
