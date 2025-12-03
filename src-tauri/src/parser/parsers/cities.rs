// Cities parser - pure parsing without database dependency

use crate::parser::game_data::CityData;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::Result;

/// Parse cities to structs (no DB dependency)
pub fn parse_cities_struct(doc: &XmlDocument) -> Result<Vec<CityData>> {
    let root = doc.root_element();
    let mut cities = Vec::new();

    // Find all City elements as direct children of Root
    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let xml_id = city_node.req_attr("ID")?.parse::<i32>()?;

        // Player ID - filter out -1 for cities in anarchy/being captured
        let player_xml_id = city_node.req_attr("Player")?.parse::<i32>()?;
        let player_xml_id = if player_xml_id >= 0 {
            Some(player_xml_id)
        } else {
            None
        };

        let tile_xml_id = city_node.req_attr("TileID")?.parse::<i32>()?;

        // City name: older saves use "NameType", newer saves use "Name"
        let city_name = city_node
            .opt_child_text("NameType")
            .or_else(|| city_node.opt_child_text("Name"))
            .unwrap_or("Unknown City")
            .to_string();

        let founded_turn = city_node.req_attr("Founded")?.parse::<i32>()?;

        // Optional fields
        let family = city_node.opt_attr("Family").map(|s| s.to_string());

        // Capital status is indicated by presence of <Capital /> element
        let is_capital = city_node.children().any(|n| n.has_tag_name("Capital"));

        // Population
        let citizens = city_node
            .opt_child_text("Citizens")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(1);

        // Leadership
        let governor_xml_id = city_node
            .opt_child_text("GovernorID")
            .and_then(|s| s.parse::<i32>().ok());

        // Production
        let hurry_civics_count = city_node
            .opt_child_text("HurryCivicsCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        let hurry_money_count = city_node
            .opt_child_text("HurryMoneyCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        let specialist_count = city_node
            .opt_child_text("SpecialistProducedCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        // First owner tracking
        let first_owner_player_xml_id = city_node
            .opt_child_text("FirstPlayer")
            .and_then(|s| s.parse::<i32>().ok());

        // Last owner tracking
        let last_owner_player_xml_id = city_node
            .opt_child_text("LastPlayer")
            .and_then(|s| s.parse::<i32>().ok());

        // Governor turn
        let governor_turn = city_node
            .opt_child_text("GovernorTurn")
            .and_then(|s| s.parse::<i32>().ok());

        // Additional hurry metrics
        let hurry_training_count = city_node
            .opt_child_text("HurryTrainingCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        let hurry_population_count = city_node
            .opt_child_text("HurryPopulationCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        // Growth and production counts
        let growth_count = city_node
            .opt_child_text("GrowthCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        let unit_production_count = city_node
            .opt_child_text("UnitProductionCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        let buy_tile_count = city_node
            .opt_child_text("BuyTileCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        cities.push(CityData {
            xml_id,
            city_name,
            founded_turn,
            player_xml_id,
            tile_xml_id,
            family,
            first_owner_player_xml_id,
            last_owner_player_xml_id,
            is_capital,
            citizens,
            governor_xml_id,
            governor_turn,
            hurry_civics_count,
            hurry_money_count,
            hurry_training_count,
            hurry_population_count,
            specialist_count,
            growth_count,
            unit_production_count,
            buy_tile_count,
        });
    }

    Ok(cities)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_cities_struct_basic() {
        let xml = r#"<Root GameId="test-123">
            <City ID="0" Player="0" TileID="100" Founded="1">
                <Name>Test City</Name>
                <Citizens>3</Citizens>
                <Capital />
            </City>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let cities = parse_cities_struct(&doc).unwrap();

        assert_eq!(cities.len(), 1);
        assert_eq!(cities[0].xml_id, 0);
        assert_eq!(cities[0].city_name, "Test City");
        assert_eq!(cities[0].player_xml_id, Some(0));
        assert_eq!(cities[0].tile_xml_id, 100);
        assert_eq!(cities[0].founded_turn, 1);
        assert_eq!(cities[0].is_capital, true);
        assert_eq!(cities[0].citizens, 3);
    }

    #[test]
    fn test_parse_cities_struct_anarchy() {
        let xml = r#"<Root GameId="test-123">
            <City ID="0" Player="-1" TileID="100" Founded="1">
                <Name>Anarchy City</Name>
            </City>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let cities = parse_cities_struct(&doc).unwrap();

        assert_eq!(cities.len(), 1);
        assert_eq!(cities[0].player_xml_id, None); // -1 filtered out
    }

    #[test]
    fn test_parse_cities_struct_multiple() {
        let xml = r#"<Root GameId="test-123">
            <City ID="0" Player="0" TileID="100" Founded="1">
                <Name>City One</Name>
            </City>
            <City ID="1" Player="1" TileID="200" Founded="5">
                <Name>City Two</Name>
                <Citizens>5</Citizens>
            </City>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let cities = parse_cities_struct(&doc).unwrap();

        assert_eq!(cities.len(), 2);
        assert_eq!(cities[0].city_name, "City One");
        assert_eq!(cities[1].city_name, "City Two");
        assert_eq!(cities[1].citizens, 5);
    }

    #[test]
    fn test_parse_cities_first_player() {
        let xml = r#"<Root GameId="test">
            <City ID="0" Player="0" TileID="100" Founded="1">
                <Name>Test</Name>
                <FirstPlayer>2</FirstPlayer>
            </City>
        </Root>"#;
        let doc = parse_xml(xml.to_string()).unwrap();
        let cities = parse_cities_struct(&doc).unwrap();
        assert_eq!(cities[0].first_owner_player_xml_id, Some(2));
    }

    #[test]
    fn test_parse_cities_specialist_produced_count() {
        let xml = r#"<Root GameId="test">
            <City ID="0" Player="0" TileID="100" Founded="1">
                <Name>Test</Name>
                <SpecialistProducedCount>24</SpecialistProducedCount>
            </City>
        </Root>"#;
        let doc = parse_xml(xml.to_string()).unwrap();
        let cities = parse_cities_struct(&doc).unwrap();
        assert_eq!(cities[0].specialist_count, 24);
    }

    #[test]
    fn test_parse_cities_all_hurry_metrics() {
        let xml = r#"<Root GameId="test">
            <City ID="0" Player="0" TileID="100" Founded="1">
                <Name>Test</Name>
                <HurryCivicsCount>3</HurryCivicsCount>
                <HurryTrainingCount>2</HurryTrainingCount>
                <HurryMoneyCount>5</HurryMoneyCount>
                <HurryPopulationCount>4</HurryPopulationCount>
            </City>
        </Root>"#;
        let doc = parse_xml(xml.to_string()).unwrap();
        let cities = parse_cities_struct(&doc).unwrap();
        assert_eq!(cities[0].hurry_civics_count, 3);
        assert_eq!(cities[0].hurry_training_count, 2);
        assert_eq!(cities[0].hurry_money_count, 5);
        assert_eq!(cities[0].hurry_population_count, 4);
    }

    #[test]
    fn test_parse_cities_new_fields() {
        let xml = r#"<Root GameId="test">
            <City ID="0" Player="0" TileID="100" Founded="1">
                <Name>Test</Name>
                <GovernorTurn>45</GovernorTurn>
                <GrowthCount>12</GrowthCount>
                <UnitProductionCount>8</UnitProductionCount>
                <LastPlayer>0</LastPlayer>
                <BuyTileCount>3</BuyTileCount>
            </City>
        </Root>"#;
        let doc = parse_xml(xml.to_string()).unwrap();
        let cities = parse_cities_struct(&doc).unwrap();
        assert_eq!(cities[0].governor_turn, Some(45));
        assert_eq!(cities[0].growth_count, 12);
        assert_eq!(cities[0].unit_production_count, 8);
        assert_eq!(cities[0].last_owner_player_xml_id, Some(0));
        assert_eq!(cities[0].buy_tile_count, 3);
    }
}
