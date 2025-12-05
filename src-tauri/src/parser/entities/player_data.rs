// Player-nested gameplay data parsers
//
// This module parses gameplay data that is nested within <Player> elements:
// - YieldStockpile → player_resources
// - TechProgress → technology_progress
// - TechCount → technologies_completed
// - TechAvailable/Passed/Trashed/Locked/Target → technology_states
// - CouncilCharacter → player_council
// - ActiveLaw → laws
// - GoalList → player_goals

use crate::parser::id_mapper::IdMapper;
use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};
use roxmltree::Node;

/// Parse YieldStockpile to player_resources table
///
/// Example XML:
/// ```xml
/// <YieldStockpile>
///   <YIELD_CIVICS>15595</YIELD_CIVICS>
///   <YIELD_TRAINING>4874</YIELD_TRAINING>
/// </YieldStockpile>
/// ```
pub fn parse_player_resources(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

    // Find YieldStockpile child element
    if let Some(yields_node) = player_node.children().find(|n| n.has_tag_name("YieldStockpile")) {
        // Iterate over all child elements (YIELD_CIVICS, YIELD_TRAINING, etc.)
        for yield_node in yields_node.children().filter(|n| n.is_element()) {
            let yield_type = yield_node.tag_name().name(); // "YIELD_CIVICS"
            let amount: i32 = yield_node
                .text()
                .ok_or_else(|| {
                    ParseError::MissingElement(format!(
                        "YieldStockpile.{} text content",
                        yield_type
                    ))
                })?
                .parse()
                .map_err(|_| {
                    ParseError::InvalidFormat(format!(
                        "YieldStockpile.{} must be an integer",
                        yield_type
                    ))
                })?;

            conn.execute(
                "INSERT INTO player_resources (player_id, match_id, yield_type, amount)
                 VALUES (?, ?, ?, ?)",
                params![player_id, match_id, yield_type, amount],
            )?;

            count += 1;
        }
    }

    Ok(count)
}

/// Parse TechProgress to technology_progress table
///
/// Example XML:
/// ```xml
/// <TechProgress>
///   <TECH_IRONWORKING>1001</TECH_IRONWORKING>
///   <TECH_STONECUTTING>414</TECH_STONECUTTING>
/// </TechProgress>
/// ```
pub fn parse_technology_progress(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

    if let Some(tech_progress_node) = player_node
        .children()
        .find(|n| n.has_tag_name("TechProgress"))
    {
        for tech_node in tech_progress_node.children().filter(|n| n.is_element()) {
            let tech = tech_node.tag_name().name();
            let progress: i32 = tech_node
                .text()
                .ok_or_else(|| {
                    ParseError::MissingElement(format!("TechProgress.{} text content", tech))
                })?
                .parse()
                .map_err(|_| {
                    ParseError::InvalidFormat(format!("TechProgress.{} must be an integer", tech))
                })?;

            conn.execute(
                "INSERT INTO technology_progress (player_id, match_id, tech, progress)
                 VALUES (?, ?, ?, ?)",
                params![player_id, match_id, tech, progress],
            )?;

            count += 1;
        }
    }

    Ok(count)
}

/// Parse TechCount to technologies_completed table
///
/// TechCount contains entries where count > 0 indicates the tech is completed.
///
/// Example XML:
/// ```xml
/// <TechCount>
///   <TECH_IRONWORKING>1</TECH_IRONWORKING>
///   <TECH_TRAPPING>1</TECH_TRAPPING>
/// </TechCount>
/// ```
pub fn parse_technologies_completed(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

    if let Some(tech_count_node) = player_node.children().find(|n| n.has_tag_name("TechCount")) {
        for tech_node in tech_count_node.children().filter(|n| n.is_element()) {
            let tech = tech_node.tag_name().name();
            let tech_count: i32 = tech_node
                .text()
                .ok_or_else(|| {
                    ParseError::MissingElement(format!("TechCount.{} text content", tech))
                })?
                .parse()
                .map_err(|_| {
                    ParseError::InvalidFormat(format!("TechCount.{} must be an integer", tech))
                })?;

            // Only insert if count > 0 (tech is completed)
            if tech_count > 0 {
                // We don't have completed_turn in the XML at this location
                // It would need to come from a different source or be NULL
                conn.execute(
                    "INSERT INTO technologies_completed (player_id, match_id, tech, completed_turn)
                     VALUES (?, ?, ?, ?)",
                    params![player_id, match_id, tech, None::<i32>],
                )?;

                count += 1;
            }
        }
    }

    Ok(count)
}

/// Parse technology states (TechAvailable, TechPassed, TechTrashed, TechLocked, TechTarget)
///
/// Example XML:
/// ```xml
/// <TechAvailable>
///   <TECH_FORESTRY />
///   <TECH_SAILING />
/// </TechAvailable>
/// <TechPassed>
///   <TECH_MINING />
/// </TechPassed>
/// ```
pub fn parse_technology_states(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

    // Map of XML element names to state values
    let state_mappings = [
        ("TechAvailable", "available"),
        ("TechPassed", "passed"),
        ("TechTrashed", "trashed"),
        ("TechLocked", "locked"),
        ("TechTarget", "targeted"),
    ];

    for (element_name, state) in &state_mappings {
        if let Some(state_node) = player_node.children().find(|n| n.has_tag_name(*element_name)) {
            for tech_node in state_node.children().filter(|n| n.is_element()) {
                let tech = tech_node.tag_name().name();

                conn.execute(
                    "INSERT INTO technology_states (player_id, match_id, tech, state)
                     VALUES (?, ?, ?, ?)",
                    params![player_id, match_id, tech, state],
                )?;

                count += 1;
            }
        }
    }

    Ok(count)
}

/// Parse CouncilCharacter to player_council table
///
/// Example XML:
/// ```xml
/// <CouncilCharacter>
///   <COUNCIL_GRAND_VIZIER>12</COUNCIL_GRAND_VIZIER>
///   <COUNCIL_CHANCELLOR>5</COUNCIL_CHANCELLOR>
/// </CouncilCharacter>
/// ```
pub fn parse_player_council(
    player_node: &Node,
    conn: &Connection,
    id_mapper: &IdMapper,
    player_id: i64,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

    if let Some(council_node) = player_node
        .children()
        .find(|n| n.has_tag_name("CouncilCharacter"))
    {
        for position_node in council_node.children().filter(|n| n.is_element()) {
            let position = position_node.tag_name().name(); // COUNCIL_GRAND_VIZIER
            let character_xml_id: i32 = position_node
                .text()
                .ok_or_else(|| {
                    ParseError::MissingElement(format!(
                        "CouncilCharacter.{} text content",
                        position
                    ))
                })?
                .parse()
                .map_err(|_| {
                    ParseError::InvalidFormat(format!(
                        "CouncilCharacter.{} must be an integer",
                        position
                    ))
                })?;

            // Map character XML ID to database ID
            let character_id = id_mapper.get_character(character_xml_id)?;

            // We don't have appointed_turn in this XML location
            conn.execute(
                "INSERT INTO player_council (player_id, match_id, position, character_id, appointed_turn)
                 VALUES (?, ?, ?, ?, ?)",
                params![player_id, match_id, position, character_id, None::<i32>],
            )?;

            count += 1;
        }
    }

    Ok(count)
}

/// Parse ActiveLaw to laws table
///
/// Example XML:
/// ```xml
/// <ActiveLaw>
///   <LAWCLASS_ORDER>LAW_PRIMOGENITURE</LAWCLASS_ORDER>
///   <LAWCLASS_EPICS_EXPLORATION>LAW_EXPLORATION</LAWCLASS_EPICS_EXPLORATION>
/// </ActiveLaw>
/// ```
pub fn parse_laws(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

    if let Some(active_law_node) = player_node.children().find(|n| n.has_tag_name("ActiveLaw")) {
        for law_node in active_law_node.children().filter(|n| n.is_element()) {
            let law_category = law_node.tag_name().name(); // LAWCLASS_ORDER
            let law = law_node
                .text()
                .ok_or_else(|| {
                    ParseError::MissingElement(format!("ActiveLaw.{} text content", law_category))
                })?;

            // We don't have adopted_turn in ActiveLaw
            // Use 0 as placeholder (schema requires NOT NULL)
            // Change count might be in LawClassChangeCount
            conn.execute(
                "INSERT INTO laws (player_id, match_id, law_category, law, adopted_turn, change_count)
                 VALUES (?, ?, ?, ?, ?, ?)",
                params![player_id, match_id, law_category, law, 0, 1],
            )?;

            count += 1;
        }
    }

    Ok(count)
}

/// Parse GoalList to player_goals table
///
/// Example XML:
/// ```xml
/// <GoalList>
///   <GoalData>
///     <Type>GOAL_SIX_TECHS</Type>
///     <ID>0</ID>
///     <LeaderID>4</LeaderID>
///     <Turn>37</Turn>
///     <MaxTurns>20</MaxTurns>
///     <Legacy />
///     <Stats>
///       <STAT_TECH_DISCOVERED>5</STAT_TECH_DISCOVERED>
///     </Stats>
///   </GoalData>
/// </GoalList>
/// ```
pub fn parse_player_goals(
    player_node: &Node,
    conn: &Connection,
    id_mapper: &IdMapper,
    player_id: i64,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

    if let Some(goal_list_node) = player_node.children().find(|n| n.has_tag_name("GoalList")) {
        for goal_data_node in goal_list_node.children().filter(|n| n.has_tag_name("GoalData")) {
            // Required fields
            let goal_type: String = goal_data_node
                .children()
                .find(|n| n.has_tag_name("Type"))
                .and_then(|n| n.text())
                .ok_or_else(|| ParseError::MissingElement("GoalData.Type".to_string()))?
                .to_string();

            let goal_xml_id: i32 = goal_data_node
                .children()
                .find(|n| n.has_tag_name("ID"))
                .and_then(|n| n.text())
                .ok_or_else(|| ParseError::MissingElement("GoalData.ID".to_string()))?
                .parse()
                .map_err(|_| ParseError::InvalidFormat("GoalData.ID must be an integer".to_string()))?;

            let started_turn: i32 = goal_data_node
                .children()
                .find(|n| n.has_tag_name("Turn"))
                .and_then(|n| n.text())
                .ok_or_else(|| ParseError::MissingElement("GoalData.Turn".to_string()))?
                .parse()
                .map_err(|_| ParseError::InvalidFormat("GoalData.Turn must be an integer".to_string()))?;

            // Optional fields
            let leader_xml_id: Option<i32> = goal_data_node
                .children()
                .find(|n| n.has_tag_name("LeaderID"))
                .and_then(|n| n.text())
                .and_then(|s| s.parse().ok());

            let leader_character_id: Option<i64> = if let Some(xml_id) = leader_xml_id {
                Some(id_mapper.get_character(xml_id)?)
            } else {
                None
            };

            let max_turns: Option<i32> = goal_data_node
                .children()
                .find(|n| n.has_tag_name("MaxTurns"))
                .and_then(|n| n.text())
                .and_then(|s| s.parse().ok());

            // Check if goal is finished or failed
            let finished = goal_data_node
                .children()
                .any(|n| n.has_tag_name("Finished"));

            let completed_turn: Option<i32> = if finished {
                Some(started_turn) // We don't have exact completion turn, use started_turn as placeholder
            } else {
                None
            };

            let failed_turn: Option<i32> = None; // Would need to check GoalsFailed or similar

            // Generate a stable goal_id based on player, match, and goal XML ID
            let goal_id = (match_id as i64) * 1_000_000 + (player_id as i64) * 1000 + (goal_xml_id as i64);

            // Serialize Stats to JSON if present
            let goal_state: Option<String> = if let Some(stats_node) = goal_data_node
                .children()
                .find(|n| n.has_tag_name("Stats"))
            {
                let mut stats = serde_json::Map::new();
                for stat_node in stats_node.children().filter(|n| n.is_element()) {
                    let stat_name = stat_node.tag_name().name();
                    if let Some(stat_value) = stat_node.text() {
                        stats.insert(
                            stat_name.to_string(),
                            serde_json::Value::String(stat_value.to_string()),
                        );
                    }
                }
                if !stats.is_empty() {
                    serde_json::to_string(&stats).ok()
                } else {
                    None
                }
            } else {
                None
            };

            conn.execute(
                "INSERT INTO player_goals (
                    goal_id, player_id, match_id, goal_type, leader_character_id,
                    started_turn, completed_turn, failed_turn, max_turns, progress, goal_state
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    goal_id,
                    player_id,
                    match_id,
                    goal_type,
                    leader_character_id,
                    started_turn,
                    completed_turn,
                    failed_turn,
                    max_turns,
                    0, // progress - would need to calculate from Stats
                    goal_state
                ],
            )?;

            count += 1;
        }
    }

    Ok(count)
}

#[cfg(test)]
mod tests {
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_yield_stockpile() {
        let xml = r#"<Root GameId="test">
            <Player ID="0" Name="Test">
                <YieldStockpile>
                    <YIELD_CIVICS>15595</YIELD_CIVICS>
                    <YIELD_TRAINING>4874</YIELD_TRAINING>
                </YieldStockpile>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let player_node = doc
            .root_element()
            .children()
            .find(|n| n.has_tag_name("Player"))
            .unwrap();

        let yields_node = player_node
            .children()
            .find(|n| n.has_tag_name("YieldStockpile"))
            .unwrap();

        let mut count = 0;
        for yield_node in yields_node.children().filter(|n| n.is_element()) {
            assert!(yield_node.tag_name().name().starts_with("YIELD_"));
            assert!(yield_node.text().is_some());
            count += 1;
        }

        assert_eq!(count, 2);
    }
}
