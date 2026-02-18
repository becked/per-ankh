//! Unit inserter - bulk insertion to database

use crate::parser::game_data::{UnitData, UnitEffect, UnitFamily, UnitPromotion};
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};

pub fn insert_units(
    conn: &Connection,
    units: &[UnitData],
    id_mapper: &mut IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for unit in units {
        let db_id = id_mapper.map_unit(unit.xml_id);
        let tile_db_id = id_mapper.get_tile(unit.tile_xml_id)?;

        let player_db_id = match unit.player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        let original_player_db_id = match unit.original_player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        rows.push((
            db_id,
            id_mapper.match_id,
            unit.xml_id,
            tile_db_id,
            unit.unit_type.clone(),
            player_db_id,
            unit.tribe.clone(),
            unit.xp,
            unit.level,
            unit.create_turn,
            unit.facing.clone(),
            original_player_db_id,
            unit.turns_since_last_move,
            unit.gender.clone(),
            unit.is_sleeping,
            unit.current_formation.clone(),
            unit.seed,
        ));
    }

    let unique_units =
        deduplicate_rows_last_wins(rows, |(unit_id, match_id, ..)| (*unit_id, *match_id));

    let mut app = conn.appender("units")?;
    for (
        db_id,
        match_id,
        xml_id,
        tile_db_id,
        unit_type,
        player_db_id,
        tribe,
        xp,
        level,
        create_turn,
        facing,
        original_player_db_id,
        turns_since_last_move,
        gender,
        is_sleeping,
        current_formation,
        seed,
    ) in unique_units
    {
        app.append_row(params![
            db_id,
            match_id,
            xml_id,
            tile_db_id,
            unit_type,
            player_db_id,
            tribe,
            xp,
            level,
            create_turn,
            facing,
            original_player_db_id,
            turns_since_last_move,
            gender,
            is_sleeping,
            current_formation,
            seed
        ])?;
    }
    app.flush()?;

    log::info!("Inserted {} units", units.len());
    Ok(())
}

pub fn insert_unit_promotions(
    conn: &Connection,
    promotions: &[UnitPromotion],
    id_mapper: &IdMapper,
) -> Result<()> {
    if promotions.is_empty() {
        return Ok(());
    }

    let mut rows: Vec<(i64, i64, String, bool)> = Vec::new();
    for promo in promotions {
        let unit_db_id = id_mapper.get_unit(promo.unit_xml_id)?;
        rows.push((
            unit_db_id,
            id_mapper.match_id,
            promo.promotion.clone(),
            promo.is_acquired,
        ));
    }

    let unique = deduplicate_rows_last_wins(rows, |(unit_id, match_id, promo, _)| {
        (*unit_id, *match_id, promo.clone())
    });

    let mut app = conn.appender("unit_promotions")?;
    for (unit_id, match_id, promotion, is_acquired) in unique {
        app.append_row(params![unit_id, match_id, promotion, is_acquired])?;
    }
    app.flush()?;

    log::info!("Inserted {} unit promotions", promotions.len());
    Ok(())
}

pub fn insert_unit_effects(
    conn: &Connection,
    effects: &[UnitEffect],
    id_mapper: &IdMapper,
) -> Result<()> {
    if effects.is_empty() {
        return Ok(());
    }

    let mut rows: Vec<(i64, i64, String, i32)> = Vec::new();
    for effect in effects {
        let unit_db_id = id_mapper.get_unit(effect.unit_xml_id)?;
        rows.push((
            unit_db_id,
            id_mapper.match_id,
            effect.effect.clone(),
            effect.stacks,
        ));
    }

    let unique = deduplicate_rows_last_wins(rows, |(unit_id, match_id, effect, _)| {
        (*unit_id, *match_id, effect.clone())
    });

    let mut app = conn.appender("unit_effects")?;
    for (unit_id, match_id, effect, stacks) in unique {
        app.append_row(params![unit_id, match_id, effect, stacks])?;
    }
    app.flush()?;

    log::info!("Inserted {} unit effects", effects.len());
    Ok(())
}

pub fn insert_unit_families(
    conn: &Connection,
    families: &[UnitFamily],
    id_mapper: &IdMapper,
) -> Result<()> {
    if families.is_empty() {
        return Ok(());
    }

    let mut rows: Vec<(i64, i64, i64, String)> = Vec::new();
    for fam in families {
        let unit_db_id = id_mapper.get_unit(fam.unit_xml_id)?;
        let player_db_id = id_mapper.get_player(fam.player_xml_id)?;
        rows.push((
            unit_db_id,
            id_mapper.match_id,
            player_db_id,
            fam.family_name.clone(),
        ));
    }

    let unique = deduplicate_rows_last_wins(rows, |(unit_id, match_id, player_id, _)| {
        (*unit_id, *match_id, *player_id)
    });

    let mut app = conn.appender("unit_families")?;
    for (unit_id, match_id, player_id, family_name) in unique {
        app.append_row(params![unit_id, match_id, player_id, family_name])?;
    }
    app.flush()?;

    log::info!("Inserted {} unit family associations", families.len());
    Ok(())
}
