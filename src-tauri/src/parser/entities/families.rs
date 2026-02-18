// Family entity parser
//
// Families are stored differently than other entities in the XML:
// 1. Global FamilyClass element maps family names to their classes
// 2. Each Player has FamilyHeadID, FamilySeatCityID, and FamilyTurnsNoLeader elements
//    that map family names to their current state
//
// Example structure:
// ```xml
// <Root>
//   <FamilyClass>
//     <FAMILY_FABIUS>FAMILYCLASS_CHAMPIONS</FAMILY_FABIUS>
//     <FAMILY_VALERIUS>FAMILYCLASS_LANDOWNERS</FAMILY_VALERIUS>
//   </FamilyClass>
//   <Player ID="0">
//     <FamilyHeadID>
//       <FAMILY_FABIUS>68</FAMILY_FABIUS>
//       <FAMILY_VALERIUS>95</FAMILY_VALERIUS>
//     </FamilyHeadID>
//     <FamilySeatCityID>
//       <FAMILY_FABIUS>2</FAMILY_FABIUS>
//       <FAMILY_VALERIUS>4</FAMILY_VALERIUS>
//     </FamilySeatCityID>
//     <FamilyTurnsNoLeader>
//       <FAMILY_JULIUS>96</FAMILY_JULIUS>
//     </FamilyTurnsNoLeader>
//   </Player>
// </Root>
// ```

use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::Result;
use duckdb::{params, Connection};
use std::collections::{HashMap, HashSet};

/// Parse all families from the XML document
pub fn parse_families(
    doc: &XmlDocument,
    conn: &Connection,
    id_mapper: &mut IdMapper,
) -> Result<usize> {
    let root = doc.root_element();

    // Collect all family rows first
    let mut families = Vec::new();

    // Step 1: Parse global FamilyClass to get all family names and their classes
    let family_classes = parse_family_classes(&root)?;

    // Step 2: Parse per-player family data
    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let player_xml_id: i32 = player_node.req_attr("ID")?.parse()?;
        let player_db_id = id_mapper.get_player(player_xml_id)?;

        // Parse FamilyHeadID
        let family_heads = if let Some(head_node) = player_node
            .children()
            .find(|n| n.has_tag_name("FamilyHeadID"))
        {
            parse_family_mapping(&head_node)
        } else {
            HashMap::new()
        };

        // Parse FamilySeatCityID
        let family_seats = if let Some(seat_node) = player_node
            .children()
            .find(|n| n.has_tag_name("FamilySeatCityID"))
        {
            parse_family_mapping(&seat_node)
        } else {
            HashMap::new()
        };

        // Parse FamilyTurnsNoLeader
        let family_turns_no_leader = if let Some(turns_node) = player_node
            .children()
            .find(|n| n.has_tag_name("FamilyTurnsNoLeader"))
        {
            parse_family_mapping(&turns_node)
        } else {
            HashMap::new()
        };

        // Step 3: Collect all families that belong to this player
        let mut player_families = HashSet::new();
        player_families.extend(family_heads.keys().cloned());
        player_families.extend(family_seats.keys().cloned());
        player_families.extend(family_turns_no_leader.keys().cloned());

        // Step 4: Insert/update family records
        for family_name in player_families {
            // Get family class from global lookup (defaults to empty if not found)
            let family_class = family_classes.get(&family_name).map(|s| s.as_str()).unwrap_or("");

            // Generate a stable xml_id for the family based on name hash
            // This ensures consistent IDs across imports
            let xml_id = generate_family_xml_id(&family_name);
            let db_id = id_mapper.map_family(xml_id);

            // Get head character ID (if any)
            let head_character_xml_id = family_heads.get(&family_name).copied();
            let head_character_db_id = match head_character_xml_id {
                Some(id) => Some(id_mapper.get_character(id)?),
                None => None,
            };

            // Get seat city ID (if any)
            let seat_city_xml_id = family_seats.get(&family_name).copied();
            let seat_city_db_id = match seat_city_xml_id {
                Some(id) => Some(id_mapper.get_city(id)?),
                None => None,
            };

            // Get turns without leader
            let turns_without_leader = family_turns_no_leader.get(&family_name).copied().unwrap_or(0);

            // Collect row data - must match schema column order exactly
            families.push((
                db_id,                      // family_id
                id_mapper.match_id,         // match_id
                xml_id,                     // xml_id
                player_db_id,               // player_id
                family_name.clone(),        // family_name
                family_class.to_string(),   // family_class
                head_character_db_id,       // head_character_id
                seat_city_db_id,            // seat_city_id
                turns_without_leader,       // turns_without_leader
            ));
        }
    }

    // Deduplicate (last-wins strategy)
    // Primary key: (family_id, match_id)
    let unique_families = deduplicate_rows_last_wins(
        families,
        |(family_id, match_id, ..)| (*family_id, *match_id)
    );

    let count = unique_families.len();

    // Bulk insert deduplicated rows
    let mut app = conn.appender("families")?;
    for (db_id, match_id, xml_id, player_db_id, family_name, family_class,
         head_character_db_id, seat_city_db_id, turns_without_leader) in unique_families
    {
        app.append_row(params![
            db_id, match_id, xml_id, player_db_id, family_name, family_class,
            head_character_db_id, seat_city_db_id, turns_without_leader
        ])?;
    }

    // Flush appender to commit all rows
    app.flush()?;

    log::info!("Parsed {} families", count);
    Ok(count)
}

/// Parse the global FamilyClass element to get all family names and their classes
///
/// Tries multiple strategies to find the FamilyClass element:
/// 1. Search direct children of root (expected location)
/// 2. Search all descendants (in case it's nested)
fn parse_family_classes(root: &roxmltree::Node) -> Result<HashMap<String, String>> {
    let mut family_classes = HashMap::new();

    // Strategy 1: Try direct children first (expected location)
    if let Some(class_node) = root.children().find(|n| n.has_tag_name("FamilyClass")) {
        log::debug!("Found FamilyClass as direct child of Root");
        for family_elem in class_node.children().filter(|n| n.is_element()) {
            let family_name = family_elem.tag_name().name().to_string();
            if let Some(class) = family_elem.text() {
                family_classes.insert(family_name, class.to_string());
            }
        }
        log::info!("Parsed {} family classes from FamilyClass element", family_classes.len());
        return Ok(family_classes);
    }

    // Strategy 2: Search all descendants (in case element is nested)
    log::debug!("FamilyClass not found in direct children, searching descendants...");
    if let Some(class_node) = root.descendants().find(|n| n.has_tag_name("FamilyClass")) {
        log::info!("Found FamilyClass in descendants (not direct child)");
        for family_elem in class_node.children().filter(|n| n.is_element()) {
            let family_name = family_elem.tag_name().name().to_string();
            if let Some(class) = family_elem.text() {
                family_classes.insert(family_name, class.to_string());
            }
        }
        log::info!("Parsed {} family classes from FamilyClass element", family_classes.len());
        return Ok(family_classes);
    }

    // If we get here, FamilyClass wasn't found
    log::warn!("FamilyClass element not found in XML document");

    // Debug: List first 50 direct children to help diagnose
    let child_names: Vec<String> = root.children()
        .filter(|n| n.is_element())
        .take(50)
        .map(|n| n.tag_name().name().to_string())
        .collect();
    log::debug!("First 50 root children: {:?}", child_names);

    Ok(family_classes)
}

/// Parse a family mapping element (FamilyHeadID, FamilySeatCityID, or FamilyTurnsNoLeader)
/// Returns a map of family_name -> ID
fn parse_family_mapping(parent_node: &roxmltree::Node) -> HashMap<String, i32> {
    let mut mapping = HashMap::new();

    for elem in parent_node.children().filter(|n| n.is_element()) {
        let family_name = elem.tag_name().name().to_string();
        if let Some(value_str) = elem.text() {
            if let Ok(value) = value_str.parse::<i32>() {
                mapping.insert(family_name, value);
            }
        }
    }

    mapping
}

/// Generate a stable xml_id for a family based on its name
/// Uses a simple hash to convert the family name to an i32
fn generate_family_xml_id(family_name: &str) -> i32 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    family_name.hash(&mut hasher);
    let hash = hasher.finish();

    // Take lower 31 bits to ensure positive i32
    (hash & 0x7FFF_FFFF) as i32
}
