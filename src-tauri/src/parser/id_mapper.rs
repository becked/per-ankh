// ID Mapping: XML IDs → Database IDs
//
// Maintains stable database IDs across re-imports of the same match.
// Each match gets fresh ID sequences starting at 1.
// Re-importing a match loads existing mappings from id_mappings table.

use super::{ParseError, Result};
use duckdb::{params, Connection};
use std::collections::HashMap;

/// Maps XML IDs to stable database IDs
pub struct IdMapper {
    pub match_id: i64,

    // XML ID → Database ID mappings
    players: HashMap<i32, i64>,
    characters: HashMap<i32, i64>,
    cities: HashMap<i32, i64>,
    units: HashMap<i32, i64>,
    tiles: HashMap<i32, i64>,
    families: HashMap<i32, i64>,
    religions: HashMap<i32, i64>,
    tribes: HashMap<i32, i64>,

    // Sequence generators (next available ID)
    next_player_id: i64,
    next_character_id: i64,
    next_city_id: i64,
    next_unit_id: i64,
    next_tile_id: i64,
    next_family_id: i64,
    next_religion_id: i64,
    next_tribe_id: i64,
}

impl IdMapper {
    /// Create new IdMapper, optionally loading existing mappings for updates
    ///
    /// # Arguments
    /// * `match_id` - The match ID
    /// * `conn` - Database connection
    /// * `is_new` - If true, start fresh. If false, load existing mappings.
    pub fn new(match_id: i64, conn: &Connection, is_new: bool) -> Result<Self> {
        if is_new {
            // Start fresh with ID 1 for all entity types
            Ok(Self {
                match_id,
                players: HashMap::new(),
                characters: HashMap::new(),
                cities: HashMap::new(),
                units: HashMap::new(),
                tiles: HashMap::new(),
                families: HashMap::new(),
                religions: HashMap::new(),
                tribes: HashMap::new(),
                next_player_id: 1,
                next_character_id: 1,
                next_city_id: 1,
                next_unit_id: 1,
                next_tile_id: 1,
                next_family_id: 1,
                next_religion_id: 1,
                next_tribe_id: 1,
            })
        } else {
            // Load existing mappings from id_mappings table
            Self::load_existing_mappings(conn, match_id)
        }
    }

    /// Load existing XML → DB ID mappings for match update
    fn load_existing_mappings(conn: &Connection, match_id: i64) -> Result<Self> {
        let mut mapper = Self {
            match_id,
            players: HashMap::new(),
            characters: HashMap::new(),
            cities: HashMap::new(),
            units: HashMap::new(),
            tiles: HashMap::new(),
            families: HashMap::new(),
            religions: HashMap::new(),
            tribes: HashMap::new(),
            next_player_id: 1,
            next_character_id: 1,
            next_city_id: 1,
            next_unit_id: 1,
            next_tile_id: 1,
            next_family_id: 1,
            next_religion_id: 1,
            next_tribe_id: 1,
        };

        // Query id_mappings table
        let mut stmt = conn.prepare(
            "SELECT entity_type, xml_id, db_id FROM id_mappings WHERE match_id = ?",
        )?;
        let rows = stmt.query_map(params![match_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i32>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;

        // Populate hashmaps and track max IDs
        for row in rows {
            let (entity_type, xml_id, db_id) = row?;
            match entity_type.as_str() {
                "player" => {
                    mapper.players.insert(xml_id, db_id);
                    mapper.next_player_id = mapper.next_player_id.max(db_id + 1);
                }
                "character" => {
                    mapper.characters.insert(xml_id, db_id);
                    mapper.next_character_id = mapper.next_character_id.max(db_id + 1);
                }
                "city" => {
                    mapper.cities.insert(xml_id, db_id);
                    mapper.next_city_id = mapper.next_city_id.max(db_id + 1);
                }
                "unit" => {
                    mapper.units.insert(xml_id, db_id);
                    mapper.next_unit_id = mapper.next_unit_id.max(db_id + 1);
                }
                "tile" => {
                    mapper.tiles.insert(xml_id, db_id);
                    mapper.next_tile_id = mapper.next_tile_id.max(db_id + 1);
                }
                "family" => {
                    mapper.families.insert(xml_id, db_id);
                    mapper.next_family_id = mapper.next_family_id.max(db_id + 1);
                }
                "religion" => {
                    mapper.religions.insert(xml_id, db_id);
                    mapper.next_religion_id = mapper.next_religion_id.max(db_id + 1);
                }
                "tribe" => {
                    mapper.tribes.insert(xml_id, db_id);
                    mapper.next_tribe_id = mapper.next_tribe_id.max(db_id + 1);
                }
                _ => {} // Ignore unknown types for forward compatibility
            }
        }

        Ok(mapper)
    }

    /// Save specific entity type mappings to database (for phased persistence)
    pub fn save_mappings_partial(
        &self,
        conn: &Connection,
        entity_types: &[&str],
    ) -> Result<()> {
        let mut stmt = conn.prepare(
            "INSERT INTO id_mappings (match_id, entity_type, xml_id, db_id)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (match_id, entity_type, xml_id)
             DO UPDATE SET db_id = excluded.db_id",
        )?;

        for entity_type in entity_types {
            let mappings = match *entity_type {
                "player" => &self.players,
                "character" => &self.characters,
                "city" => &self.cities,
                "unit" => &self.units,
                "tile" => &self.tiles,
                "family" => &self.families,
                "religion" => &self.religions,
                "tribe" => &self.tribes,
                _ => continue,
            };

            for (&xml_id, &db_id) in mappings {
                stmt.execute(params![self.match_id, entity_type, xml_id, db_id])?;
            }
        }

        Ok(())
    }

    /// Save all mappings to database for future updates
    pub fn save_mappings(&self, conn: &Connection) -> Result<()> {
        self.save_mappings_partial(
            conn,
            &[
                "player", "character", "city", "unit", "tile", "family", "religion", "tribe",
            ],
        )
    }

    // Map XML ID to database ID (create if doesn't exist)
    pub fn map_player(&mut self, xml_id: i32) -> i64 {
        *self.players.entry(xml_id).or_insert_with(|| {
            let id = self.next_player_id;
            self.next_player_id += 1;
            id
        })
    }

    pub fn map_character(&mut self, xml_id: i32) -> i64 {
        *self.characters.entry(xml_id).or_insert_with(|| {
            let id = self.next_character_id;
            self.next_character_id += 1;
            id
        })
    }

    pub fn map_city(&mut self, xml_id: i32) -> i64 {
        *self.cities.entry(xml_id).or_insert_with(|| {
            let id = self.next_city_id;
            self.next_city_id += 1;
            id
        })
    }

    pub fn map_unit(&mut self, xml_id: i32) -> i64 {
        *self.units.entry(xml_id).or_insert_with(|| {
            let id = self.next_unit_id;
            self.next_unit_id += 1;
            id
        })
    }

    pub fn map_tile(&mut self, xml_id: i32) -> i64 {
        *self.tiles.entry(xml_id).or_insert_with(|| {
            let id = self.next_tile_id;
            self.next_tile_id += 1;
            id
        })
    }

    pub fn map_family(&mut self, xml_id: i32) -> i64 {
        *self.families.entry(xml_id).or_insert_with(|| {
            let id = self.next_family_id;
            self.next_family_id += 1;
            id
        })
    }

    pub fn map_religion(&mut self, xml_id: i32) -> i64 {
        *self.religions.entry(xml_id).or_insert_with(|| {
            let id = self.next_religion_id;
            self.next_religion_id += 1;
            id
        })
    }

    pub fn map_tribe(&mut self, xml_id: i32) -> i64 {
        *self.tribes.entry(xml_id).or_insert_with(|| {
            let id = self.next_tribe_id;
            self.next_tribe_id += 1;
            id
        })
    }

    // Get existing database ID (error if not mapped)
    pub fn get_player(&self, xml_id: i32) -> Result<i64> {
        log::debug!("get_player called with xml_id={}, mapped players: {:?}", xml_id, self.players.keys().collect::<Vec<_>>());
        self.players
            .get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownPlayerId(xml_id, "lookup".to_string()))
    }

    pub fn get_character(&self, xml_id: i32) -> Result<i64> {
        self.characters
            .get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownCharacterId(xml_id, "lookup".to_string()))
    }

    pub fn get_city(&self, xml_id: i32) -> Result<i64> {
        self.cities
            .get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownCityId(xml_id, "lookup".to_string()))
    }

    pub fn get_unit(&self, xml_id: i32) -> Result<i64> {
        self.units
            .get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownUnitId(xml_id, "lookup".to_string()))
    }

    pub fn get_tile(&self, xml_id: i32) -> Result<i64> {
        self.tiles
            .get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownTileId(xml_id, "lookup".to_string()))
    }

    pub fn get_family(&self, xml_id: i32) -> Result<i64> {
        self.families
            .get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownFamilyId(xml_id, "lookup".to_string()))
    }

    pub fn get_religion(&self, xml_id: i32) -> Result<i64> {
        self.religions
            .get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownReligionId(xml_id, "lookup".to_string()))
    }

    pub fn get_tribe(&self, xml_id: i32) -> Result<i64> {
        self.tribes
            .get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownTribeId(xml_id, "lookup".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_id_mapper_new() {
        let mapper = IdMapper {
            match_id: 1,
            players: HashMap::new(),
            characters: HashMap::new(),
            cities: HashMap::new(),
            units: HashMap::new(),
            tiles: HashMap::new(),
            families: HashMap::new(),
            religions: HashMap::new(),
            tribes: HashMap::new(),
            next_player_id: 1,
            next_character_id: 1,
            next_city_id: 1,
            next_unit_id: 1,
            next_tile_id: 1,
            next_family_id: 1,
            next_religion_id: 1,
            next_tribe_id: 1,
        };

        assert_eq!(mapper.match_id, 1);
        assert_eq!(mapper.next_player_id, 1);
    }

    #[test]
    fn test_id_mapper_map_player() {
        let mut mapper = IdMapper {
            match_id: 1,
            players: HashMap::new(),
            characters: HashMap::new(),
            cities: HashMap::new(),
            units: HashMap::new(),
            tiles: HashMap::new(),
            families: HashMap::new(),
            religions: HashMap::new(),
            tribes: HashMap::new(),
            next_player_id: 1,
            next_character_id: 1,
            next_city_id: 1,
            next_unit_id: 1,
            next_tile_id: 1,
            next_family_id: 1,
            next_religion_id: 1,
            next_tribe_id: 1,
        };

        let db_id1 = mapper.map_player(10);
        let db_id2 = mapper.map_player(20);
        let db_id1_again = mapper.map_player(10);

        assert_eq!(db_id1, 1);
        assert_eq!(db_id2, 2);
        assert_eq!(db_id1_again, 1); // Same XML ID returns same DB ID
        assert_eq!(mapper.next_player_id, 3);
    }

    #[test]
    fn test_id_mapper_get_player_not_found() {
        let mapper = IdMapper {
            match_id: 1,
            players: HashMap::new(),
            characters: HashMap::new(),
            cities: HashMap::new(),
            units: HashMap::new(),
            tiles: HashMap::new(),
            families: HashMap::new(),
            religions: HashMap::new(),
            tribes: HashMap::new(),
            next_player_id: 1,
            next_character_id: 1,
            next_city_id: 1,
            next_unit_id: 1,
            next_tile_id: 1,
            next_family_id: 1,
            next_religion_id: 1,
            next_tribe_id: 1,
        };

        assert!(mapper.get_player(999).is_err());
    }
}
