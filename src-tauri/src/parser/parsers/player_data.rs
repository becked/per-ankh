// Player-nested gameplay data parsers
//
// Parses gameplay data nested within <Player> elements to typed structs.
// These parsers extract data without database dependency.

use crate::parser::game_data::{
    Law, PlayerCouncil, PlayerGoal, PlayerResource, TechnologyCompleted, TechnologyProgress,
    TechnologyState,
};
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};

/// Parse all player_data from document
///
/// This is the main entry point that orchestrates all player-nested data parsing.
pub fn parse_all_player_data(doc: &XmlDocument) -> Result<PlayerDataCollection> {
    let root = doc.root_element();
    let mut collection = PlayerDataCollection::default();

    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let player_xml_id: i32 = player_node.req_attr("ID")?.parse()?;

        // Parse all nested data for this player
        collection
            .resources
            .extend(parse_player_resources_struct(&player_node, player_xml_id)?);
        collection
            .tech_progress
            .extend(parse_technology_progress_struct(&player_node, player_xml_id)?);
        collection
            .tech_completed
            .extend(parse_technologies_completed_struct(&player_node, player_xml_id)?);
        collection
            .tech_states
            .extend(parse_technology_states_struct(&player_node, player_xml_id)?);
        collection
            .council
            .extend(parse_player_council_struct(&player_node, player_xml_id)?);
        collection
            .laws
            .extend(parse_laws_struct(&player_node, player_xml_id)?);
        collection
            .goals
            .extend(parse_player_goals_struct(&player_node, player_xml_id)?);
    }

    Ok(collection)
}

/// Collection of all player-nested data
#[derive(Debug, Default)]
pub struct PlayerDataCollection {
    pub resources: Vec<PlayerResource>,
    pub tech_progress: Vec<TechnologyProgress>,
    pub tech_completed: Vec<TechnologyCompleted>,
    pub tech_states: Vec<TechnologyState>,
    pub council: Vec<PlayerCouncil>,
    pub laws: Vec<Law>,
    pub goals: Vec<PlayerGoal>,
}

/// Parse YieldStockpile to PlayerResource structs
///
/// Example XML:
/// ```xml
/// <YieldStockpile>
///   <YIELD_CIVICS>15595</YIELD_CIVICS>
///   <YIELD_TRAINING>4874</YIELD_TRAINING>
/// </YieldStockpile>
/// ```
fn parse_player_resources_struct(
    player_node: &roxmltree::Node,
    player_xml_id: i32,
) -> Result<Vec<PlayerResource>> {
    let mut resources = Vec::new();

    if let Some(yields_node) = player_node
        .children()
        .find(|n| n.has_tag_name("YieldStockpile"))
    {
        for yield_node in yields_node.children().filter(|n| n.is_element()) {
            let yield_type = yield_node.tag_name().name().to_string();
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

            resources.push(PlayerResource {
                player_xml_id,
                yield_type,
                amount,
            });
        }
    }

    Ok(resources)
}

/// Parse TechProgress to TechnologyProgress structs
///
/// Example XML:
/// ```xml
/// <TechProgress>
///   <TECH_IRONWORKING>1001</TECH_IRONWORKING>
///   <TECH_STONECUTTING>414</TECH_STONECUTTING>
/// </TechProgress>
/// ```
fn parse_technology_progress_struct(
    player_node: &roxmltree::Node,
    player_xml_id: i32,
) -> Result<Vec<TechnologyProgress>> {
    let mut tech_progress = Vec::new();

    if let Some(tech_progress_node) = player_node
        .children()
        .find(|n| n.has_tag_name("TechProgress"))
    {
        for tech_node in tech_progress_node.children().filter(|n| n.is_element()) {
            let tech = tech_node.tag_name().name().to_string();
            let progress: i32 = tech_node
                .text()
                .ok_or_else(|| {
                    ParseError::MissingElement(format!("TechProgress.{} text content", tech))
                })?
                .parse()
                .map_err(|_| {
                    ParseError::InvalidFormat(format!("TechProgress.{} must be an integer", tech))
                })?;

            tech_progress.push(TechnologyProgress {
                player_xml_id,
                tech,
                progress,
            });
        }
    }

    Ok(tech_progress)
}

/// Parse TechCount to TechnologyCompleted structs
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
fn parse_technologies_completed_struct(
    player_node: &roxmltree::Node,
    player_xml_id: i32,
) -> Result<Vec<TechnologyCompleted>> {
    let mut completed = Vec::new();

    if let Some(tech_count_node) = player_node
        .children()
        .find(|n| n.has_tag_name("TechCount"))
    {
        for tech_node in tech_count_node.children().filter(|n| n.is_element()) {
            let tech = tech_node.tag_name().name().to_string();
            let tech_count: i32 = tech_node
                .text()
                .ok_or_else(|| {
                    ParseError::MissingElement(format!("TechCount.{} text content", tech))
                })?
                .parse()
                .map_err(|_| {
                    ParseError::InvalidFormat(format!("TechCount.{} must be an integer", tech))
                })?;

            // Only include if count > 0 (tech is completed)
            if tech_count > 0 {
                completed.push(TechnologyCompleted {
                    player_xml_id,
                    tech,
                    completed_turn: None, // Not available in this XML location
                });
            }
        }
    }

    Ok(completed)
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
fn parse_technology_states_struct(
    player_node: &roxmltree::Node,
    player_xml_id: i32,
) -> Result<Vec<TechnologyState>> {
    let mut states = Vec::new();

    // Map of XML element names to state values
    let state_mappings = [
        ("TechAvailable", "available"),
        ("TechPassed", "passed"),
        ("TechTrashed", "trashed"),
        ("TechLocked", "locked"),
        ("TechTarget", "targeted"),
    ];

    for (element_name, state) in &state_mappings {
        if let Some(state_node) = player_node
            .children()
            .find(|n| n.has_tag_name(*element_name))
        {
            for tech_node in state_node.children().filter(|n| n.is_element()) {
                let tech = tech_node.tag_name().name().to_string();

                states.push(TechnologyState {
                    player_xml_id,
                    tech,
                    state: state.to_string(),
                });
            }
        }
    }

    Ok(states)
}

/// Parse CouncilCharacter to PlayerCouncil structs
///
/// Example XML:
/// ```xml
/// <CouncilCharacter>
///   <COUNCIL_GRAND_VIZIER>12</COUNCIL_GRAND_VIZIER>
///   <COUNCIL_CHANCELLOR>5</COUNCIL_CHANCELLOR>
/// </CouncilCharacter>
/// ```
fn parse_player_council_struct(
    player_node: &roxmltree::Node,
    player_xml_id: i32,
) -> Result<Vec<PlayerCouncil>> {
    let mut council = Vec::new();

    if let Some(council_node) = player_node
        .children()
        .find(|n| n.has_tag_name("CouncilCharacter"))
    {
        for position_node in council_node.children().filter(|n| n.is_element()) {
            let position = position_node.tag_name().name().to_string();
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

            council.push(PlayerCouncil {
                player_xml_id,
                position,
                character_xml_id,
                appointed_turn: None, // Not available in this XML location
            });
        }
    }

    Ok(council)
}

/// Parse ActiveLaw to Law structs
///
/// Example XML:
/// ```xml
/// <ActiveLaw>
///   <LAWCLASS_ORDER>LAW_PRIMOGENITURE</LAWCLASS_ORDER>
///   <LAWCLASS_EPICS_EXPLORATION>LAW_EXPLORATION</LAWCLASS_EPICS_EXPLORATION>
/// </ActiveLaw>
/// ```
fn parse_laws_struct(player_node: &roxmltree::Node, player_xml_id: i32) -> Result<Vec<Law>> {
    let mut laws = Vec::new();

    if let Some(active_law_node) = player_node
        .children()
        .find(|n| n.has_tag_name("ActiveLaw"))
    {
        for law_node in active_law_node.children().filter(|n| n.is_element()) {
            let law_category = law_node.tag_name().name().to_string();
            let law = law_node
                .text()
                .ok_or_else(|| {
                    ParseError::MissingElement(format!("ActiveLaw.{} text content", law_category))
                })?
                .to_string();

            laws.push(Law {
                player_xml_id,
                law_category,
                law,
                adopted_turn: 0, // Placeholder - not available in this XML location
                change_count: 1,  // Placeholder
            });
        }
    }

    Ok(laws)
}

/// Parse GoalList to PlayerGoal structs
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
fn parse_player_goals_struct(
    player_node: &roxmltree::Node,
    player_xml_id: i32,
) -> Result<Vec<PlayerGoal>> {
    let mut goals = Vec::new();

    if let Some(goal_list_node) = player_node
        .children()
        .find(|n| n.has_tag_name("GoalList"))
    {
        for goal_data_node in goal_list_node
            .children()
            .filter(|n| n.has_tag_name("GoalData"))
        {
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
                .map_err(|_| {
                    ParseError::InvalidFormat("GoalData.ID must be an integer".to_string())
                })?;

            let started_turn: i32 = goal_data_node
                .children()
                .find(|n| n.has_tag_name("Turn"))
                .and_then(|n| n.text())
                .ok_or_else(|| ParseError::MissingElement("GoalData.Turn".to_string()))?
                .parse()
                .map_err(|_| {
                    ParseError::InvalidFormat("GoalData.Turn must be an integer".to_string())
                })?;

            // Optional fields
            let leader_character_xml_id: Option<i32> = goal_data_node
                .children()
                .find(|n| n.has_tag_name("LeaderID"))
                .and_then(|n| n.text())
                .and_then(|s| s.parse().ok());

            let max_turns: Option<i32> = goal_data_node
                .children()
                .find(|n| n.has_tag_name("MaxTurns"))
                .and_then(|n| n.text())
                .and_then(|s| s.parse().ok());

            // Check if goal is finished
            let finished = goal_data_node
                .children()
                .any(|n| n.has_tag_name("Finished"));

            let completed_turn: Option<i32> = if finished {
                Some(started_turn) // Use started_turn as placeholder
            } else {
                None
            };

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

            goals.push(PlayerGoal {
                player_xml_id,
                goal_xml_id,
                goal_type,
                leader_character_xml_id,
                started_turn,
                completed_turn,
                failed_turn: None, // Would need to check GoalsFailed or similar
                max_turns,
                progress: 0, // Would need to calculate from Stats
                goal_state,
            });
        }
    }

    Ok(goals)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_player_resources_basic() {
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

        let resources = parse_player_resources_struct(&player_node, 0).unwrap();

        assert_eq!(resources.len(), 2);
        assert_eq!(resources[0].player_xml_id, 0);
        assert_eq!(resources[0].yield_type, "YIELD_CIVICS");
        assert_eq!(resources[0].amount, 15595);
        assert_eq!(resources[1].yield_type, "YIELD_TRAINING");
        assert_eq!(resources[1].amount, 4874);
    }

    #[test]
    fn test_parse_player_resources_empty() {
        let xml = r#"<Root GameId="test">
            <Player ID="0" Name="Test">
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let player_node = doc
            .root_element()
            .children()
            .find(|n| n.has_tag_name("Player"))
            .unwrap();

        let resources = parse_player_resources_struct(&player_node, 0).unwrap();
        assert_eq!(resources.len(), 0);
    }

    #[test]
    fn test_parse_technology_progress_basic() {
        let xml = r#"<Root GameId="test">
            <Player ID="0" Name="Test">
                <TechProgress>
                    <TECH_IRONWORKING>1001</TECH_IRONWORKING>
                    <TECH_STONECUTTING>414</TECH_STONECUTTING>
                </TechProgress>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let player_node = doc
            .root_element()
            .children()
            .find(|n| n.has_tag_name("Player"))
            .unwrap();

        let tech_progress = parse_technology_progress_struct(&player_node, 0).unwrap();

        assert_eq!(tech_progress.len(), 2);
        assert_eq!(tech_progress[0].tech, "TECH_IRONWORKING");
        assert_eq!(tech_progress[0].progress, 1001);
    }

    #[test]
    fn test_parse_technologies_completed_filters_zero() {
        let xml = r#"<Root GameId="test">
            <Player ID="0" Name="Test">
                <TechCount>
                    <TECH_IRONWORKING>1</TECH_IRONWORKING>
                    <TECH_TRAPPING>0</TECH_TRAPPING>
                    <TECH_FORESTRY>1</TECH_FORESTRY>
                </TechCount>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let player_node = doc
            .root_element()
            .children()
            .find(|n| n.has_tag_name("Player"))
            .unwrap();

        let completed = parse_technologies_completed_struct(&player_node, 0).unwrap();

        assert_eq!(completed.len(), 2); // Only count > 0
        assert_eq!(completed[0].tech, "TECH_IRONWORKING");
        assert_eq!(completed[1].tech, "TECH_FORESTRY");
    }

    #[test]
    fn test_parse_technology_states_multiple() {
        let xml = r#"<Root GameId="test">
            <Player ID="0" Name="Test">
                <TechAvailable>
                    <TECH_FORESTRY />
                    <TECH_SAILING />
                </TechAvailable>
                <TechPassed>
                    <TECH_MINING />
                </TechPassed>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let player_node = doc
            .root_element()
            .children()
            .find(|n| n.has_tag_name("Player"))
            .unwrap();

        let states = parse_technology_states_struct(&player_node, 0).unwrap();

        assert_eq!(states.len(), 3);
        assert_eq!(states[0].state, "available");
        assert_eq!(states[0].tech, "TECH_FORESTRY");
        assert_eq!(states[2].state, "passed");
        assert_eq!(states[2].tech, "TECH_MINING");
    }

    #[test]
    fn test_parse_player_council_basic() {
        let xml = r#"<Root GameId="test">
            <Player ID="0" Name="Test">
                <CouncilCharacter>
                    <COUNCIL_GRAND_VIZIER>12</COUNCIL_GRAND_VIZIER>
                    <COUNCIL_CHANCELLOR>5</COUNCIL_CHANCELLOR>
                </CouncilCharacter>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let player_node = doc
            .root_element()
            .children()
            .find(|n| n.has_tag_name("Player"))
            .unwrap();

        let council = parse_player_council_struct(&player_node, 0).unwrap();

        assert_eq!(council.len(), 2);
        assert_eq!(council[0].position, "COUNCIL_GRAND_VIZIER");
        assert_eq!(council[0].character_xml_id, 12);
    }

    #[test]
    fn test_parse_laws_basic() {
        let xml = r#"<Root GameId="test">
            <Player ID="0" Name="Test">
                <ActiveLaw>
                    <LAWCLASS_ORDER>LAW_PRIMOGENITURE</LAWCLASS_ORDER>
                    <LAWCLASS_EPICS_EXPLORATION>LAW_EXPLORATION</LAWCLASS_EPICS_EXPLORATION>
                </ActiveLaw>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let player_node = doc
            .root_element()
            .children()
            .find(|n| n.has_tag_name("Player"))
            .unwrap();

        let laws = parse_laws_struct(&player_node, 0).unwrap();

        assert_eq!(laws.len(), 2);
        assert_eq!(laws[0].law_category, "LAWCLASS_ORDER");
        assert_eq!(laws[0].law, "LAW_PRIMOGENITURE");
    }

    #[test]
    fn test_parse_player_goals_basic() {
        let xml = r#"<Root GameId="test">
            <Player ID="0" Name="Test">
                <GoalList>
                    <GoalData>
                        <Type>GOAL_SIX_TECHS</Type>
                        <ID>0</ID>
                        <LeaderID>4</LeaderID>
                        <Turn>37</Turn>
                        <MaxTurns>20</MaxTurns>
                    </GoalData>
                </GoalList>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let player_node = doc
            .root_element()
            .children()
            .find(|n| n.has_tag_name("Player"))
            .unwrap();

        let goals = parse_player_goals_struct(&player_node, 0).unwrap();

        assert_eq!(goals.len(), 1);
        assert_eq!(goals[0].goal_type, "GOAL_SIX_TECHS");
        assert_eq!(goals[0].goal_xml_id, 0);
        assert_eq!(goals[0].leader_character_xml_id, Some(4));
        assert_eq!(goals[0].started_turn, 37);
        assert_eq!(goals[0].max_turns, Some(20));
    }

    #[test]
    fn test_parse_player_goals_with_stats() {
        let xml = r#"<Root GameId="test">
            <Player ID="0" Name="Test">
                <GoalList>
                    <GoalData>
                        <Type>GOAL_SIX_TECHS</Type>
                        <ID>0</ID>
                        <Turn>37</Turn>
                        <Stats>
                            <STAT_TECH_DISCOVERED>5</STAT_TECH_DISCOVERED>
                        </Stats>
                    </GoalData>
                </GoalList>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let player_node = doc
            .root_element()
            .children()
            .find(|n| n.has_tag_name("Player"))
            .unwrap();

        let goals = parse_player_goals_struct(&player_node, 0).unwrap();

        assert_eq!(goals.len(), 1);
        assert!(goals[0].goal_state.is_some());
        let state: serde_json::Value =
            serde_json::from_str(goals[0].goal_state.as_ref().unwrap()).unwrap();
        assert_eq!(state["STAT_TECH_DISCOVERED"], "5");
    }
}
