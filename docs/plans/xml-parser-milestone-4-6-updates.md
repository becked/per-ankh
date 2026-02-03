# XML Parser Implementation Plan - Milestones 4-6 Updates

**Based on actual XML structure analysis**

This document updates Milestones 4-6 of the XML parser implementation plan based on learnings from the actual Old World save file XML structure.

---

## Key Discoveries

### XML Structure Pattern

The XML uses a **mixed nesting strategy**:

1. **Root-level elements**: Top-level sibling elements for entities
   - `<Player>`, `<Character>`, `<City>`, `<Tile>`, `<Tribe>`

2. **Game-level nested data**: Global game state inside `<Game>` element
   - `YieldPriceHistory` - Market prices over time
   - `TribeDiplomacy` / `TeamDiplomacy` - Diplomatic relations
   - `EventStoryMaxPriority` - Global event state

3. **Player-nested data**: Player-specific state inside `<Player>` elements
   - Resources: `YieldStockpile`
   - Technology: `TechProgress`, `TechCount`, `TechAvailable/Passed/etc`
   - Governance: `ActiveLaw`, `CouncilCharacter`
   - Goals: `GoalList`
   - **Time-series**: `MilitaryPowerHistory`, `PointsHistory`, `LegitimacyHistory`, `YieldRateHistory`
   - **Events**: `AllEventStoryTurn`, `FamilyEventStoryTurn`, `ReligionEventStoryTurn`, etc.
   - **Opinions**: `FamilyOpinionHistory`, `ReligionOpinionHistory`

4. **Character-nested data**: Character-specific state inside `<Character>` elements
   - Stats: `Rating`, `Stat`
   - Traits: `TraitTurn`
   - Relationships: `RelationshipList`
   - Events: `EventStoryTurn`

5. **City-nested data**: City-specific state inside `<City>` elements
   - Production: `BuildQueue`, `CompletedBuild`
   - Culture: `TeamCulture`, `TeamHappinessLevel`
   - Events: `EventStoryTurn`

6. **Tile-nested data**: Tile-specific state inside `<Tile>` elements
   - Visibility: `RevealedTurn`, `RevealedOwner`
   - History: `OwnerHistory`, `TerrainHistory`, `VegetationHistory`
   - Units: `<Unit>` elements nested within tiles

**This is fundamentally different from the original plan's assumption that all data would be at root level.**

---

## Milestone 4: Time-Series Data (Updated)

**Goal:** Parse historical turn-by-turn data from Game and Player levels

### Actual XML Structure

Time-series data appears in **two locations**:

1. **Game-level** (inside `<Game>` element):

   ```xml
   <Game>
     <YieldPriceHistory>
       <YIELD_GROWTH>
         <T2>0</T2>
         <T5>0</T5>
         <T18>50</T18>
       </YIELD_GROWTH>
     </YieldPriceHistory>
   </Game>
   ```

2. **Player-level** (inside each `<Player>` element):
   ```xml
   <Player ID="0">
     <MilitaryPowerHistory>
       <T2>40</T2>
       <T3>40</T3>
       ...
     </MilitaryPowerHistory>
     <PointsHistory>
       <T2>100</T2>
       ...
     </PointsHistory>
     <LegitimacyHistory>
       <T2>95</T2>
       ...
     </LegitimacyHistory>
     <YieldRateHistory>
       <YIELD_GROWTH>
         <T2>10</T2>
         ...
       </YIELD_GROWTH>
     </YieldRateHistory>
     <FamilyOpinionHistory>
       <FAMILY_BARCID>
         <T2>0</T2>
         ...
       </FAMILY_BARCID>
     </FamilyOpinionHistory>
     <ReligionOpinionHistory>
       <RELIGION_JUDAISM>
         <T2>0</T2>
         ...
       </RELIGION_JUDAISM>
     </ReligionOpinionHistory>
   </Player>
   ```

### Updated Deliverables

**Game-level parsers** (parse from `<Game>` element):

- [ ] Yield price history parser (`YieldPriceHistory` → `yield_prices` table)

**Player-level parsers** (parse from each `<Player>` element):

- [ ] Military power history parser (`MilitaryPowerHistory` → `military_history` table)
- [ ] Points history parser (`PointsHistory` → `points_history` table)
- [ ] Legitimacy history parser (`LegitimacyHistory` → `legitimacy_history` table)
- [ ] Yield rate history parser (`YieldRateHistory` → `yield_history` table)
- [ ] Family opinion history parser (`FamilyOpinionHistory` → `family_opinion_history` table)
- [ ] Religion opinion history parser (`ReligionOpinionHistory` → `religion_opinion_history` table)

**Performance optimization**:

- [ ] Batch insert optimization for sparse time-series data
- [ ] Prepared statement caching
- [ ] Consider column-store format for very large histories

### Implementation Strategy

```rust
// Game-level time-series (called once per import)
pub fn parse_game_timeseries(doc: &XmlDocument, conn: &Connection, match_id: i64) -> Result<()> {
    let root = doc.root_element();
    let game_node = root.children().find(|n| n.has_tag_name("Game"))?;

    parse_yield_price_history(&game_node, conn, match_id)?;
    Ok(())
}

// Player-level time-series (called for each player)
pub fn parse_player_timeseries(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
) -> Result<()> {
    parse_military_power_history(player_node, conn, player_id, match_id)?;
    parse_points_history(player_node, conn, player_id, match_id)?;
    parse_legitimacy_history(player_node, conn, player_id, match_id)?;
    parse_yield_rate_history(player_node, conn, player_id, match_id)?;
    parse_family_opinion_history(player_node, conn, player_id, match_id)?;
    parse_religion_opinion_history(player_node, conn, player_id, match_id)?;
    Ok(())
}
```

### Sparse Format Handling

All time-series use sparse `<TX>` format where X is the turn number:

```rust
fn parse_sparse_history(
    parent_node: &Node,
    element_name: &str,
) -> Result<Vec<(i32, i32)>> {
    let mut data = Vec::new();

    if let Some(history_node) = parent_node.children().find(|n| n.has_tag_name(element_name)) {
        for turn_node in history_node.children().filter(|n| n.is_element()) {
            let turn_tag = turn_node.tag_name().name(); // "T45"
            if !turn_tag.starts_with('T') {
                continue;
            }

            let turn: i32 = turn_tag[1..].parse()
                .map_err(|_| ParseError::InvalidFormat(format!("Invalid turn tag: {}", turn_tag)))?;

            let value: i32 = turn_node.text()
                .ok_or_else(|| ParseError::MissingElement(format!("{}.<{}>", element_name, turn_tag)))?
                .parse()
                .map_err(|_| ParseError::InvalidFormat(format!("Invalid integer in {}", turn_tag)))?;

            data.push((turn, value));
        }
    }

    Ok(data)
}
```

### Success Criteria

- ✓ Can reconstruct game progression from turn 1 to current turn
- ✓ Sparse data handled correctly (only turns with data are stored)
- ✓ All player-specific histories parsed per player
- ✓ Performance acceptable (<5 seconds for time-series data)
- ✓ Memory efficient (streaming inserts, not full in-memory buffering)

---

## Milestone 5: Events & Narrative (Updated)

**Goal:** Parse story events, mission tracking, and character narrative data

### Actual XML Structure

Events and narrative data are **distributed across multiple entity types**:

1. **Game-level** (inside `<Game>`):

   ```xml
   <Game>
     <EventStoryMaxPriority />
   </Game>
   ```

2. **Player-level** (inside `<Player>`):

   ```xml
   <Player ID="0">
     <MissionStartedTurn>
       <MISSION_AMBASSADOR>5</MISSION_AMBASSADOR>
     </MissionStartedTurn>
     <AllEventStoryTurn>
       <EVENTSTORY_CULTURE_PAID_FUNCTION>14</EVENTSTORY_CULTURE_PAID_FUNCTION>
     </AllEventStoryTurn>
     <FamilyEventStoryTurn>
       <FAMILY_BARCID.EVENTSTORY_MARRIAGE_OFFER>10</FAMILY_BARCID.EVENTSTORY_MARRIAGE_OFFER>
     </FamilyEventStoryTurn>
     <ReligionEventStoryTurn>
       <RELIGION_JUDAISM.EVENTSTORY_HOLY_SITE>15</RELIGION_JUDAISM.EVENTSTORY_HOLY_SITE>
     </ReligionEventStoryTurn>
     <TribeEventStoryTurn>
       <TRIBE_VANDALS.EVENTSTORY_TRIBE_CONTACT>8</TRIBE_VANDALS.EVENTSTORY_TRIBE_CONTACT>
     </TribeEventStoryTurn>
     <PlayerEventStoryTurn>
       <EVENTSTORY_PLAYER_SPECIFIC>20</EVENTSTORY_PLAYER_SPECIFIC>
     </PlayerEventStoryTurn>
   </Player>
   ```

3. **Character-level** (inside `<Character>`):

   ```xml
   <Character ID="5">
     <Rating>
       <RATING_WISDOM>3</RATING_WISDOM>
       <RATING_CHARISMA>2</RATING_CHARISMA>
       <RATING_COURAGE>1</RATING_COURAGE>
       <RATING_DISCIPLINE>4</RATING_DISCIPLINE>
     </Rating>
     <Stat>
       <STAT_KILLS>5</STAT_KILLS>
     </Stat>
     <TraitTurn>
       <TRAIT_BUILDER_ARCHETYPE>1</TRAIT_BUILDER_ARCHETYPE>
       <TRAIT_AMBITIOUS>5</TRAIT_AMBITIOUS>
     </TraitTurn>
     <EventStoryTurn>
       <EVENTSTORY_CHARACTER_EVENT>12</EVENTSTORY_CHARACTER_EVENT>
     </EventStoryTurn>
     <RelationshipList>
       <RelationshipData>
         <Type>RELATIONSHIP_PLOTTING_AGAINST</Type>
         <ID>10</ID>
         <Turn>15</Turn>
       </RelationshipData>
     </RelationshipList>
   </Character>
   ```

4. **Goal-level** (inside `<GoalData>` within `<Player>`):

   ```xml
   <GoalData>
     <MissionsCompleted>
       <MISSION_AMBASSADOR>1</MISSION_AMBASSADOR>
     </MissionsCompleted>
   </GoalData>
   ```

5. **City-level** (inside `<City>`):
   ```xml
   <City ID="0">
     <EventStoryTurn>
       <EVENTSTORY_GROWING_ADMINISTRATION>28</EVENTSTORY_GROWING_ADMINISTRATION>
     </EventStoryTurn>
     <BuildQueue>
       <QueueInfo>
         <Build>BUILD_UNIT</Build>
         <Type>UNIT_WORKER</Type>
         <Progress>200</Progress>
       </QueueInfo>
     </BuildQueue>
     <CompletedBuild>
       <QueueInfo>
         <Build>BUILD_PROJECT</Build>
         <Type>PROJECT_REPAIR</Type>
       </QueueInfo>
     </CompletedBuild>
   </City>
   ```

### Updated Deliverables

**Character parsers** (extend existing character parser):

- [ ] Character stats parser (`Rating`, `Stat` → `character_stats` table)
- [ ] Character traits parser (`TraitTurn` → `character_traits` table)
- [ ] Character relationships parser (`RelationshipList` → `character_relationships` table)
- [ ] Character event story parser (`EventStoryTurn` → `story_events` table)

**Player parsers** (extend player gameplay data parser):

- [ ] Player mission tracking (`MissionStartedTurn` → track mission starts)
- [ ] Player event stories (`AllEventStoryTurn`, `FamilyEventStoryTurn`, etc. → `story_events` table)

**City parsers** (new module `city_data.rs`):

- [ ] City production queue parser (`BuildQueue` → `city_production_queue` table)
- [ ] City completed builds parser (`CompletedBuild` → `city_projects_completed` table)
- [ ] City event stories (`EventStoryTurn` → `story_events` table)

**NOTE**: There may not be a separate "event log" or "event outcomes" table in the XML. Events appear to be tracked as:

- Turn when event occurred (stored in various `*EventStoryTurn` elements)
- Event choices may not be stored in saves (only the outcome)

### Implementation Strategy

```rust
// Extend character parser (Pass 2: Relationships & derived data)
pub fn parse_character_extended_data(
    doc: &XmlDocument,
    conn: &Connection,
    id_mapper: &IdMapper,
) -> Result<()> {
    let root = doc.root_element();

    for char_node in root.children().filter(|n| n.has_tag_name("Character")) {
        let xml_id: i32 = char_node.req_attr("ID")?.parse()?;
        let character_id = id_mapper.get_character(xml_id)?;
        let match_id = id_mapper.match_id;

        parse_character_stats(&char_node, conn, character_id, match_id)?;
        parse_character_traits(&char_node, conn, character_id, match_id)?;
        parse_character_relationships(&char_node, conn, id_mapper, character_id, match_id)?;
        parse_character_events(&char_node, conn, character_id, match_id)?;
    }

    Ok(())
}

// New city data parser
pub fn parse_city_extended_data(
    doc: &XmlDocument,
    conn: &Connection,
    id_mapper: &IdMapper,
) -> Result<()> {
    let root = doc.root_element();

    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let xml_id: i32 = city_node.req_attr("ID")?.parse()?;
        let city_id = id_mapper.get_city(xml_id)?;
        let match_id = id_mapper.match_id;

        parse_city_build_queue(&city_node, conn, city_id, match_id)?;
        parse_city_completed_builds(&city_node, conn, city_id, match_id)?;
        parse_city_events(&city_node, conn, city_id, match_id)?;
    }

    Ok(())
}
```

### Success Criteria

- ✓ Character stats (Rating) parsed with all 4 attributes
- ✓ Character traits parsed with turn acquired
- ✓ Character relationships (plotting, loves, hates) tracked
- ✓ Character event stories tracked by turn
- ✓ City production queues captured
- ✓ Mission tracking for goals works
- ✓ Event stories linked to correct entity (character/city/player/family/religion/tribe)

---

## Milestone 6: Edge Cases & Polish (Updated)

**Goal:** Handle all edge cases, optimize, document, and complete coverage

### Additional Deliverables (Based on XML Discoveries)

**Tile-level data**:

- [ ] Tile visibility parser (`RevealedTurn`, `RevealedOwner` → `tile_visibility` table)
- [ ] Tile history parser (`OwnerHistory`, `TerrainHistory` → `tile_changes` table)
- [ ] Unit parser refinement (units are nested in tiles, not at root level)

**City-level data** (additional):

- [ ] City yield progress (`YieldProgress` → store in cities table or separate tracking)
- [ ] City culture per team (`TeamCulture` → `city_culture` table)
- [ ] City happiness per team (`TeamHappinessLevel` → track in cities or separate table)
- [ ] City family influence (`PlayerFamily` → track dominant family)

**Character-level data** (additional):

- [ ] Character cognomen history (`CognomenHistory` → track nickname changes over time)

**Player-level data** (additional):

- [ ] Law change counts (`LawClassChangeCount` → update `laws.change_count`)
- [ ] Mission counts (`MissionStartedTurn` → count missions by type)

**Schema refinements**:

- [ ] Review all `adopted_turn`, `completed_turn` fields - many don't have explicit turn data in XML
- [ ] Consider adding `turn_last_seen` to entities for tracking state snapshots
- [ ] Add `xml_path` debugging field to track where data came from

**Performance optimizations**:

- [ ] Profile import on large save files (100+ turns)
- [ ] Identify bottlenecks (likely time-series bulk inserts)
- [ ] Implement prepared statement pooling
- [ ] Consider batched inserts for time-series (1000 rows at a time)

**Testing coverage**:

- [ ] Test with saves from different game versions
- [ ] Test with saves from different nations
- [ ] Test with saves at different turn counts (early game vs late game)
- [ ] Test update-and-replace with same save at different turns
- [ ] Test concurrent imports of different saves

**Documentation**:

- [ ] Document XML structure patterns (root/game/player/character/city/tile nested)
- [ ] Document sparse time-series format (`<TX>` elements)
- [ ] Document entity ID mapping strategy
- [ ] Add comments explaining non-obvious XML patterns
- [ ] Create example queries for common use cases

### Success Criteria

- ✓ All test save files import successfully (100% success rate)
- ✓ Parse failures produce actionable error messages with XML paths
- ✓ Import performance: <30 seconds per save file (including all time-series data)
- ✓ Zero data loss for covered schema sections (85%+ of XML data captured)
- ✓ Update-and-replace works correctly (stable IDs, no orphaned data)
- ✓ Concurrent imports handle properly (no race conditions or deadlocks)

---

## Implementation Order Adjustments

Based on the nested structure, the recommended parsing order is:

### Phase 1: Core Entities (Milestone 1-2) ✅

1. Match metadata
2. Players (core fields only)
3. Characters (core fields only)
4. Tribes
5. Tiles (core fields only)
6. Cities (core fields only)
7. Units (nested in tiles)
8. Families (if present as entities)
9. Religions (if present as entities)

### Phase 2: Player Gameplay Data (Milestone 3) ✅

1. Player resources (`YieldStockpile`)
2. Technology progress/completion/states
3. Council positions
4. Laws
5. Player goals

### Phase 3: Diplomacy (Milestone 3) ✅

1. Tribe diplomacy
2. Team/player diplomacy

### Phase 4: Time-Series Data (Milestone 4)

1. Game-level yield prices
2. Player-level histories (military, points, legitimacy, yields, opinions)

### Phase 5: Character Extended Data (Milestone 5)

1. Character stats (Rating, Stat)
2. Character traits (TraitTurn)
3. Character relationships (RelationshipList)
4. Character events (EventStoryTurn)

### Phase 6: City Extended Data (Milestone 5)

1. City build queues
2. City completed builds
3. City events
4. City culture/happiness

### Phase 7: Tile Extended Data (Milestone 6)

1. Tile visibility
2. Tile history
3. Tile-specific improvements/features

### Phase 8: Polish & Edge Cases (Milestone 6)

1. Additional nested data fields
2. Performance optimizations
3. Comprehensive testing
4. Documentation

---

## Notes for Implementation

### Parsing Pattern: Nested Data

Most parsers will follow this pattern:

```rust
// For player-nested data
pub fn parse_player_nested_section(
    player_node: &Node,  // Already positioned at <Player> element
    conn: &Connection,
    player_id: i64,
    match_id: i64,
) -> Result<usize> {
    // Find child element within player
    if let Some(section_node) = player_node.children().find(|n| n.has_tag_name("SectionName")) {
        // Parse children
    }
    Ok(count)
}

// Called from main player iteration
for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
    let player_id = ...;
    parse_player_nested_section(&player_node, conn, player_id, match_id)?;
}
```

### Testing Strategy

For each milestone, create an integration test that:

1. Imports a test save file
2. Queries the database to verify record counts
3. Spot-checks specific data values against known XML content
4. Verifies referential integrity (no dangling foreign keys)

### Documentation Strategy

Each parser module should have:

- Module-level comment with XML structure example
- Function-level comments explaining non-obvious parsing logic
- Examples of the actual XML being parsed
- Notes about edge cases or assumptions

---

## Questions to Resolve

1. **Event Outcomes**: Are event choices and outcomes stored in saves, or only the triggered events?
2. **Mission Details**: Do missions have more detailed tracking beyond start/complete counts?
3. **Family/Religion entities**: Are these ever standalone entities, or only referenced by name?
4. **Tile improvements**: Where are improvements (roads, farms, etc.) stored?
5. **Unit nested structure**: Since units are nested in tiles, should we update unit parser location?

These should be investigated during Milestone 4-6 implementation.
