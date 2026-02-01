// Time-series data parsers - pure parsing (no DB dependency)
//
// Parses sparse time-series historical data from XML into typed structs.
// This module handles both game-level and player-level time-series data.

use crate::parser::game_data::{
    FamilyOpinionHistory, LegitimacyHistory, MilitaryPowerHistory, PointsHistory,
    ReligionOpinionHistory, YieldPriceHistory, YieldRateHistory, YieldTotalHistory,
};
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};
use roxmltree::Node;

/// Parse sparse time-series data from a parent element
///
/// Returns vector of (turn, value) tuples
fn parse_sparse_history(parent_node: &Node, element_name: &str) -> Result<Vec<(i32, i32)>> {
    let mut data = Vec::new();

    if let Some(history_node) = parent_node
        .children()
        .find(|n| n.has_tag_name(element_name))
    {
        for turn_node in history_node.children().filter(|n| n.is_element()) {
            let turn_tag = turn_node.tag_name().name();
            if !turn_tag.starts_with('T') {
                continue;
            }

            let turn: i32 = turn_tag[1..]
                .parse()
                .map_err(|_| ParseError::InvalidFormat(format!("Invalid turn tag: {}", turn_tag)))?;

            let value: i32 = turn_node
                .text()
                .ok_or_else(|| {
                    ParseError::MissingElement(format!("{}.<{}>", element_name, turn_tag))
                })?
                .parse()
                .map_err(|_| ParseError::InvalidFormat(format!("Invalid integer in {}", turn_tag)))?;

            data.push((turn, value));
        }
    }

    Ok(data)
}

/// Parse sparse time-series data with nested type categories
///
/// Returns vector of (type_name, turn, value) tuples
fn parse_sparse_history_by_type(
    parent_node: &Node,
    element_name: &str,
) -> Result<Vec<(String, i32, i32)>> {
    let mut data = Vec::new();

    if let Some(history_node) = parent_node
        .children()
        .find(|n| n.has_tag_name(element_name))
    {
        for type_node in history_node.children().filter(|n| n.is_element()) {
            let type_name = type_node.tag_name().name().to_string();

            for turn_node in type_node.children().filter(|n| n.is_element()) {
                let turn_tag = turn_node.tag_name().name();
                if !turn_tag.starts_with('T') {
                    continue;
                }

                let turn: i32 = turn_tag[1..].parse().map_err(|_| {
                    ParseError::InvalidFormat(format!("Invalid turn tag: {}", turn_tag))
                })?;

                let value: i32 = turn_node
                    .text()
                    .ok_or_else(|| {
                        ParseError::MissingElement(format!("{}.{}", element_name, turn_tag))
                    })?
                    .parse()
                    .map_err(|_| {
                        ParseError::InvalidFormat(format!("Invalid integer in {}", turn_tag))
                    })?;

                data.push((type_name.clone(), turn, value));
            }
        }
    }

    Ok(data)
}

/// Parse game-level yield price history from <Game> element
pub fn parse_yield_price_history_struct(doc: &XmlDocument) -> Result<Vec<YieldPriceHistory>> {
    let root = doc.root_element();
    let game_node = root
        .children()
        .find(|n| n.has_tag_name("Game"))
        .ok_or_else(|| ParseError::MissingElement("Game".to_string()))?;

    let data = parse_sparse_history_by_type(&game_node, "YieldPriceHistory")?;

    Ok(data
        .into_iter()
        .map(|(yield_type, turn, price)| YieldPriceHistory {
            turn,
            yield_type,
            price,
        })
        .collect())
}

/// Parse all player-level time-series data from Player elements
///
/// This is an orchestrator function that parses all time-series types for all players
pub fn parse_all_player_timeseries(
    doc: &XmlDocument,
) -> Result<(
    Vec<MilitaryPowerHistory>,
    Vec<PointsHistory>,
    Vec<LegitimacyHistory>,
    Vec<YieldRateHistory>,
    Vec<YieldTotalHistory>,
    Vec<FamilyOpinionHistory>,
    Vec<ReligionOpinionHistory>,
)> {
    let root = doc.root_element();

    let mut military_power = Vec::new();
    let mut points = Vec::new();
    let mut legitimacy = Vec::new();
    let mut yield_rates = Vec::new();
    let mut yield_totals = Vec::new();
    let mut family_opinions = Vec::new();
    let mut religion_opinions = Vec::new();

    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let player_xml_id: i32 = player_node.req_attr("ID")?.parse()?;

        // Parse military power history
        for (turn, value) in parse_sparse_history(&player_node, "MilitaryPowerHistory")? {
            military_power.push(MilitaryPowerHistory {
                player_xml_id,
                turn,
                military_power: value,
            });
        }

        // Parse points history
        for (turn, value) in parse_sparse_history(&player_node, "PointsHistory")? {
            points.push(PointsHistory {
                player_xml_id,
                turn,
                points: value,
            });
        }

        // Parse legitimacy history
        for (turn, value) in parse_sparse_history(&player_node, "LegitimacyHistory")? {
            legitimacy.push(LegitimacyHistory {
                player_xml_id,
                turn,
                legitimacy: value,
            });
        }

        // Parse yield rate history (per-yield type)
        for (yield_type, turn, amount) in
            parse_sparse_history_by_type(&player_node, "YieldRateHistory")?
        {
            yield_rates.push(YieldRateHistory {
                player_xml_id,
                turn,
                yield_type,
                amount,
            });
        }

        // Parse yield total history (per-yield type) - more accurate cumulative totals
        // Available in game version 1.0.81366+ (January 2026)
        for (yield_type, turn, amount) in
            parse_sparse_history_by_type(&player_node, "YieldTotalHistory")?
        {
            yield_totals.push(YieldTotalHistory {
                player_xml_id,
                turn,
                yield_type,
                amount,
            });
        }

        // Parse family opinion history (per-family)
        for (family_name, turn, opinion) in
            parse_sparse_history_by_type(&player_node, "FamilyOpinionHistory")?
        {
            family_opinions.push(FamilyOpinionHistory {
                player_xml_id,
                family_name,
                turn,
                opinion,
            });
        }

        // Parse religion opinion history (per-religion)
        for (religion_name, turn, opinion) in
            parse_sparse_history_by_type(&player_node, "ReligionOpinionHistory")?
        {
            religion_opinions.push(ReligionOpinionHistory {
                player_xml_id,
                religion_name,
                turn,
                opinion,
            });
        }
    }

    Ok((
        military_power,
        points,
        legitimacy,
        yield_rates,
        yield_totals,
        family_opinions,
        religion_opinions,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_sparse_history() {
        let xml = r#"<Root>
            <Player ID="0">
                <MilitaryPowerHistory>
                    <T2>40</T2>
                    <T5>55</T5>
                    <T18>120</T18>
                </MilitaryPowerHistory>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let root = doc.root_element();
        let player_node = root.children().find(|n| n.has_tag_name("Player")).unwrap();

        let data = parse_sparse_history(&player_node, "MilitaryPowerHistory").unwrap();
        assert_eq!(data.len(), 3);
        assert_eq!(data[0], (2, 40));
        assert_eq!(data[1], (5, 55));
        assert_eq!(data[2], (18, 120));
    }

    #[test]
    fn test_parse_sparse_history_by_type() {
        let xml = r#"<Root>
            <Player ID="0">
                <YieldRateHistory>
                    <YIELD_GROWTH>
                        <T2>10</T2>
                        <T5>15</T5>
                    </YIELD_GROWTH>
                    <YIELD_CIVICS>
                        <T2>5</T2>
                    </YIELD_CIVICS>
                </YieldRateHistory>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let root = doc.root_element();
        let player_node = root.children().find(|n| n.has_tag_name("Player")).unwrap();

        let data = parse_sparse_history_by_type(&player_node, "YieldRateHistory").unwrap();
        assert_eq!(data.len(), 3);
        assert_eq!(data[0], ("YIELD_GROWTH".to_string(), 2, 10));
        assert_eq!(data[1], ("YIELD_GROWTH".to_string(), 5, 15));
        assert_eq!(data[2], ("YIELD_CIVICS".to_string(), 2, 5));
    }

    #[test]
    fn test_parse_sparse_history_missing_element() {
        let xml = r#"<Root>
            <Player ID="0">
                <YieldStockpile>
                    <YIELD_CIVICS>100</YIELD_CIVICS>
                </YieldStockpile>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let root = doc.root_element();
        let player_node = root.children().find(|n| n.has_tag_name("Player")).unwrap();

        let data = parse_sparse_history(&player_node, "MilitaryPowerHistory").unwrap();
        assert_eq!(data.len(), 0);
    }

    #[test]
    fn test_parse_yield_price_history_struct() {
        let xml = r#"<Root>
            <Game>
                <YieldPriceHistory>
                    <YIELD_GROWTH>
                        <T2>0</T2>
                        <T5>50</T5>
                    </YIELD_GROWTH>
                    <YIELD_CIVICS>
                        <T2>0</T2>
                    </YIELD_CIVICS>
                </YieldPriceHistory>
            </Game>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let history = parse_yield_price_history_struct(&doc).unwrap();

        assert_eq!(history.len(), 3);
        assert_eq!(history[0].yield_type, "YIELD_GROWTH");
        assert_eq!(history[0].turn, 2);
        assert_eq!(history[0].price, 0);
        assert_eq!(history[1].yield_type, "YIELD_GROWTH");
        assert_eq!(history[1].turn, 5);
        assert_eq!(history[1].price, 50);
    }

    #[test]
    fn test_parse_all_player_timeseries() {
        let xml = r#"<Root>
            <Player ID="0">
                <MilitaryPowerHistory>
                    <T2>40</T2>
                </MilitaryPowerHistory>
                <PointsHistory>
                    <T2>100</T2>
                </PointsHistory>
            </Player>
            <Player ID="1">
                <LegitimacyHistory>
                    <T2>95</T2>
                </LegitimacyHistory>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let (military, points, legitimacy, _, _, _, _) = parse_all_player_timeseries(&doc).unwrap();

        assert_eq!(military.len(), 1);
        assert_eq!(military[0].player_xml_id, 0);
        assert_eq!(military[0].turn, 2);
        assert_eq!(military[0].military_power, 40);

        assert_eq!(points.len(), 1);
        assert_eq!(points[0].player_xml_id, 0);
        assert_eq!(points[0].points, 100);

        assert_eq!(legitimacy.len(), 1);
        assert_eq!(legitimacy[0].player_xml_id, 1);
        assert_eq!(legitimacy[0].legitimacy, 95);
    }

    #[test]
    fn test_parse_all_player_timeseries_empty() {
        let xml = r#"<Root>
            <Player ID="0">
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let (military, points, legitimacy, yields, yield_totals, families, religions) =
            parse_all_player_timeseries(&doc).unwrap();

        assert_eq!(military.len(), 0);
        assert_eq!(points.len(), 0);
        assert_eq!(legitimacy.len(), 0);
        assert_eq!(yields.len(), 0);
        assert_eq!(yield_totals.len(), 0);
        assert_eq!(families.len(), 0);
        assert_eq!(religions.len(), 0);
    }

    #[test]
    fn test_parse_yield_total_history() {
        let xml = r#"<Root>
            <Player ID="0">
                <YieldTotalHistory>
                    <YIELD_GROWTH>
                        <T2>144</T2>
                        <T5>432</T5>
                    </YIELD_GROWTH>
                    <YIELD_SCIENCE>
                        <T2>50</T2>
                    </YIELD_SCIENCE>
                </YieldTotalHistory>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let (_, _, _, _, yield_totals, _, _) = parse_all_player_timeseries(&doc).unwrap();

        assert_eq!(yield_totals.len(), 3);
        assert_eq!(yield_totals[0].player_xml_id, 0);
        assert_eq!(yield_totals[0].yield_type, "YIELD_GROWTH");
        assert_eq!(yield_totals[0].turn, 2);
        assert_eq!(yield_totals[0].amount, 144);
        assert_eq!(yield_totals[1].yield_type, "YIELD_GROWTH");
        assert_eq!(yield_totals[1].turn, 5);
        assert_eq!(yield_totals[1].amount, 432);
        assert_eq!(yield_totals[2].yield_type, "YIELD_SCIENCE");
        assert_eq!(yield_totals[2].turn, 2);
        assert_eq!(yield_totals[2].amount, 50);
    }

    #[test]
    fn test_parse_yield_total_history_missing() {
        // Old save files won't have YieldTotalHistory
        let xml = r#"<Root>
            <Player ID="0">
                <YieldRateHistory>
                    <YIELD_GROWTH>
                        <T2>10</T2>
                    </YIELD_GROWTH>
                </YieldRateHistory>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let (_, _, _, yield_rates, yield_totals, _, _) = parse_all_player_timeseries(&doc).unwrap();

        // yield_totals should be empty for old saves
        assert_eq!(yield_totals.len(), 0);
        // yield_rates should still work
        assert_eq!(yield_rates.len(), 1);
    }
}
