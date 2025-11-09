// City extended data parsers
//
// Parses city-specific nested data (production queue, yields, culture, religions)
// from XML to intermediate structs (no database dependency).

use crate::parser::game_data::{
    CityCulture, CityProductionItem, CityProjectCompleted, CityReligion, CityYield,
};
use crate::parser::xml_loader::XmlDocument;
use crate::parser::{ParseError, Result};
use std::collections::HashMap;

/// Parse city production queue for all cities
pub fn parse_city_production_queue_struct(doc: &XmlDocument) -> Result<Vec<CityProductionItem>> {
    let root = doc.root_element();
    let mut items = Vec::new();

    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_xml_id: i32 = city_node
            .attribute("ID")
            .ok_or_else(|| ParseError::MissingAttribute("City.ID".to_string()))?
            .parse()?;

        if let Some(queue_node) = city_node.children().find(|n| n.has_tag_name("BuildQueue")) {
            let mut queue_position = 0;

            for queue_info_node in queue_node.children().filter(|n| n.has_tag_name("QueueInfo")) {
                let build_type = queue_info_node
                    .children()
                    .find(|n| n.has_tag_name("Build"))
                    .and_then(|n| n.text())
                    .ok_or_else(|| ParseError::MissingElement("QueueInfo.Build".to_string()))?
                    .to_string();

                let item_type = queue_info_node
                    .children()
                    .find(|n| n.has_tag_name("Type"))
                    .and_then(|n| n.text())
                    .ok_or_else(|| ParseError::MissingElement("QueueInfo.Type".to_string()))?
                    .to_string();

                let progress: i32 = queue_info_node
                    .children()
                    .find(|n| n.has_tag_name("Progress"))
                    .and_then(|n| n.text())
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);

                let is_repeat: bool = queue_info_node
                    .children()
                    .find(|n| n.has_tag_name("IsRepeat"))
                    .and_then(|n| n.text())
                    .and_then(|s| s.parse::<i32>().ok())
                    .map(|v| v != 0)
                    .unwrap_or(false);

                items.push(CityProductionItem {
                    city_xml_id,
                    queue_position,
                    build_type,
                    item_type,
                    progress,
                    is_repeat,
                });

                queue_position += 1;
            }
        }
    }

    Ok(items)
}

/// Parse city completed builds for all cities (aggregated by type)
pub fn parse_city_projects_completed_struct(
    doc: &XmlDocument,
) -> Result<Vec<CityProjectCompleted>> {
    let root = doc.root_element();
    let mut results = Vec::new();

    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_xml_id: i32 = city_node
            .attribute("ID")
            .ok_or_else(|| ParseError::MissingAttribute("City.ID".to_string()))?
            .parse()?;

        let mut counts: HashMap<String, i32> = HashMap::new();

        if let Some(completed_node) = city_node
            .children()
            .find(|n| n.has_tag_name("CompletedBuild"))
        {
            for queue_info_node in completed_node
                .children()
                .filter(|n| n.has_tag_name("QueueInfo"))
            {
                let build_type = queue_info_node
                    .children()
                    .find(|n| n.has_tag_name("Build"))
                    .and_then(|n| n.text())
                    .unwrap_or("UNKNOWN");

                let item_type = queue_info_node
                    .children()
                    .find(|n| n.has_tag_name("Type"))
                    .and_then(|n| n.text())
                    .unwrap_or("UNKNOWN");

                let project_type = format!("{}.{}", build_type, item_type);
                *counts.entry(project_type).or_insert(0) += 1;
            }
        }

        for (project_type, count) in counts {
            results.push(CityProjectCompleted {
                city_xml_id,
                project_type,
                count,
            });
        }
    }

    Ok(results)
}

/// Parse city yields for all cities
pub fn parse_city_yields_struct(doc: &XmlDocument) -> Result<Vec<CityYield>> {
    let root = doc.root_element();
    let mut yields = Vec::new();

    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_xml_id: i32 = city_node
            .attribute("ID")
            .ok_or_else(|| ParseError::MissingAttribute("City.ID".to_string()))?
            .parse()?;

        if let Some(yield_node) = city_node
            .children()
            .find(|n| n.has_tag_name("YieldProgress"))
        {
            for yield_elem in yield_node.children().filter(|n| n.is_element()) {
                let yield_type = yield_elem.tag_name().name().to_string();
                let progress: i32 = yield_elem.text().and_then(|s| s.parse().ok()).unwrap_or(0);

                yields.push(CityYield {
                    city_xml_id,
                    yield_type,
                    progress,
                });
            }
        }
    }

    Ok(yields)
}

/// Parse city religions for all cities
pub fn parse_city_religions_struct(doc: &XmlDocument) -> Result<Vec<CityReligion>> {
    let root = doc.root_element();
    let mut religions = Vec::new();

    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_xml_id: i32 = city_node
            .attribute("ID")
            .ok_or_else(|| ParseError::MissingAttribute("City.ID".to_string()))?
            .parse()?;

        if let Some(religion_node) = city_node.children().find(|n| n.has_tag_name("Religion")) {
            for religion_elem in religion_node.children().filter(|n| n.is_element()) {
                let religion = religion_elem.tag_name().name().to_string();

                religions.push(CityReligion {
                    city_xml_id,
                    religion,
                });
            }
        }
    }

    Ok(religions)
}

/// Parse city culture and happiness for all cities
pub fn parse_city_culture_struct(doc: &XmlDocument) -> Result<Vec<CityCulture>> {
    let root = doc.root_element();
    let mut results = Vec::new();

    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_xml_id: i32 = city_node
            .attribute("ID")
            .ok_or_else(|| ParseError::MissingAttribute("City.ID".to_string()))?
            .parse()?;

        let team_culture = if let Some(culture_node) =
            city_node.children().find(|n| n.has_tag_name("TeamCulture"))
        {
            culture_node
                .children()
                .filter(|n| n.is_element())
                .filter_map(|team_node| {
                    let team_tag = team_node.tag_name().name();
                    let team_id: i32 = team_tag.strip_prefix("T.")?.parse().ok()?;
                    let culture: i32 = team_node.text()?.parse().ok()?;
                    Some((team_id, culture))
                })
                .collect::<HashMap<i32, i32>>()
        } else {
            HashMap::new()
        };

        let team_happiness = if let Some(happiness_node) = city_node
            .children()
            .find(|n| n.has_tag_name("TeamHappinessLevel"))
        {
            happiness_node
                .children()
                .filter(|n| n.is_element())
                .filter_map(|team_node| {
                    let team_tag = team_node.tag_name().name();
                    let team_id: i32 = team_tag.strip_prefix("T.")?.parse().ok()?;
                    let happiness: i32 = team_node.text()?.parse().ok()?;
                    Some((team_id, happiness))
                })
                .collect::<HashMap<i32, i32>>()
        } else {
            HashMap::new()
        };

        let mut all_teams = std::collections::HashSet::new();
        all_teams.extend(team_culture.keys());
        all_teams.extend(team_happiness.keys());

        for &team_id in &all_teams {
            let culture_level = team_culture.get(&team_id).copied().unwrap_or(0);
            let happiness_level = team_happiness.get(&team_id).copied().unwrap_or(0);

            results.push(CityCulture {
                city_xml_id,
                team_id,
                culture_level,
                happiness_level,
            });
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_city_production_queue_basic() {
        let xml = r#"<Root>
            <City ID="0">
                <BuildQueue>
                    <QueueInfo>
                        <Build>BUILD_UNIT</Build>
                        <Type>UNIT_WORKER</Type>
                        <Progress>200</Progress>
                        <IsRepeat>1</IsRepeat>
                    </QueueInfo>
                    <QueueInfo>
                        <Build>BUILD_IMPROVEMENT</Build>
                        <Type>IMPROVEMENT_FARM</Type>
                        <Progress>50</Progress>
                    </QueueInfo>
                </BuildQueue>
            </City>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let items = parse_city_production_queue_struct(&doc).unwrap();

        assert_eq!(items.len(), 2);
        assert_eq!(items[0].city_xml_id, 0);
        assert_eq!(items[0].queue_position, 0);
        assert_eq!(items[0].build_type, "BUILD_UNIT");
        assert_eq!(items[0].item_type, "UNIT_WORKER");
        assert_eq!(items[0].progress, 200);
        assert_eq!(items[0].is_repeat, true);

        assert_eq!(items[1].queue_position, 1);
        assert_eq!(items[1].is_repeat, false);
    }

    #[test]
    fn test_parse_city_production_queue_empty() {
        let xml = r#"<Root><City ID="0"></City></Root>"#;
        let doc = parse_xml(xml.to_string()).unwrap();
        let items = parse_city_production_queue_struct(&doc).unwrap();
        assert_eq!(items.len(), 0);
    }

    #[test]
    fn test_parse_city_projects_completed_basic() {
        let xml = r#"<Root>
            <City ID="0">
                <CompletedBuild>
                    <QueueInfo>
                        <Build>BUILD_PROJECT</Build>
                        <Type>PROJECT_REPAIR</Type>
                    </QueueInfo>
                    <QueueInfo>
                        <Build>BUILD_PROJECT</Build>
                        <Type>PROJECT_REPAIR</Type>
                    </QueueInfo>
                </CompletedBuild>
            </City>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let items = parse_city_projects_completed_struct(&doc).unwrap();

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].city_xml_id, 0);
        assert_eq!(items[0].project_type, "BUILD_PROJECT.PROJECT_REPAIR");
        assert_eq!(items[0].count, 2);
    }

    #[test]
    fn test_parse_city_yields_basic() {
        let xml = r#"<Root>
            <City ID="0">
                <YieldProgress>
                    <YIELD_GROWTH>380</YIELD_GROWTH>
                    <YIELD_CULTURE>4918</YIELD_CULTURE>
                </YieldProgress>
            </City>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let yields = parse_city_yields_struct(&doc).unwrap();

        assert_eq!(yields.len(), 2);
        assert_eq!(yields[0].city_xml_id, 0);
        assert_eq!(yields[0].yield_type, "YIELD_GROWTH");
        assert_eq!(yields[0].progress, 380);
    }

    #[test]
    fn test_parse_city_religions_basic() {
        let xml = r#"<Root>
            <City ID="0">
                <Religion>
                    <RELIGION_PAGAN_CARTHAGE/>
                    <RELIGION_JUDAISM/>
                </Religion>
            </City>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let religions = parse_city_religions_struct(&doc).unwrap();

        assert_eq!(religions.len(), 2);
        assert_eq!(religions[0].city_xml_id, 0);
        assert_eq!(religions[0].religion, "RELIGION_PAGAN_CARTHAGE");
    }

    #[test]
    fn test_parse_city_culture_basic() {
        let xml = r#"<Root>
            <City ID="0">
                <TeamCulture>
                    <T.0>5</T.0>
                    <T.1>2</T.1>
                </TeamCulture>
                <TeamHappinessLevel>
                    <T.0>3</T.0>
                </TeamHappinessLevel>
            </City>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let culture = parse_city_culture_struct(&doc).unwrap();

        assert_eq!(culture.len(), 2);
        assert!(culture.iter().any(|c| c.team_id == 0
            && c.culture_level == 5
            && c.happiness_level == 3));
        assert!(culture.iter().any(|c| c.team_id == 1
            && c.culture_level == 2
            && c.happiness_level == 0));
    }

    #[test]
    fn test_parse_city_culture_empty() {
        let xml = r#"<Root><City ID="0"></City></Root>"#;
        let doc = parse_xml(xml.to_string()).unwrap();
        let culture = parse_city_culture_struct(&doc).unwrap();
        assert_eq!(culture.len(), 0);
    }
}
