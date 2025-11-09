// Diplomacy inserter - inserts DiplomacyRelation structs into diplomacy table

use crate::parser::game_data::DiplomacyRelation;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert diplomacy relations into database
///
/// Note: Diplomacy table uses string IDs directly (not FK to other tables)
/// because entity1_id and entity2_id can be either player IDs or tribe names
pub fn insert_diplomacy_relations(
    conn: &Connection,
    relations: &[DiplomacyRelation],
    match_id: i64,
) -> Result<()> {
    if relations.is_empty() {
        return Ok(());
    }

    let mut rows = Vec::new();

    for relation in relations {
        rows.push((
            match_id,
            relation.entity1_type.clone(),
            relation.entity1_id.clone(),
            relation.entity2_type.clone(),
            relation.entity2_id.clone(),
            relation.relation.clone(),
            relation.war_score,
            relation.last_conflict_turn,
            relation.last_diplomacy_turn,
            relation.diplomacy_blocked_until_turn,
        ));
    }

    // Deduplicate by (match_id, entity1_type, entity1_id, entity2_type, entity2_id)
    let unique_rows = deduplicate_rows_last_wins(rows, |(match_id, e1t, e1id, e2t, e2id, ..)| {
        (*match_id, e1t.clone(), e1id.clone(), e2t.clone(), e2id.clone())
    });

    // Bulk insert using DuckDB Appender
    let mut app = conn.appender("diplomacy")?;
    for (
        match_id,
        entity1_type,
        entity1_id,
        entity2_type,
        entity2_id,
        relation,
        war_score,
        last_conflict_turn,
        last_diplomacy_turn,
        diplomacy_blocked_until_turn,
    ) in unique_rows
    {
        app.append_row(params![
            match_id,
            entity1_type,
            entity1_id,
            entity2_type,
            entity2_id,
            relation,
            war_score,
            last_conflict_turn,
            last_diplomacy_turn,
            diplomacy_blocked_until_turn,
        ])?;
    }

    drop(app);
    Ok(())
}
