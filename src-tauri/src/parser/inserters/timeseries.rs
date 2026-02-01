// Time-series data inserters - bulk DB insertion with deduplication
//
// Inserts parsed time-series data into DuckDB using Appender API.

use crate::parser::game_data::{
    FamilyOpinionHistory, LegitimacyHistory, MilitaryPowerHistory, PointsHistory,
    ReligionOpinionHistory, YieldPriceHistory, YieldRateHistory, YieldTotalHistory,
};
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert game-level yield price history
pub fn insert_yield_price_history(
    conn: &Connection,
    items: &[YieldPriceHistory],
    id_mapper: &IdMapper,
) -> Result<()> {
    if items.is_empty() {
        return Ok(());
    }

    let rows: Vec<_> = items
        .iter()
        .map(|item| (id_mapper.match_id, item.turn, item.yield_type.clone(), item.price))
        .collect();

    let unique_rows = deduplicate_rows_last_wins(rows, |(match_id, turn, yield_type, _)| {
        (*match_id, *turn, yield_type.clone())
    });

    let mut app = conn.appender("yield_prices")?;
    for (match_id, turn, yield_type, price) in unique_rows {
        app.append_row(params![match_id, turn, yield_type, price])?;
    }
    drop(app);

    Ok(())
}

/// Insert player military power history
pub fn insert_military_power_history(
    conn: &Connection,
    items: &[MilitaryPowerHistory],
    id_mapper: &IdMapper,
) -> Result<()> {
    if items.is_empty() {
        return Ok(());
    }

    let mut rows = Vec::new();
    for item in items {
        let player_id = id_mapper.get_player(item.player_xml_id)?;
        rows.push((player_id, id_mapper.match_id, item.turn, item.military_power));
    }

    let unique_rows =
        deduplicate_rows_last_wins(rows, |(player_id, match_id, turn, _)| {
            (*player_id, *match_id, *turn)
        });

    let mut app = conn.appender("military_history")?;
    for (player_id, match_id, turn, military_power) in unique_rows {
        app.append_row(params![player_id, match_id, turn, military_power])?;
    }
    drop(app);

    Ok(())
}

/// Insert player points history
pub fn insert_points_history(
    conn: &Connection,
    items: &[PointsHistory],
    id_mapper: &IdMapper,
) -> Result<()> {
    if items.is_empty() {
        return Ok(());
    }

    let mut rows = Vec::new();
    for item in items {
        let player_id = id_mapper.get_player(item.player_xml_id)?;
        rows.push((player_id, id_mapper.match_id, item.turn, item.points));
    }

    let unique_rows =
        deduplicate_rows_last_wins(rows, |(player_id, match_id, turn, _)| {
            (*player_id, *match_id, *turn)
        });

    let mut app = conn.appender("points_history")?;
    for (player_id, match_id, turn, points) in unique_rows {
        app.append_row(params![player_id, match_id, turn, points])?;
    }
    drop(app);

    Ok(())
}

/// Insert player legitimacy history
pub fn insert_legitimacy_history(
    conn: &Connection,
    items: &[LegitimacyHistory],
    id_mapper: &IdMapper,
) -> Result<()> {
    if items.is_empty() {
        return Ok(());
    }

    let mut rows = Vec::new();
    for item in items {
        let player_id = id_mapper.get_player(item.player_xml_id)?;
        rows.push((player_id, id_mapper.match_id, item.turn, item.legitimacy));
    }

    let unique_rows =
        deduplicate_rows_last_wins(rows, |(player_id, match_id, turn, _)| {
            (*player_id, *match_id, *turn)
        });

    let mut app = conn.appender("legitimacy_history")?;
    for (player_id, match_id, turn, legitimacy) in unique_rows {
        app.append_row(params![player_id, match_id, turn, legitimacy])?;
    }
    drop(app);

    Ok(())
}

/// Insert player yield rate history (per-yield type)
pub fn insert_yield_rate_history(
    conn: &Connection,
    items: &[YieldRateHistory],
    id_mapper: &IdMapper,
) -> Result<()> {
    if items.is_empty() {
        return Ok(());
    }

    let mut rows = Vec::new();
    for item in items {
        let player_id = id_mapper.get_player(item.player_xml_id)?;
        rows.push((
            player_id,
            id_mapper.match_id,
            item.turn,
            item.yield_type.clone(),
            item.amount,
        ));
    }

    let unique_rows = deduplicate_rows_last_wins(
        rows,
        |(player_id, match_id, turn, yield_type, _)| {
            (*player_id, *match_id, *turn, yield_type.clone())
        },
    );

    let mut app = conn.appender("yield_history")?;
    for (player_id, match_id, turn, yield_type, amount) in unique_rows {
        app.append_row(params![player_id, match_id, turn, yield_type, amount])?;
    }
    drop(app);

    Ok(())
}

/// Insert player yield total history (per-yield type)
/// More accurate cumulative totals available in game v1.0.81366+ (January 2026)
pub fn insert_yield_total_history(
    conn: &Connection,
    items: &[YieldTotalHistory],
    id_mapper: &IdMapper,
) -> Result<()> {
    if items.is_empty() {
        return Ok(());
    }

    let mut rows = Vec::new();
    for item in items {
        let player_id = id_mapper.get_player(item.player_xml_id)?;
        rows.push((
            player_id,
            id_mapper.match_id,
            item.turn,
            item.yield_type.clone(),
            item.amount,
        ));
    }

    let unique_rows = deduplicate_rows_last_wins(
        rows,
        |(player_id, match_id, turn, yield_type, _)| {
            (*player_id, *match_id, *turn, yield_type.clone())
        },
    );

    let mut app = conn.appender("yield_total_history")?;
    for (player_id, match_id, turn, yield_type, amount) in unique_rows {
        app.append_row(params![player_id, match_id, turn, yield_type, amount])?;
    }
    drop(app);

    Ok(())
}

/// Insert player family opinion history (per-family)
pub fn insert_family_opinion_history(
    conn: &Connection,
    items: &[FamilyOpinionHistory],
    id_mapper: &IdMapper,
) -> Result<()> {
    if items.is_empty() {
        return Ok(());
    }

    let mut rows = Vec::new();
    for item in items {
        let player_id = id_mapper.get_player(item.player_xml_id)?;
        rows.push((
            player_id,
            id_mapper.match_id,
            item.family_name.clone(),
            item.turn,
            item.opinion,
        ));
    }

    let unique_rows = deduplicate_rows_last_wins(
        rows,
        |(player_id, match_id, family_name, turn, _)| {
            (*player_id, *match_id, family_name.clone(), *turn)
        },
    );

    let mut app = conn.appender("family_opinion_history")?;
    for (player_id, match_id, family_name, turn, opinion) in unique_rows {
        app.append_row(params![player_id, match_id, family_name, turn, opinion])?;
    }
    drop(app);

    Ok(())
}

/// Insert player religion opinion history (per-religion)
pub fn insert_religion_opinion_history(
    conn: &Connection,
    items: &[ReligionOpinionHistory],
    id_mapper: &IdMapper,
) -> Result<()> {
    if items.is_empty() {
        return Ok(());
    }

    let mut rows = Vec::new();
    for item in items {
        let player_id = id_mapper.get_player(item.player_xml_id)?;
        rows.push((
            player_id,
            id_mapper.match_id,
            item.religion_name.clone(),
            item.turn,
            item.opinion,
        ));
    }

    let unique_rows = deduplicate_rows_last_wins(
        rows,
        |(player_id, match_id, religion_name, turn, _)| {
            (*player_id, *match_id, religion_name.clone(), *turn)
        },
    );

    let mut app = conn.appender("religion_opinion_history")?;
    for (player_id, match_id, religion_name, turn, opinion) in unique_rows {
        app.append_row(params![player_id, match_id, religion_name, turn, opinion])?;
    }
    drop(app);

    Ok(())
}
