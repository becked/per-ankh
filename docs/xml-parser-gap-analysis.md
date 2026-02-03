# XML Parser Gap Analysis

**Generated:** 2025-12-06
**Save Files Analyzed:** 2022-01 (v1.0.56632) through 2025-08 (v1.0.79004)

This document identifies data present in Old World save files that is not currently being parsed into our database. This is a gap analysis only - no judgments are made about what should or shouldn't be added.

---

## Table of Contents

1. [Root Element Attributes](#root-element-attributes)
2. [Top-Level Elements](#top-level-elements)
3. [Player Element Gaps](#player-element-gaps)
4. [Character Element Gaps](#character-element-gaps)
5. [City Element Gaps](#city-element-gaps)
6. [Tile Element Gaps](#tile-element-gaps)
7. [Unit Element Gaps](#unit-element-gaps)
8. [Tribe Element Gaps](#tribe-element-gaps)
9. [Game Element Gaps](#game-element-gaps)
10. [Configuration Elements](#configuration-elements)
11. [Version-Specific Elements](#version-specific-elements)

---

## Root Element Attributes

### Currently Parsed

| Attribute              | Notes                                        |
| ---------------------- | -------------------------------------------- |
| `GameId`               | Stored as `matches.game_id`                  |
| `Version`              | Parsed for `game_version` and `enabled_mods` |
| `GameName`             | Stored as `matches.game_name`                |
| `SaveDate`             | Stored as `matches.save_date`                |
| `MapWidth`             | Stored as `matches.map_width`                |
| `MapSize`              | Stored as `matches.map_size`                 |
| `MapClass`             | Stored as `matches.map_class`                |
| `FirstSeed`            | Stored as `matches.first_seed`               |
| `MapSeed`              | Stored as `matches.map_seed`                 |
| `GameMode`             | Stored as `matches.game_mode`                |
| `TurnStyle`            | Stored as `matches.turn_style`               |
| `TurnTimer`            | Stored as `matches.turn_timer`               |
| `TurnScale`            | Stored as `matches.turn_scale`               |
| `OpponentLevel`        | Stored as `matches.opponent_level`           |
| `TribeLevel`           | Stored as `matches.tribe_level`              |
| `Development`          | Stored as `matches.development`              |
| `Advantage`            | Stored as `matches.advantage`                |
| `SuccessionGender`     | Stored as `matches.succession_gender`        |
| `SuccessionOrder`      | Stored as `matches.succession_order`         |
| `Mortality`            | Stored as `matches.mortality`                |
| `EventLevel`           | Stored as `matches.event_level`              |
| `ForceMarch`           | Stored as `matches.force_march`              |
| `VictoryPointModifier` | Stored as `matches.victory_point_modifier`   |
| `TeamNation`           | Stored as `matches.team_nation`              |

### Not Parsed

| Attribute             | Sample Value         | Notes                                  |
| --------------------- | -------------------- | -------------------------------------- |
| `MinLatitude`         | `0`                  | Introduced in later versions           |
| `MaxLatitude`         | `0`                  | Introduced in later versions           |
| `MapEdgesSafe`        | `False`              | Boolean flag                           |
| `MinCitySiteDistance` | `8`                  | Integer                                |
| `MapPath`             | `The Old World`      | String - scenario map name             |
| `Scenario`            | `SCENARIO_OLD_WORLD` | Scenario type enum                     |
| `HumanDevelopment`    | `DEVELOPMENT_NONE`   | Separate human dev level (newer saves) |
| `NumAutosaves`        | `10`                 | Older saves only                       |

---

## Top-Level Elements

### Currently Parsed

- `Player` - Foundation entity
- `Character` - Foundation entity
- `City` - Foundation entity
- `Tile` - Foundation entity
- `Tribe` - Affiliation entity
- `Game` - Contains religion, diplomacy, timeseries data

### Not Parsed

| Element                 | Present In  | Description                                                                                         |
| ----------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `Archetype`             | 2023+, 2025 | Per-player starting archetype choices (`<LeaderArchetype>`)                                         |
| `Development`           | 2025        | Per-player development settings (`<PlayerDevelopment>`)                                             |
| `Dynasty`               | 2023+, 2025 | Per-player dynasty selections (`<PlayerDynasty>`)                                                   |
| `GameContentEnabled`    | 2025        | DLC/content flags as attributes (e.g., `BASE_CONTENT.1="1"`, `PHARAOHS.1="1"`)                      |
| `OccurrenceLevels`      | 2025        | Calamity/event frequency settings (`<OCCURRENCECLASS_CALAMITIES>OCCURRENCELEVEL_CALAMITIES_NORMAL`) |
| `GameOptions`           | All         | Individual game option toggles (e.g., `<GAMEOPTION_CRITICAL_HIT_PREVIEW />`)                        |
| `MapMultiOptions`       | All         | Multiplayer map options (usually empty in single-player)                                            |
| `MapSingleOptions`      | All         | Single-player map options (usually empty)                                                           |
| `StartingPlayerOptions` | All         | Tutorial/starting option toggles                                                                    |
| `Team`                  | All         | Team assignments per player (`<PlayerTeam>`)                                                        |
| `Difficulty`            | All         | Per-player difficulty (`<PlayerDifficulty>`)                                                        |
| `Nation`                | All         | Per-player nation selection at game start                                                           |
| `Humans`                | All         | Which player slot is human (`<PlayerHuman>`)                                                        |
| `VictoryEnabled`        | All         | Victory conditions enabled (flags only)                                                             |
| `GameContent`           | 2023+, 2025 | DLC content markers (older format than GameContentEnabled)                                          |

---

## Player Element Gaps

**XML has 9 attributes, 85 direct children**

### Currently Parsed

**Attributes:**

- `@ID`, `@Name`, `@Nation`, `@Dynasty`, `@OnlineID`, `@Email`, `@AIControlledToTurn`

**Children:**

- `StateReligion`, `Legitimacy`, `SuccessionGender`, `FounderCharacterID`
- `ChosenHeirID`, `OriginalCapitalCityID`, `TechResearching`, `TimeStockpile`
- `AmbitionDelay`, `TilesPurchased`, `StateReligionChanges`, `TribeMercenaryCount`
- `TurnEnded`
- `TechCount`, `TechProgress`, `TechAvailable`, `TechPassed`, `TechTrashed`, `TechLocked`, `TechTarget`
- `YieldStockpile` (player resources)
- `GoalList` (ambitions/goals)
- `ActiveLaw` (current laws)
- `CouncilCharacter` (council positions)
- `UnitsProduced` (aggregate production)
- Time-series: `PointsHistory`, `MilitaryPowerHistory`, `LegitimacyHistory`, `YieldRateHistory`
- `FamilyOpinionHistory`, `ReligionOpinionHistory`
- `PermanentLogList` (event logs)
- `MemoryList` (player memories)

### Not Parsed

#### Attributes

| Attribute         | Description                     |
| ----------------- | ------------------------------- |
| `@CustomReminder` | Custom reminder text (2025+)    |
| `@Language`       | Player language setting (2025+) |

#### Children (55 total)

| Element                    | Description                                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI`                       | Full AI state including: `AttackTarget`, `ExpansionTileID`, `ExploreTarget`, `HarvestTarget`, `LastSeenCitySiteOwners`, `LastSeenUnits`, `WarPreparingPlayer`, `WarPreparingTurns`, `YieldShortages` |
| `AllEventStoryTurn`        | Complete history of when each story event type occurred (turn numbers keyed by event type)                                                                                                           |
| `AmbitionDecisions`        | Decision history for ambitions                                                                                                                                                                       |
| `BonesTimes`               | Unknown purpose (2025+)                                                                                                                                                                              |
| `BonusCount`               | Comprehensive bonus tracking (hundreds of bonus types with counts)                                                                                                                                   |
| `BuyTileCount`             | Aggregate tile purchase count (player level)                                                                                                                                                         |
| `CompletedGameSaved`       | Flag for game completion (2025+)                                                                                                                                                                     |
| `Dead`                     | Dead player flag (2025+)                                                                                                                                                                             |
| `DecisionList`             | Active decisions                                                                                                                                                                                     |
| `EventClassTurn`           | Event class timings                                                                                                                                                                                  |
| `EventStoryTested`         | Which story events have been tested (2025+)                                                                                                                                                          |
| `ExtraLuxuryCount`         | Extra luxury counts (2025+)                                                                                                                                                                          |
| `Families`                 | Detailed family structure within player                                                                                                                                                              |
| `FamilyEventStoryOption`   | Per-family event options                                                                                                                                                                             |
| `FamilyEventStoryTurn`     | Per-family event timings                                                                                                                                                                             |
| `FamilyHeadID`             | Per-family head character IDs                                                                                                                                                                        |
| `FamilyLawOpinion`         | Per-family opinion on law categories                                                                                                                                                                 |
| `FamilyLuxuryTurn`         | Per-family luxury acquisition turns                                                                                                                                                                  |
| `FamilyReligion`           | Per-family religion affiliations (2025+)                                                                                                                                                             |
| `FamilySeatCityID`         | Per-family seat cities                                                                                                                                                                               |
| `FamilyTurnsNoLeader`      | Per-family leaderless turn counts (2025+)                                                                                                                                                            |
| `Founded`                  | Whether player has founded their nation                                                                                                                                                              |
| `FounderID`                | Founder character ID                                                                                                                                                                                 |
| `GoalStartedCount`         | How many goals have been started                                                                                                                                                                     |
| `GoalsFailed`              | Failed goal count                                                                                                                                                                                    |
| `LastDoTurn`               | Last turn with actions                                                                                                                                                                               |
| `LawClassChangeCount`      | Per-law-category change counts                                                                                                                                                                       |
| `Leaders`                  | List of all leaders this player has had                                                                                                                                                              |
| `MemoryPlayerList`         | Per-player memory list (2022 only, replaced by MemoryList)                                                                                                                                           |
| `MemoryTribeList`          | Per-tribe memory list (2022 only, replaced by MemoryList)                                                                                                                                            |
| `MissionList`              | Active missions                                                                                                                                                                                      |
| `MissionStartedTurn`       | When missions started (2025+)                                                                                                                                                                        |
| `NoCharactersStats`        | Stats when no characters exist (2025+)                                                                                                                                                               |
| `PlayerEventStoryOption`   | Player-level event options                                                                                                                                                                           |
| `PlayerEventStoryTurn`     | Player-level event timings                                                                                                                                                                           |
| `PlayerLuxuryTurn`         | Luxury acquisition timings                                                                                                                                                                           |
| `PlayerOptions`            | Player-specific options (2025+)                                                                                                                                                                      |
| `PopupList`                | Pending popups (2022 only)                                                                                                                                                                           |
| `PopupTechDiscovered`      | Pending tech discovery popups                                                                                                                                                                        |
| `ProjectsProduced`         | Projects produced (aggregate) (2025+)                                                                                                                                                                |
| `RecentAttacks`            | Recent attack tracking (2025+)                                                                                                                                                                       |
| `RecruitLegitimacy`        | Recruitment legitimacy tracking                                                                                                                                                                      |
| `ReligionEventStoryOption` | Per-religion event options                                                                                                                                                                           |
| `ReligionEventStoryTurn`   | Per-religion event timings                                                                                                                                                                           |
| `ResourceRevealed`         | Resources revealed on map                                                                                                                                                                            |
| `StartTurnCities`          | Cities at turn start                                                                                                                                                                                 |
| `StartingTileIDs`          | Starting tile positions                                                                                                                                                                              |
| `StateReligionChangeCount` | State religion change count                                                                                                                                                                          |
| `TheologyEstablishedCount` | Theology establishment counts                                                                                                                                                                        |
| `TribeEventStoryOption`    | Per-tribe event options                                                                                                                                                                              |
| `TribeEventStoryTurn`      | Per-tribe event timings                                                                                                                                                                              |
| `TribeFoundCount`          | Tribe founding counts                                                                                                                                                                                |
| `TribeLuxuryTurn`          | Tribe luxury timings                                                                                                                                                                                 |
| `TributeList`              | Active tribute arrangements (2025+)                                                                                                                                                                  |
| `TurnLogList`              | Per-turn event logs                                                                                                                                                                                  |
| `TurnSummary`              | Turn summary data                                                                                                                                                                                    |
| `TurnSummaryReady`         | Flag for turn summary (2025+)                                                                                                                                                                        |
| `UnitsProducedTurn`        | Per-unit-type production timings                                                                                                                                                                     |

---

## Character Element Gaps

**XML has 7 attributes, 39 direct children**

### Currently Parsed

**Attributes:**

- `@ID`, `@FirstName`, `@Gender`, `@BirthTurn`, `@Player`

**Children:**

- `DeathTurn`, `DeathReason`, `BirthFatherID`, `BirthMotherID`, `BirthCityID`
- `Family`, `Nation`, `Religion`, `Tribe`
- `Cognomen`, `Portrait`
- `XP`, `Level`
- `LeaderTurn` (as BecameLeaderTurn)
- `TraitTurn`, `Spouses`, `RelationshipList`
- `Rating`, `Stat`

### Not Parsed

#### Attributes

| Attribute    | Description                   |
| ------------ | ----------------------------- |
| `@Character` | Secondary character reference |
| `@Seed`      | Character random seed         |

#### Children (24 total)

| Element            | Description                                                   |
| ------------------ | ------------------------------------------------------------- |
| `AbdicateTurn`     | Turn character abdicated (schema has field, not parsed)       |
| `Abdicated`        | Whether character abdicated (flag)                            |
| `Children`         | List of child character IDs                                   |
| `CognomenHistory`  | History of cognomen changes                                   |
| `Courtier`         | Courtier status/type                                          |
| `DeadCouncil`      | Council position held when dead                               |
| `EventStoryOption` | Event story option selections (2022 only)                     |
| `EventStoryTexts`  | Story event text associations                                 |
| `EventStoryTurn`   | Character-specific event timings                              |
| `FatherID`         | Current legal father (may differ from birth father)           |
| `Infertile`        | Infertility flag                                              |
| `MotherID`         | Current legal mother                                          |
| `NameType`         | Name localization type                                        |
| `NationTurn`       | Turn joined nation                                            |
| `Nickname`         | Character nickname (2022 only)                                |
| `NicknameType`     | Nickname localization type                                    |
| `Retired`          | Retirement status                                             |
| `Royal`            | Royal status flag                                             |
| `SafeTurn`         | Safe turn (2022 only)                                         |
| `Suffix`           | Name suffix                                                   |
| `Title`            | Character title                                               |
| `Trait`            | Character traits (2022 only - replaced by TraitTurn)          |
| `WasFamilyHead`    | Whether was ever family head (schema has field, not parsed)   |
| `WasReligionHead`  | Whether was ever religion head (schema has field, not parsed) |

---

## City Element Gaps

**XML has 5 attributes, 39 direct children**

### Currently Parsed

**Attributes:**

- `@ID`, `@Player`, `@TileID`, `@Founded`, `@Family`

**Children:**

- `Name`, `Citizens`, `Capital` (presence flag)
- `GovernorID`
- `HurryCivicsCount`, `HurryMoneyCount`, `HurryTrainingCount`, `HurryPopulationCount`
- `SpecialistProducedCount`, `GrowthCount`, `UnitProductionCounts`
- `BuyTileCount`, `FirstPlayer`, `LastPlayer`
- `BuildQueue` (production queue)
- `CompletedBuild` (projects completed)
- `ProjectCount` (project counts)
- `LuxuryTurn` (luxury imports)
- `YieldProgress`, `YieldOverflow`, `YieldLevel`
- `TeamCulture`, `TeamHappinessLevel`
- `AgentTurn`, `AgentCharacterID`, `AgentTileID`
- `Religion`

### Not Parsed

| Element                      | Description                                              |
| ---------------------------- | -------------------------------------------------------- |
| `AssimilateTurns`            | Turn counts for cultural assimilation                    |
| `CapturePlayer`              | Player who captured city                                 |
| `CaptureTurns`               | Turn counts for capture progress                         |
| `CapturedCapital`            | Whether this was a captured capital                      |
| `CitizensQueue`              | Citizens waiting/queued                                  |
| `Damage`                     | City damage level                                        |
| `EventStoryTurn`             | City-specific event timings                              |
| `GovernorTurn`               | When governor was assigned (2022 only - removed in 2025) |
| `HurryOrdersCount`           | Orders hurry count (distinct from other hurry types)     |
| `PlayerFamily`               | Per-player family associations                           |
| `RaidedTurn`                 | When city was raided                                     |
| `TeamCultureStep`            | Culture step progress per team                           |
| `TeamDiscontentLevel`        | Current discontent level per team (2022 only)            |
| `TeamDiscontentLevelHighest` | Highest discontent level reached per team (2022 only)    |
| `Tribe`                      | Tribal affiliation (for tribal cities)                   |

---

## Tile Element Gaps

**XML has 1 attribute (`@ID`), 46 possible direct children (varies by version)**

### Currently Parsed

- `@ID` (attr), coordinates calculated from ID
- `Terrain`, `Height`, `Vegetation`
- `RiverW`, `RiverSW`, `RiverSE`
- `Resource`, `Improvement`, `ImprovementPillaged`, `ImprovementDisabled`, `ImprovementTurnsLeft`
- `Specialist`, `Road` (presence flag)
- `OwnerHistory` (for current owner derivation)
- `TribeSite`, `Religion`
- `InitSeed`, `TurnSeed`
- `TerrainHistory`, `VegetationHistory` (tile changes)
- `RevealedTurn`, `RevealedOwner` (visibility)
- `Unit` elements (parsed separately)

### Not Parsed

| Element                         | Description                                                |
| ------------------------------- | ---------------------------------------------------------- |
| `Boundary`                      | Boundary marker/type                                       |
| `CitySite`                      | City site marker                                           |
| `CityTerritory`                 | City territory association                                 |
| `ElementName`                   | Named element on tile                                      |
| `Elevation`                     | Tile elevation (2022 only - replaced by Height)            |
| `HarvestTurn`                   | Turn when tile was harvested                               |
| `HeightHistory`                 | History of height changes (2025+)                          |
| `ImprovementBuildTurnsLeft`     | Remaining turns for improvement under construction         |
| `ImprovementBuildTurnsOriginal` | Original build time when construction started              |
| `ImprovementCost`               | Cost of improvement                                        |
| `ImprovementDevelopTurns`       | Development turns for improvement                          |
| `ImprovementPillageTurns`       | Turns remaining for pillage repair (2025+)                 |
| `ImprovementUnitTurns`          | Unit-related improvement turns                             |
| `Latitude`                      | Tile latitude (2022 only)                                  |
| `Metadata`                      | Tile metadata (unknown structure) (2025+)                  |
| `OrigUrbanOwner`                | Original urban tile owner                                  |
| `Pillaged`                      | Pillage status (distinct from ImprovementPillaged) (2025+) |
| `RecentAttacks`                 | Recent attack tracking (2022 only)                         |
| `RegrowthTurn`                  | Turn when vegetation regrows                               |
| `Revealed`                      | Per-team reveal status                                     |
| `RevealedCity`                  | Per-team revealed city info                                |
| `RevealedCitySite`              | Per-team revealed city site                                |
| `RevealedCityTerritory`         | Per-team revealed city territory                           |
| `RevealedHeight`                | Per-team revealed height (2025+)                           |
| `RevealedImprovement`           | Per-team revealed improvement                              |
| `RevealedOwnerTribe`            | Per-team revealed tribal owner (2025+)                     |
| `RevealedRoad`                  | Per-team revealed road status                              |
| `RevealedTerrain`               | Per-team revealed terrain                                  |
| `RevealedVegetation`            | Per-team revealed vegetation                               |
| `VisibleTime`                   | Visibility timing data                                     |
| `WasVisibleThisTurn`            | Per-team current turn visibility                           |

---

## Unit Element Gaps

**XML has 5 attributes, 30 direct children**

### Currently Parsed

**Attributes:**

- `@ID`, `@Type`, `@Player`, `@Tribe`, `@Seed`

**Children:**

- `XP`, `Level`, `CreateTurn`, `Facing`, `OriginalPlayer`
- `TurnsSinceLastMove`, `Gender`, `Sleep` (flag), `CurrentFormation`
- `Promotions`, `PromotionsAvailable`
- `BonusEffectUnits` (effects with stacks)
- `PlayerFamily` (family associations)

### Not Parsed

| Element          | Description                                   |
| ---------------- | --------------------------------------------- |
| `AI`             | Unit AI state                                 |
| `Anchored`       | Naval anchor status                           |
| `Cooldown`       | Cooldown flags                                |
| `CooldownTurns`  | Cooldown turn counts                          |
| `CriticalHit`    | Critical hit state (2025+)                    |
| `Damage`         | Current damage                                |
| `EventStoryTurn` | Unit-specific event timings (2025+)           |
| `GeneralID`      | Commanding general character ID               |
| `LevelPromotion` | Level-up promotion choice                     |
| `March`          | March/movement state (2025+)                  |
| `NameType`       | Named unit type (for unique units) (2025+)    |
| `OriginalTribe`  | Original tribal affiliation                   |
| `Pass`           | Pass/skip action state                        |
| `QueueList`      | Action queue                                  |
| `RaidTurn`       | When unit participated in raid                |
| `Religion`       | Unit's religion (for religious units) (2025+) |
| `Sentry`         | Sentry/guard mode (2022 only)                 |
| `TurnSteps`      | Steps taken this turn                         |
| `Unlimbered`     | Artillery unlimbered state (2025+)            |

---

## Tribe Element Gaps

### Currently Parsed

- `ID` (attr)
- `LeaderID` (leader character)
- `Religion`

### Not Parsed

| Element                                           | Description                                   |
| ------------------------------------------------- | --------------------------------------------- |
| `AI`                                              | Tribe AI state (full AI decision-making data) |
| Allied player derivation from `Game/TeamAlliance` |

---

## Game Element Gaps

### Currently Parsed

- `Turn` (current turn)
- `ReligionFounded`, `ReligionFounder`, `ReligionHeadID`, `ReligionHolyCity` (religion data)
- `TeamDiplomacy`, `TeamConflictTurn`, `TeamDiplomacyTurn`, `TeamDiplomacyBlock`, `TeamWarScore` (diplomacy)
- `TribeDiplomacy`, `TribeConflictTurn`, `TribeDiplomacyTurn`, `TribeDiplomacyBlock`, `TribeWarScore` (tribe diplomacy)
- `YieldPriceHistory` (market prices)

### Not Parsed

| Element                       | Description                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EventStoryMaxPriority`       | Event priority cap                                                                                                                                           |
| `FamilyClass`                 | Per-family class assignments for all nations                                                                                                                 |
| `GameOver`                    | Game completion flag                                                                                                                                         |
| `ImprovementDisabled`         | Globally disabled improvements (wonders built)                                                                                                               |
| `MapSize`                     | Redundant with root attribute                                                                                                                                |
| `NextCharacterID`             | ID counter for new characters                                                                                                                                |
| `NextCityID`                  | ID counter for new cities                                                                                                                                    |
| `NextOccurrenceID`            | ID counter for occurrences                                                                                                                                   |
| `NextUnitID`                  | ID counter for new units                                                                                                                                     |
| `NoFogOfWar`                  | Fog of war disabled flag                                                                                                                                     |
| `Occurrences`                 | Active occurrences (calamities): `OccurrenceData` with `Type`, `StartTurn`, `EndTurn`, `StartTile`, `TileIDs`, `PlayerIDs`, `ReligionIDs`, `ModifiedTileIDs` |
| `PlayerTurn`                  | Whose turn it is                                                                                                                                             |
| `ReligionTheology`            | Established theologies per religion                                                                                                                          |
| `Seed`                        | Game-level RNG seed                                                                                                                                          |
| `TeamAlliance`                | Team alliance structures                                                                                                                                     |
| `TeamContact`                 | First contact tracking between teams                                                                                                                         |
| `TeamTurn`                    | Team turn tracking                                                                                                                                           |
| `TileImprovementDynamicTexts` | Custom wonder/improvement names                                                                                                                              |
| `TribeContact`                | First contact with tribes                                                                                                                                    |
| `TurnTime`                    | Turn timer value                                                                                                                                             |
| `YieldPrice`                  | Current yield prices (distinct from history)                                                                                                                 |
| `YieldPriceTurn`              | Price change turn tracking                                                                                                                                   |

---

## Configuration Elements

These elements store game configuration that's largely redundant with Root attributes but in a per-player format:

| Element                         | Description                        |
| ------------------------------- | ---------------------------------- |
| `Team/PlayerTeam`               | Team assignment per player slot    |
| `Difficulty/PlayerDifficulty`   | Difficulty per player slot         |
| `Development/PlayerDevelopment` | Development level per player slot  |
| `Nation/PlayerNation`           | Nation per player slot             |
| `Dynasty/PlayerDynasty`         | Dynasty per player slot            |
| `Archetype/LeaderArchetype`     | Starting archetype per player slot |
| `Humans/PlayerHuman`            | Human flag per player slot         |
| `StartingPlayerOptions`         | Tutorial and starting toggles      |
| `GameOptions`                   | Individual game option toggles     |
| `VictoryEnabled`                | Victory condition flags            |
| `GameContent`                   | DLC content flags (older format)   |
| `GameContentEnabled`            | DLC content flags (newer format)   |
| `OccurrenceLevels`              | Calamity frequency settings        |

---

## Version-Specific Elements

### Added in Later Versions (2023+)

| Element       | First Seen | Notes                       |
| ------------- | ---------- | --------------------------- |
| `Archetype`   | 2023       | Leader archetype selections |
| `Dynasty`     | 2023       | Dynasty selections          |
| `GameContent` | 2023       | DLC content tracking        |

### Added in 2025 Versions

| Category  | Element                                                            | Notes                            |
| --------- | ------------------------------------------------------------------ | -------------------------------- |
| Root      | `@ForceMarch`                                                      | Force march game setting         |
| Root      | `@HumanDevelopment`                                                | Separate human development level |
| Root      | `@MapEdgesSafe`                                                    | Map edges safe setting           |
| Root      | `@MapSeed`                                                         | Map generation seed              |
| Root      | `@MaxLatitude` / `@MinLatitude`                                    | Map latitude bounds              |
| Root      | `@MinCitySiteDistance`                                             | Minimum city site distance       |
| Root      | `@SaveDate`                                                        | Save timestamp                   |
| Root      | `@VictoryPointModifier`                                            | VP modifier setting              |
| Top-level | `Development`                                                      | Per-player development level     |
| Top-level | `GameContentEnabled`                                               | New DLC flag format              |
| Top-level | `OccurrenceLevels`                                                 | Calamity frequency configuration |
| Player    | `@CustomReminder`, `@Dynasty`, `@Language`                         | New attributes                   |
| Player    | `BonesTimes`, `CompletedGameSaved`, `Dead`                         | New fields                       |
| Player    | `EventStoryTested`, `ExtraLuxuryCount`                             | New fields                       |
| Player    | `FamilyOpinionHistory`, `FamilyReligion`, `FamilyTurnsNoLeader`    | New fields                       |
| Player    | `Legitimacy`, `LegitimacyHistory`, `MemoryList`                    | New fields                       |
| Player    | `MilitaryPowerHistory`, `MissionStartedTurn`, `NoCharactersStats`  | New fields                       |
| Player    | `OriginalCapitalCityID`, `PlayerOptions`, `PointsHistory`          | New fields                       |
| Player    | `ProjectsProduced`, `RecentAttacks`, `ReligionOpinionHistory`      | New fields                       |
| Player    | `StateReligion`, `TechLocked`, `TimeStockpile`                     | New fields                       |
| Player    | `TributeList`, `TurnSummaryReady`, `YieldRateHistory`              | New fields                       |
| Tile      | `HeightHistory`, `ImprovementPillageTurns`, `InitSeed`, `TurnSeed` | New fields                       |
| Tile      | `Metadata`, `Pillaged`, `RevealedHeight`, `RevealedOwnerTribe`     | New fields                       |
| Tile      | `TerrainHistory`, `VegetationHistory`                              | New fields                       |
| Unit      | `BonusEffectUnits`, `CriticalHit`, `EventStoryTurn`                | New fields                       |
| Unit      | `March`, `NameType`, `OriginalPlayer`                              | New fields                       |
| Unit      | `Religion`, `TurnsSinceLastMove`, `Unlimbered`                     | New fields                       |

### Deprecated/Removed in Newer Versions

| Category  | Element                      | Last Seen | Notes                              |
| --------- | ---------------------------- | --------- | ---------------------------------- |
| Root      | `@MapSize`                   | 2022      | Moved to Game element              |
| Root      | `@NumAutosaves`              | 2022      | Removed                            |
| Player    | `MemoryPlayerList`           | 2022      | Replaced by `MemoryList`           |
| Player    | `MemoryTribeList`            | 2022      | Replaced by `MemoryList`           |
| Player    | `PopupList`                  | 2022      | Removed                            |
| Character | `EventStoryOption`           | 2022      | Removed                            |
| Character | `Nickname`                   | 2022      | Replaced by `NicknameType`         |
| Character | `SafeTurn`                   | 2022      | Removed                            |
| Character | `Trait`                      | 2022      | Replaced by `TraitTurn`            |
| City      | `GovernorTurn`               | 2022      | Removed                            |
| City      | `TeamDiscontentLevel`        | 2022      | Removed                            |
| City      | `TeamDiscontentLevelHighest` | 2022      | Removed                            |
| City      | `UnitProductionCount`        | 2022      | Replaced by `UnitProductionCounts` |
| Tile      | `Elevation`                  | 2022      | Replaced by `Height`               |
| Tile      | `Latitude`                   | 2022      | Removed                            |
| Tile      | `RecentAttacks`              | 2022      | Removed                            |
| Unit      | `Sentry`                     | 2022      | Removed                            |

---

## Summary Statistics

Based on exhaustive XML analysis:

| Category                         | Total in XML | Currently Parsed | Not Parsed | Coverage |
| -------------------------------- | ------------ | ---------------- | ---------- | -------- |
| Root Attributes                  | ~30          | 22               | 8          | ~73%     |
| Top-Level Elements               | 20+          | 6                | 14+        | ~30%     |
| Player (9 attrs, 85 children)    | 94           | ~30              | ~64        | ~32%     |
| Character (7 attrs, 39 children) | 46           | ~20              | ~26        | ~43%     |
| City (5 attrs, 39 children)      | 44           | ~25              | ~19        | ~57%     |
| Tile (1 attr, 46 children)       | 47           | ~18              | ~29        | ~38%     |
| Unit (5 attrs, 30 children)      | 35           | ~16              | ~19        | ~46%     |
| Tribe (1 attr, 3 children)       | 4            | 3                | 1          | ~75%     |
| Game (38 children)               | 38           | ~12              | ~26        | ~32%     |

### Notes

1. **Coverage percentages are calculated from direct fields only.** Nested structures within fields (e.g., hundreds of bonus types within `BonusCount`) are counted as single fields.

2. **Many unparsed fields are auxiliary data:**
   - AI state (`AI` elements in Player, Unit, Tribe)
   - Fog-of-war state (`Revealed*` fields in Tile)
   - Event system timing (`EventStory*` fields)
   - ID counters (`Next*ID` fields in Game)

3. **Version-specific fields:** Some fields exist only in older (2022) or newer (2025+) versions. The XML format has evolved significantly.

4. **Key unparsed analytical data:**
   - `BonusCount` - comprehensive game statistics
   - `Occurrences` - calamity tracking
   - `Leaders` - leader history
   - `Children` - character family trees (inverse of parents)
   - `ImprovementBuildTurns*` - construction progress
   - `Damage` - unit/city damage state
   - `GeneralID` - unit commanding officer
