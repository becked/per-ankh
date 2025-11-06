// City extended data parsers
//
// This module handles parsing of city-specific nested data:
// - Production queue (BuildQueue) -> city_production_queue table
// - Completed builds (CompletedBuild) -> city_projects_completed table
//
// XML Structure:
// ```xml
// <City ID="0">
//   <BuildQueue>
//     <QueueInfo>
//       <Build>BUILD_UNIT</Build>
//       <Type>UNIT_WORKER</Type>
//       <Progress>200</Progress>
//       <IsRepeat>1</IsRepeat>
//     </QueueInfo>
//     <QueueInfo>
//       <Build>BUILD_IMPROVEMENT</Build>
//       <Type>IMPROVEMENT_FARM</Type>
//       <Progress>50</Progress>
//     </QueueInfo>
//   </BuildQueue>
//   <CompletedBuild>
//     <QueueInfo>
//       <Build>BUILD_PROJECT</Build>
//       <Type>PROJECT_REPAIR</Type>
//     </QueueInfo>
//   </CompletedBuild>
// </City>
// ```

use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};
use roxmltree::Node;

/// Parse city production queue (BuildQueue element)
///
/// Each QueueInfo represents an item in the city's production queue.
///
/// # Schema
/// ```sql
/// CREATE TABLE city_production_queue (
///     queue_id BIGINT NOT NULL PRIMARY KEY,
///     city_id INTEGER NOT NULL,
///     match_id BIGINT NOT NULL,
///     queue_position INTEGER NOT NULL,
///     build_type VARCHAR NOT NULL,
///     item_type VARCHAR NOT NULL,
///     progress INTEGER DEFAULT 0,
///     is_repeat BOOLEAN DEFAULT false,
///     yield_costs VARCHAR
/// );
/// ```
pub fn parse_city_production_queue(
    city_node: &Node,
    conn: &Connection,
    city_id: i64,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

    if let Some(queue_node) = city_node
        .children()
        .find(|n| n.has_tag_name("BuildQueue"))
    {
        let mut queue_position = 0;

        for queue_info_node in queue_node
            .children()
            .filter(|n| n.has_tag_name("QueueInfo"))
        {
            // Parse build type (BUILD_UNIT, BUILD_IMPROVEMENT, BUILD_PROJECT)
            let build_type = queue_info_node
                .children()
                .find(|n| n.has_tag_name("Build"))
                .and_then(|n| n.text())
                .ok_or_else(|| ParseError::MissingElement("QueueInfo.Build".to_string()))?;

            // Parse item type (specific unit/improvement/project)
            let item_type = queue_info_node
                .children()
                .find(|n| n.has_tag_name("Type"))
                .and_then(|n| n.text())
                .ok_or_else(|| ParseError::MissingElement("QueueInfo.Type".to_string()))?;

            // Parse progress (optional, default 0)
            let progress: i32 = queue_info_node
                .children()
                .find(|n| n.has_tag_name("Progress"))
                .and_then(|n| n.text())
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);

            // Parse is_repeat (optional, default false)
            // XML uses 0/1, we convert to boolean
            let is_repeat: bool = queue_info_node
                .children()
                .find(|n| n.has_tag_name("IsRepeat"))
                .and_then(|n| n.text())
                .and_then(|s| s.parse::<i32>().ok())
                .map(|v| v != 0)
                .unwrap_or(false);

            // Generate unique queue_id (match_id + city_id + position)
            // This is deterministic and collision-free within a match
            let queue_id = (match_id * 1_000_000) + (city_id * 1000) + queue_position as i64;

            conn.execute(
                "INSERT INTO city_production_queue
                 (queue_id, city_id, match_id, queue_position, build_type, item_type,
                  progress, is_repeat, yield_costs)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
                params![
                    queue_id,
                    city_id,
                    match_id,
                    queue_position,
                    build_type,
                    item_type,
                    progress,
                    is_repeat
                ],
            )?;

            count += 1;
            queue_position += 1;
        }
    }

    Ok(count)
}

/// Parse city completed builds (CompletedBuild element)
///
/// Stores aggregate counts of completed builds by type.
/// This is different from city_projects_completed table which tracks project counts,
/// but follows similar pattern.
///
/// # Schema
/// ```sql
/// CREATE TABLE city_projects_completed (
///     city_id INTEGER NOT NULL,
///     match_id BIGINT NOT NULL,
///     project_type VARCHAR NOT NULL,
///     count INTEGER NOT NULL,
///     PRIMARY KEY (city_id, match_id, project_type)
/// );
/// ```
///
/// Note: This aggregates all completed items of same type into counts
pub fn parse_city_completed_builds(
    city_node: &Node,
    conn: &Connection,
    city_id: i64,
    match_id: i64,
) -> Result<usize> {
    let mut counts = std::collections::HashMap::new();

    if let Some(completed_node) = city_node
        .children()
        .find(|n| n.has_tag_name("CompletedBuild"))
    {
        for queue_info_node in completed_node
            .children()
            .filter(|n| n.has_tag_name("QueueInfo"))
        {
            // Parse build type
            let build_type = queue_info_node
                .children()
                .find(|n| n.has_tag_name("Build"))
                .and_then(|n| n.text())
                .unwrap_or("UNKNOWN");

            // Parse item type
            let item_type = queue_info_node
                .children()
                .find(|n| n.has_tag_name("Type"))
                .and_then(|n| n.text())
                .unwrap_or("UNKNOWN");

            // Create composite key (build_type.item_type)
            let project_type = format!("{}.{}", build_type, item_type);

            *counts.entry(project_type).or_insert(0) += 1;
        }
    }

    // Insert aggregated counts
    let mut inserted = 0;
    for (project_type, count) in counts {
        conn.execute(
            "INSERT INTO city_projects_completed (city_id, match_id, project_type, count)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (city_id, match_id, project_type)
             DO UPDATE SET count = excluded.count",
            params![city_id, match_id, project_type, count],
        )?;
        inserted += 1;
    }

    Ok(inserted)
}

/// Parse city culture and happiness per team
///
/// # XML Structure
/// ```xml
/// <City ID="0">
///   <TeamCulture>
///     <TEAM_0>5</TEAM_0>
///     <TEAM_1>2</TEAM_1>
///   </TeamCulture>
///   <TeamHappinessLevel>
///     <TEAM_0>3</TEAM_0>
///   </TeamHappinessLevel>
/// </City>
/// ```
///
/// # Schema
/// ```sql
/// CREATE TABLE city_culture (
///     city_id INTEGER NOT NULL,
///     match_id BIGINT NOT NULL,
///     team_id INTEGER NOT NULL,
///     culture_level INTEGER DEFAULT 0,
///     happiness_level INTEGER DEFAULT 0,
///     PRIMARY KEY (city_id, match_id, team_id)
/// );
/// ```
pub fn parse_city_culture_happiness(
    city_node: &Node,
    conn: &Connection,
    city_id: i64,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

    // Parse TeamCulture
    let team_culture = if let Some(culture_node) = city_node
        .children()
        .find(|n| n.has_tag_name("TeamCulture"))
    {
        culture_node
            .children()
            .filter(|n| n.is_element())
            .filter_map(|team_node| {
                let team_tag = team_node.tag_name().name(); // "TEAM_0"
                let team_id: i32 = team_tag.strip_prefix("TEAM_")?.parse().ok()?;
                let culture: i32 = team_node.text()?.parse().ok()?;
                Some((team_id, culture))
            })
            .collect::<std::collections::HashMap<i32, i32>>()
    } else {
        std::collections::HashMap::new()
    };

    // Parse TeamHappinessLevel
    let team_happiness = if let Some(happiness_node) = city_node
        .children()
        .find(|n| n.has_tag_name("TeamHappinessLevel"))
    {
        happiness_node
            .children()
            .filter(|n| n.is_element())
            .filter_map(|team_node| {
                let team_tag = team_node.tag_name().name(); // "TEAM_0"
                let team_id: i32 = team_tag.strip_prefix("TEAM_")?.parse().ok()?;
                let happiness: i32 = team_node.text()?.parse().ok()?;
                Some((team_id, happiness))
            })
            .collect::<std::collections::HashMap<i32, i32>>()
    } else {
        std::collections::HashMap::new()
    };

    // Combine and insert records for all teams that have either culture or happiness
    let mut all_teams = std::collections::HashSet::new();
    all_teams.extend(team_culture.keys());
    all_teams.extend(team_happiness.keys());

    for &team_id in &all_teams {
        let culture_level = team_culture.get(&team_id).copied().unwrap_or(0);
        let happiness_level = team_happiness.get(&team_id).copied().unwrap_or(0);

        conn.execute(
            "INSERT INTO city_culture
             (city_id, match_id, team_id, culture_level, culture_progress, happiness_level)
             VALUES (?, ?, ?, ?, 0, ?)
             ON CONFLICT (city_id, match_id, team_id)
             DO UPDATE SET
                 culture_level = excluded.culture_level,
                 happiness_level = excluded.happiness_level",
            params![city_id, match_id, team_id, culture_level, happiness_level],
        )?;
        count += 1;
    }

    Ok(count)
}

/// Parse all city extended data for a single city
///
/// This is a convenience function that calls all city data parsers.
pub fn parse_city_extended_data(
    city_node: &Node,
    conn: &Connection,
    city_id: i64,
    match_id: i64,
) -> Result<(usize, usize, usize)> {
    let queue_count = parse_city_production_queue(city_node, conn, city_id, match_id)?;
    let completed_count = parse_city_completed_builds(city_node, conn, city_id, match_id)?;
    let culture_count = parse_city_culture_happiness(city_node, conn, city_id, match_id)?;

    Ok((queue_count, completed_count, culture_count))
}

#[cfg(test)]
mod tests {
    use super::*;
    use roxmltree::Document;

    #[test]
    fn test_parse_city_production_queue_structure() {
        let xml = r#"
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
        "#;

        let doc = Document::parse(xml).unwrap();
        let city_node = doc.root_element();

        let queue = city_node
            .children()
            .find(|n| n.has_tag_name("BuildQueue"))
            .unwrap();

        let queue_items: Vec<_> = queue
            .children()
            .filter(|n| n.has_tag_name("QueueInfo"))
            .collect();

        assert_eq!(queue_items.len(), 2);

        // Verify first item
        let first_item = queue_items[0];
        let build_type = first_item
            .children()
            .find(|n| n.has_tag_name("Build"))
            .unwrap()
            .text()
            .unwrap();
        assert_eq!(build_type, "BUILD_UNIT");
    }

    #[test]
    fn test_parse_city_completed_builds_structure() {
        let xml = r#"
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
        "#;

        let doc = Document::parse(xml).unwrap();
        let city_node = doc.root_element();

        let completed = city_node
            .children()
            .find(|n| n.has_tag_name("CompletedBuild"))
            .unwrap();

        let completed_items: Vec<_> = completed
            .children()
            .filter(|n| n.has_tag_name("QueueInfo"))
            .collect();

        assert_eq!(completed_items.len(), 2);
    }
}
