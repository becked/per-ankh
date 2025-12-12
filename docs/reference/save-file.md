# Old World Save File Format - Complete Reference Guide

This document provides a comprehensive technical reference for the save file format used by Old World, developed by Mohawk Games. All information is derived from the game's source code located in the `Reference/Source` directory and XML configuration files in `Reference/XML`.

---

## Table of Contents

1. [File Format Overview](#1-file-format-overview)
2. [XML Document Structure](#2-xml-document-structure)
3. [Root Element Attributes](#3-root-element-attributes)
4. [Game State Element](#4-game-state-element)
5. [Player Elements](#5-player-elements)
6. [Character Elements](#6-character-elements)
7. [City Elements](#7-city-elements)
8. [Tile Elements](#8-tile-elements)
9. [Unit Elements](#9-unit-elements)
10. [Yield Types Reference](#10-yield-types-reference)
11. [Terrain and Height Types](#11-terrain-and-height-types)
12. [Nation Types](#12-nation-types)
13. [Family Classes](#13-family-classes)
14. [Religion Types](#14-religion-types)
15. [Character Ratings](#15-character-ratings)
16. [Opinion System](#16-opinion-system)
17. [Victory Types](#17-victory-types)
18. [Difficulty Levels](#18-difficulty-levels)
19. [Map Sizes](#19-map-sizes)
20. [Event Logging System](#20-event-logging-system)
21. [History Tracking](#21-history-tracking)
22. [Constants and Multipliers](#22-constants-and-multipliers)

---

## 1. File Format Overview

### Container Format
Old World save files are **ZIP archives** containing a single UTF-8 encoded XML file.

| Property | Value |
|----------|-------|
| Compressed Extension | `.zip` |
| Uncompressed Extension | `.xml` |
| Default Format | Compressed (ZIP) |
| Encoding | UTF-8 with BOM |
| Compression | Standard ZIP deflate |

### File Naming Convention

From `Source/Base/Game/GameCore/Constants.cs`:

```
FILE_PREFIX = "OW"
UNCOMPRESSED_SAVE_EXTENSION = ".xml"
COMPRESSED_SAVE_EXTENSION = ".zip"
SAVE_EXTENSION = ".zip"  (default)
```

**Naming Patterns:**

| Save Type | Pattern | Example |
|-----------|---------|---------|
| Standard | `OW-{Nation}-Year{Turn}-{Timestamp}.zip` | `OW-Rome-Year166-2024-01-15-14-30-25.zip` |
| Quick Save | `OW-Save-Quick.zip` or `OW-Save-Quick-{N}.zip` | `OW-Save-Quick-1.zip` |
| Auto Save | `OW-Save-Auto-{N}.zip` | `OW-Save-Auto-3.zip` |
| Map File | `OW-Map-Auto.xml` | `OW-Map-Auto.xml` |

### Save Directory Structure

```
OldWorld/
├── Saves/
│   ├── Auto/           # Rotating auto-saves (configurable slots)
│   ├── Quick/          # Quick save files
│   ├── Completed/      # End-game saves
│   ├── Multiplayer/    # Cloud/multiplayer saves
│   └── Scenarios/      # Scenario saves
```

---

## 2. XML Document Structure

### Top-Level Hierarchy

```xml
<?xml version="1.0" encoding="utf-8"?>
<Root {game configuration attributes}>
  <!-- Game setup elements -->
  <Team>...</Team>
  <Difficulty>...</Difficulty>
  <Nation>...</Nation>
  <Humans>...</Humans>
  <GameOptions>...</GameOptions>
  <VictoryEnabled>...</VictoryEnabled>
  <MapMultiOptions>...</MapMultiOptions>

  <!-- Core game state -->
  <Game>...</Game>

  <!-- Entity collections -->
  <Player>...</Player>           <!-- Multiple: one per player -->
  <City>...</City>               <!-- Multiple: all cities in game -->
  <Character>...</Character>     <!-- Multiple: all characters -->
  <Tribe>...</Tribe>             <!-- Multiple: barbarian tribes -->
  <Tile>...</Tile>               <!-- Multiple: MapWidth × MapHeight tiles -->
    <!-- Units are CHILDREN of Tile elements, not top-level -->
</Root>
```

---

## 3. Root Element Attributes

The `<Root>` element contains all global game configuration as XML attributes.

### Version and Identity

| Attribute | Type | Description |
|-----------|------|-------------|
| `Version` | string | Game version (e.g., `Version: 1.0.78921`) |
| `GameId` | GUID | Unique game identifier |
| `GameName` | string | Custom game name (often empty) |
| `SaveDate` | string | Save timestamp (e.g., `30 July 2025`) - 2025+ only |
| `FirstSeed` | long | Initial random seed for game generation |
| `MapSeed` | long | Map generation seed - 2025+ only |

### Map Configuration

| Attribute | Type | Description |
|-----------|------|-------------|
| `MapWidth` | int | Map width in tiles (e.g., `82`) |
| `MapClass` | enum | Map type (see below) |
| `MapSize` | enum | See Map Sizes section |
| `MapPath` | string | Path to custom map file (empty for generated) |
| `MinLatitude` | int | Map latitude bounds - 2025+ only |
| `MaxLatitude` | int | Map latitude bounds - 2025+ only |
| `MapEdgesSafe` | bool | Whether map edges are safe - 2025+ only |
| `MinCitySiteDistance` | int | Minimum tiles between city sites - 2025+ only |

**Map Classes:**
- `MAPCLASS_MapScriptContinent`
- `MAPCLASS_MapScriptSeaside`
- `MAPCLASS_MapScriptInlandSea`
- `MAPCLASS_MapScriptMediterranean`
- `MAPCLASS_MapScriptArchipelago`
- `MAPCLASS_MapScriptHighlands`

### Game Mode Settings

| Attribute | Type | Description |
|-----------|------|-------------|
| `GameMode` | enum | `SINGLE_PLAYER`, `NETWORK`, `PLAY_BY_CLOUD`, `HOTSEAT` |
| `TurnStyle` | enum | `TURNSTYLE_STRICT`, `TURNSTYLE_TIGHT`, `TURNSTYLE_LOOSE` |
| `TurnTimer` | enum | `TURNTIMER_NONE`, `TURNTIMER_SLOW`, `TURNTIMER_MEDIUM`, `TURNTIMER_FAST` |
| `TurnScale` | enum | `TURNSCALE_YEAR` |
| `TeamNation` | enum | `TEAMNATION_GAME_UNIQUE` |

### AI and Difficulty Settings

| Attribute | Type | Description |
|-----------|------|-------------|
| `OpponentLevel` | enum | AI aggressiveness (`OPPONENTLEVEL_PEACEFUL` to `OPPONENTLEVEL_RUTHLESS`) |
| `TribeLevel` | enum | Barbarian strength (`TRIBELEVEL_WEAK` to `TRIBELEVEL_RAGING`) |
| `EventLevel` | enum | Event frequency (`EVENTLEVEL_NONE` to `EVENTLEVEL_HIGH`) |
| `Mortality` | enum | Character death rate (`MORTALITY_NONE` to `MORTALITY_HIGH`) |
| `Development` | enum | Starting development (`DEVELOPMENT_FLEDGLING` to `DEVELOPMENT_ESTABLISHED`) |
| `HumanDevelopment` | enum | Human player development - 2025+ only |
| `Advantage` | enum | AI advantage level (`ADVANTAGE_NONE`, `ADVANTAGE_MODERATE`, etc.) |
| `ForceMarch` | enum | Force march setting - 2025+ only |
| `VictoryPointModifier` | enum | VP modifier - 2025+ only |

**Note:** Per-player difficulty is set in the `<Difficulty>` child element, not as a root attribute.

### Succession Settings

| Attribute | Type | Description |
|-----------|------|-------------|
| `SuccessionGender` | enum | See below |
| `SuccessionOrder` | enum | See below |

**SuccessionGender Values:**
- `SUCCESSIONGENDER_AGNATIC` - Males only
- `SUCCESSIONGENDER_AGNATIC_COGNATIC` - Males preferred
- `SUCCESSIONGENDER_ABSOLUTE_COGNATIC` - Equal inheritance
- `SUCCESSIONGENDER_ENATIC_COGNATIC` - Females preferred
- `SUCCESSIONGENDER_ENATIC` - Females only

**SuccessionOrder Values:**
- `SUCCESSIONORDER_PRIMOGENITURE` - Eldest child
- `SUCCESSIONORDER_ULTIMOGENITURE` - Youngest child
- `SUCCESSIONORDER_SENIORITY` - Oldest family member

---

## 4. Game State Element

The `<Game>` element contains the current game state:

```xml
<Game>
  <Seed>18046197664196916347</Seed>
  <Turn>120</Turn>
  <TurnTime>0</TurnTime>
  <GameOver />
  <TeamTurn>0</TeamTurn>
  <PlayerTurn>0</PlayerTurn>

  <!-- ID Counters -->
  <NextUnitID>1156</NextUnitID>
  <NextCityID>51</NextCityID>
  <NextCharacterID>585</NextCharacterID>
  <NextOccurrenceID>25</NextOccurrenceID>

  <!-- Map info (duplicated from Root for convenience) -->
  <MapClass>MAPCLASS_MapScriptContinent</MapClass>
  <MapSize>MAPSIZE_LARGE</MapSize>

  <!-- Victory tracking -->
  <TeamVictories>
    <Team Victory="VICTORY_POINTS">0</Team>
  </TeamVictories>
  <TeamVictoriesCompleted>
    <Team Victory="VICTORY_POINTS">0</Team>
  </TeamVictoriesCompleted>

  <!-- Market prices -->
  <YieldPrice>
    <YIELD_ORDERS>1415630</YIELD_ORDERS>
    <YIELD_FOOD>114231</YIELD_FOOD>
    <YIELD_IRON>170784</YIELD_IRON>
    <YIELD_STONE>136950</YIELD_STONE>
    <YIELD_WOOD>180950</YIELD_WOOD>
  </YieldPrice>
  <YieldPriceTurn>...</YieldPriceTurn>
  <YieldPriceHistory>...</YieldPriceHistory>

  <!-- Religion state -->
  <ReligionFounded>
    <RELIGION_ZOROASTRIANISM>25</RELIGION_ZOROASTRIANISM>
    <RELIGION_JUDAISM>42</RELIGION_JUDAISM>
  </ReligionFounded>
  <ReligionFounder>
    <RELIGION_ZOROASTRIANISM>0</RELIGION_ZOROASTRIANISM>
  </ReligionFounder>
  <ReligionHeadID>
    <RELIGION_ZOROASTRIANISM>125</RELIGION_ZOROASTRIANISM>
  </ReligionHeadID>
  <ReligionHolyCity>
    <RELIGION_ZOROASTRIANISM>5</RELIGION_ZOROASTRIANISM>
  </ReligionHolyCity>
  <ReligionTheology>...</ReligionTheology>

  <!-- Family assignments per nation -->
  <FamilyClass>
    <FAMILY_JULII>FAMILYCLASS_STATESMEN</FAMILY_JULII>
    <FAMILY_CLAUDII>FAMILYCLASS_CHAMPIONS</FAMILY_CLAUDII>
  </FamilyClass>

  <!-- Built wonders (disabled for other players) -->
  <ImprovementDisabled>
    <IMPROVEMENT_COLOSSEUM />
  </ImprovementDisabled>

  <!-- Team diplomacy -->
  <TeamAlliance>...</TeamAlliance>
  <TeamContact>...</TeamContact>
  <TeamDiplomacy>...</TeamDiplomacy>
  <TeamConflictTurn>...</TeamConflictTurn>
  <TeamDiplomacyTurn>...</TeamDiplomacyTurn>
  <TeamWarScore>...</TeamWarScore>

  <!-- Tribe diplomacy -->
  <TribeContact>...</TribeContact>
  <TribeDiplomacy>...</TribeDiplomacy>
  <TribeConflictTurn>...</TribeConflictTurn>
  <TribeDiplomacyTurn>...</TribeDiplomacyTurn>
  <TribeWarScore>...</TribeWarScore>

  <!-- Active calamities/events -->
  <Occurrences>...</Occurrences>
</Game>
```

### Key Game State Fields

| Element | Type | Description |
|---------|------|-------------|
| `Seed` | ulong | Current RNG seed |
| `Turn` | int | Current game turn (1 turn = 1 year in-game) |
| `GameOver` | empty | Present if game has ended |
| `TeamTurn` | int | Current team's turn |
| `PlayerTurn` | int | Current player's turn |
| `NextUnitID` | int | Next available unit ID |
| `NextCityID` | int | Next available city ID |
| `NextCharacterID` | int | Next available character ID |
| `NextOccurrenceID` | int | Next available occurrence ID |
| `TeamVictories` | complex | Victory progress per team |
| `YieldPrice` | dict | Current market prices for goods |
| `ImprovementDisabled` | list | Wonders that have been built (unavailable) |

---

## 5. Player Elements

Each player (human or AI) has a `<Player>` element.

### Player Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `ID` | int | Player index (0-based) |
| `Name` | string | Player display name |
| `Email` | string | Player email (multiplayer) |
| `OnlineID` | string | Steam/platform ID (human players only) |
| `Language` | enum | Player language setting |
| `Nation` | enum | Civilization (e.g., `NATION_AKSUM`) |
| `Dynasty` | enum | Starting dynasty (e.g., `DYNASTY_KALEB`) |
| `AIControlledToTurn` | int | Turn until AI takes control (0 = human) |

### Identifying Human Players

- Human players have a non-empty `OnlineID` attribute
- AI players have empty or missing `OnlineID`
- Player index 0 is typically the first human player

### Player Child Elements

```xml
<Player
    ID="0"
    Name=""
    Email=""
    OnlineID="76561199101298499"
    Language="LANGUAGE_ENGLISH"
    Nation="NATION_AKSUM"
    Dynasty="DYNASTY_KALEB"
    AIControlledToTurn="0">

  <!-- Capital and leadership -->
  <OriginalCapitalCityID>0</OriginalCapitalCityID>
  <FounderID>4</FounderID>
  <ChosenHeirID>-1</ChosenHeirID>
  <Leaders>
    <ID>4</ID>
    <ID>85</ID>
    <ID>203</ID>
  </Leaders>

  <!-- Turn and game state -->
  <LastDoTurn>120</LastDoTurn>
  <StartTurnCities>14</StartTurnCities>
  <Legitimacy>281</Legitimacy>
  <Founded />
  <CompletedGameSaved />

  <!-- Current research and religion -->
  <TechResearching>TECH_COHORTS</TechResearching>
  <StateReligion>RELIGION_ZOROASTRIANISM</StateReligion>
  <SuccessionGender>SUCCESSIONGENDER_ABSOLUTE_COGNATIC</SuccessionGender>

  <!-- Starting locations -->
  <StartingTileIDs>
    <Tile>3402</Tile>
    <Tile>4059</Tile>
  </StartingTileIDs>

  <!-- Resource stockpiles -->
  <YieldStockpile>
    <YIELD_CIVICS>16909</YIELD_CIVICS>
    <YIELD_TRAINING>20000</YIELD_TRAINING>
    <YIELD_MONEY>29708</YIELD_MONEY>
    <YIELD_ORDERS>316</YIELD_ORDERS>
    <YIELD_FOOD>15103</YIELD_FOOD>
    <YIELD_IRON>3557</YIELD_IRON>
    <YIELD_STONE>6765</YIELD_STONE>
    <YIELD_WOOD>4091</YIELD_WOOD>
  </YieldStockpile>

  <!-- Technology progress (research points) -->
  <TechProgress>
    <TECH_COHORTS>5611</TECH_COHORTS>
    <TECH_INFANTRY_SQUARE>16116</TECH_INFANTRY_SQUARE>
  </TechProgress>

  <!-- Technologies researched -->
  <TechCount>
    <TECH_IRONWORKING>1</TECH_IRONWORKING>
    <TECH_STONECUTTING>1</TECH_STONECUTTING>
    <TECH_TRAPPING>1</TECH_TRAPPING>
  </TechCount>

  <!-- Law change counts -->
  <LawClassChangeCount>
    <LAWCLASS_EPICS_EXPLORATION>1</LAWCLASS_EPICS_EXPLORATION>
    <LAWCLASS_SLAVERY_FREEDOM>1</LAWCLASS_SLAVERY_FREEDOM>
  </LawClassChangeCount>

  <!-- Resources player has discovered -->
  <ResourceRevealed>
    <RESOURCE_IRON>5</RESOURCE_IRON>
    <RESOURCE_HORSE>13</RESOURCE_HORSE>
  </ResourceRevealed>

  <!-- Ambitions started -->
  <GoalStartedCount>
    <GOAL_10_KILLS>1</GOAL_10_KILLS>
    <GOAL_30_POPULATION>1</GOAL_30_POPULATION>
  </GoalStartedCount>

  <!-- Missions and bonuses received -->
  <MissionStartedTurn>...</MissionStartedTurn>
  <BonusCount>...</BonusCount>

  <!-- History data (see History section) -->
  <PointsHistory>...</PointsHistory>
  <YieldRateHistory>...</YieldRateHistory>
  <MilitaryPowerHistory>...</MilitaryPowerHistory>
  <LegitimacyHistory>...</LegitimacyHistory>
  <FamilyOpinionHistory>...</FamilyOpinionHistory>
</Player>
```

### Key Player Elements

| Element | Description |
|---------|-------------|
| `FounderID` | Character ID of dynasty founder |
| `Leaders` | List of character IDs who have ruled (succession history) |
| `Legitimacy` | Current legitimacy score |
| `StateReligion` | Player's state religion |
| `TechResearching` | Current technology being researched |
| `YieldStockpile` | Current resource amounts |
| `TechProgress` | Research points toward technologies |
| `TechCount` | Technologies researched (1 = completed) |
| `GoalStartedCount` | Ambitions that have been started |

---

## 6. Character Elements

Characters represent rulers, heirs, courtiers, and other notable people.

### Character Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `ID` | int | Unique character ID |
| `BirthTurn` | int | Turn of birth (negative = before game start) |
| `Player` | int | Owner player ID (-1 for tribal characters) |
| `Gender` | enum | `GENDER_MALE` or `GENDER_FEMALE` |
| `FirstName` | enum | Name type (e.g., `NAME_SOFYA`) |
| `Seed` | ulong | Character's random seed |

### Character Structure

```xml
<Character
    ID="4"
    BirthTurn="-17"
    Player="0"
    Gender="GENDER_FEMALE"
    FirstName="NAME_SOFYA"
    Seed="18046197664149768981">

  <!-- Identity -->
  <NicknameType>GENDERED_TEXT_NICKNAME_THE_YOUNGER</NicknameType>
  <Portrait>CHARACTER_PORTRAIT_AKSUM_LEADER_FEMALE_14</Portrait>
  <NameType>NAME_SOFYA</NameType>
  <Cognomen>COGNOMEN_SETTLER</Cognomen>

  <!-- Experience -->
  <XP>102</XP>
  <Level>2</Level>

  <!-- Life events -->
  <DeathTurn>23</DeathTurn>
  <DeathReason>TEXT_TRAIT_ILL_F</DeathReason>
  <LeaderTurn>1</LeaderTurn>
  <NationTurn>1</NationTurn>

  <!-- Status flags -->
  <Royal />
  <Infertile />

  <!-- Affiliations -->
  <Nation>NATION_AKSUM</Nation>
  <Family>FAMILY_AKSUM_BARYA</Family>
  <Tribe>TRIBE_GAULS</Tribe>

  <!-- Family connections -->
  <FatherID>12</FatherID>
  <MotherID>15</MotherID>
  <BirthFatherID>12</BirthFatherID>
  <BirthMotherID>15</BirthMotherID>
  <BirthCityID>0</BirthCityID>

  <!-- Ratings (can be negative) -->
  <Rating>
    <RATING_WISDOM>5</RATING_WISDOM>
    <RATING_CHARISMA>0</RATING_CHARISMA>
    <RATING_COURAGE>-1</RATING_COURAGE>
    <RATING_DISCIPLINE>0</RATING_DISCIPLINE>
  </Rating>

  <!-- Statistics -->
  <Stat>
    <STAT_CITY_FOUNDED>3</STAT_CITY_FOUNDED>
    <STAT_TECH_DISCOVERED>7</STAT_TECH_DISCOVERED>
    <STAT_YEARS_REIGNED>22</STAT_YEARS_REIGNED>
    <STAT_UNIT_MILITARY_KILLED>9</STAT_UNIT_MILITARY_KILLED>
  </Stat>

  <!-- Traits with acquisition turn -->
  <TraitTurn>
    <TRAIT_SCHEMER_ARCHETYPE>1</TRAIT_SCHEMER_ARCHETYPE>
    <TRAIT_INSPIRING>10</TRAIT_INSPIRING>
    <TRAIT_INTELLIGENT>1</TRAIT_INTELLIGENT>
  </TraitTurn>

  <!-- Event stories experienced -->
  <EventStoryTurn>
    <EVENTSTORY_SACRED_TOMB>4</EVENTSTORY_SACRED_TOMB>
  </EventStoryTurn>

  <!-- Note: Role assignments are tracked on the other entity:
       - Units have GeneralID pointing to the commanding character
       - Cities have GovernorID pointing to characters -->

  <!-- Relationships -->
  <RelationshipList>
    <RelationshipData>
      <Type>RELATIONSHIP_FRIEND</Type>
      <CharacterID>42</CharacterID>
    </RelationshipData>
  </RelationshipList>

  <!-- Cognomen (title) history -->
  <CognomenHistory>
    <T45>COGNOMEN_THE_GREAT</T45>
    <T80>COGNOMEN_THE_WISE</T80>
  </CognomenHistory>
</Character>
```

### Character Turn Fields

| Field | Value When Not Set | Description |
|-------|-------------------|-------------|
| `BirthTurn` | varies | Turn character was born |
| `DeathTurn` | `int.MinValue` (-2147483648) | Turn character died |
| `LeaderTurn` | `int.MinValue` | Turn character became ruler |
| `AbdicateTurn` | `int.MinValue` | Turn character abdicated |

### Trait Types (Archetypes)

From `Reference/XML/Infos/familyClass.xml`:
- `TRAIT_TACTICIAN_ARCHETYPE`
- `TRAIT_JUDGE_ARCHETYPE`
- `TRAIT_ORATOR_ARCHETYPE`
- `TRAIT_SCHOLAR_ARCHETYPE`
- `TRAIT_BUILDER_ARCHETYPE`
- `TRAIT_SCHEMER_ARCHETYPE`
- `TRAIT_COMMANDER_ARCHETYPE`
- `TRAIT_ZEALOT_ARCHETYPE`
- `TRAIT_DIPLOMAT_ARCHETYPE`
- `TRAIT_HERO_ARCHETYPE`

---

## 7. City Elements

Cities represent urban centers controlled by players.

### City Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `ID` | int | Unique city ID |
| `TileID` | int | Map tile location |
| `Player` | int | Owner player ID |
| `Family` | enum | Controlling family |
| `Founded` | int | Turn city was founded |

### City Structure

```xml
<City
    ID="0"
    TileID="3484"
    Player="0"
    Family="FAMILY_AKSUM_BARYA"
    Founded="1">

  <NameType>CITYNAME_ADULIS</NameType>
  <Capital />

  <!-- Leadership -->
  <GovernorID>350</GovernorID>

  <!-- Population -->
  <GrowthCount>11</GrowthCount>
  <Citizens>8</Citizens>
  <SpecialistProducedCount>12</SpecialistProducedCount>

  <!-- Ownership history -->
  <FirstPlayer>0</FirstPlayer>
  <LastPlayer>0</LastPlayer>

  <!-- Production progress and overflow -->
  <YieldProgress>
    <YIELD_GROWTH>1301</YIELD_GROWTH>
    <YIELD_CULTURE>8884</YIELD_CULTURE>
    <YIELD_HAPPINESS>1170</YIELD_HAPPINESS>
  </YieldProgress>
  <YieldOverflow>
    <YIELD_GROWTH>243</YIELD_GROWTH>
    <YIELD_CIVICS>588</YIELD_CIVICS>
  </YieldOverflow>

  <!-- Completed projects -->
  <ProjectCount>
    <PROJECT_TREASURY_1>1</PROJECT_TREASURY_1>
    <PROJECT_FORUM_4>1</PROJECT_FORUM_4>
    <PROJECT_ARCHIVE_1>1</PROJECT_ARCHIVE_1>
  </ProjectCount>

  <!-- Produced units -->
  <UnitProductionCounts>
    <UNIT_SETTLER>7</UNIT_SETTLER>
    <UNIT_WORKER>4</UNIT_WORKER>
  </UnitProductionCounts>

  <!-- Luxury resources providing happiness -->
  <LuxuryTurn />

  <!-- Agent/spy tracking (P.{player_id}) -->
  <AgentTurn>
    <P.3>0</P.3>
  </AgentTurn>
  <AgentCharacterID />
  <AgentTileID />

  <!-- Culture per team (T.{team_id}) -->
  <TeamCultureStep>
    <T.0>1</T.0>
  </TeamCultureStep>
  <TeamCulture>
    <T.0>CULTURE_LEGENDARY</T.0>
  </TeamCulture>

  <!-- Happiness level per team -->
  <TeamHappinessLevel>
    <T.0>10</T.0>
    <T.1>-1</T.1>
  </TeamHappinessLevel>

  <!-- Religion presence -->
  <Religion>
    <RELIGION_ZOROASTRIANISM />
    <RELIGION_PAGAN_AKSUM />
  </Religion>

  <!-- Family per player (P.{player_id}) -->
  <PlayerFamily>
    <P.0>FAMILY_AKSUM_BARYA</P.0>
  </PlayerFamily>

  <!-- Event stories that have occurred in this city -->
  <EventStoryTurn>
    <EVENTSTORY_TRADE_SILK>119</EVENTSTORY_TRADE_SILK>
    <EVENTSTORY_WONDER_HAGIA_SOPHIA>99</EVENTSTORY_WONDER_HAGIA_SOPHIA>
  </EventStoryTurn>

  <!-- Current build queue -->
  <BuildQueue>
    <QueueInfo>
      <Build>BUILD_UNIT</Build>
      <Type>UNIT_SHOTELAI</Type>
      <Data>-1</Data>
      <Progress>814</Progress>
      <YieldCost>
        <YIELD_IRON>200</YIELD_IRON>
      </YieldCost>
    </QueueInfo>
  </BuildQueue>
</City>
```

### Key City Elements

| Element | Description |
|---------|-------------|
| `Capital` | Empty element if city is capital |
| `GovernorID` | Character ID of governor (-1 if none) |
| `GrowthCount` | Number of growth cycles completed |
| `Citizens` | Current population count |
| `FirstPlayer` | Player who originally founded city |
| `LastPlayer` | Most recent owner before current |

---

## 8. Tile Elements

Tiles represent individual hexagonal map cells.

### Tile Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `ID` | int | Unique tile ID (0 to MapWidth×MapHeight-1) |

### Coordinate Calculation

```
X = TileID % MapWidth
Y = TileID / MapWidth  (integer division)
```

### Tile Structure

```xml
<Tile ID="1026">
  <!-- Border marker -->
  <Boundary />

  <!-- Terrain -->
  <Terrain>TERRAIN_LUSH</Terrain>
  <Height>HEIGHT_FLAT</Height>
  <Vegetation>VEGETATION_TREES</Vegetation>

  <!-- Resources -->
  <Resource>RESOURCE_IRON</Resource>

  <!-- Improvements -->
  <Improvement>IMPROVEMENT_FARM</Improvement>
  <ImprovementBuildTurnsOriginal>3</ImprovementBuildTurnsOriginal>
  <ImprovementBuildTurnsLeft>0</ImprovementBuildTurnsLeft>
  <ImprovementCost>
    <YIELD_WOOD>18</YIELD_WOOD>
  </ImprovementCost>

  <!-- Specialist working this tile -->
  <Specialist>SPECIALIST_FARMER</Specialist>

  <!-- Territory -->
  <CityTerritory>36</CityTerritory>

  <!-- Tribal/barbarian site -->
  <TribeSite>TRIBE_BARBARIANS</TribeSite>

  <!-- Road (empty element = road present) -->
  <Road />

  <!-- Rivers (boolean: 0 or 1 for each hex edge) -->
  <RiverW>1</RiverW>
  <RiverSW>0</RiverSW>
  <RiverSE>1</RiverSE>

  <!-- Seeds -->
  <InitSeed>3268377015542681982</InitSeed>
  <TurnSeed>221329921854821505</TurnSeed>

  <!-- Religion presence (empty or with religion children) -->
  <Religion>
    <RELIGION_ZOROASTRIANISM />
    <RELIGION_PAGAN_AKSUM />
  </Religion>

  <!-- Family associations per player -->
  <PlayerFamily>
    <P.0>FAMILY_AKSUM_BARYA</P.0>
  </PlayerFamily>

  <!-- Ownership history (see History section) -->
  <OwnerHistory>
    <T27>1</T27>
  </OwnerHistory>

  <!-- Terrain/vegetation change history -->
  <TerrainHistory>
    <T0>TERRAIN_LUSH</T0>
    <T62>TERRAIN_URBAN</T62>
  </TerrainHistory>
  <VegetationHistory>
    <T0>VEGETATION_TREES</T0>
    <T58>NONE</T58>
  </VegetationHistory>

  <!-- Visibility per team (T = team ID) -->
  <RevealedTurn>
    <T0>100</T0>
    <T1>94</T1>
  </RevealedTurn>
  <Revealed>
    <Team>0</Team>
    <Team>1</Team>
  </Revealed>

  <!-- Units on this tile (see Unit Elements section) -->
  <Unit ID="1099" Type="UNIT_SWORDSMAN" Player="1" ...>
    ...
  </Unit>
</Tile>
```

**Note:** In older save files (2022), tiles may have `<Latitude>` and `<Elevation>` (integer) instead of `<Height>` (enum). These fields were removed/replaced in later versions.

---

## 9. Unit Elements

Units represent military forces, workers, and settlers. **Units are children of Tile elements**, not top-level elements.

### Unit Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `ID` | int | Unique unit ID |
| `Type` | enum | Unit type (e.g., `UNIT_WARRIOR`) |
| `Player` | int | Owner player ID (-1 for barbarians) |
| `Tribe` | enum | Tribe affiliation (barbarians only) |
| `Seed` | ulong | Unit's random seed |

### Unit Structure

```xml
<Tile ID="1026">
  <!-- ... tile data ... -->
  <Unit
    ID="1099"
    Type="UNIT_SWORDSMAN"
    Player="1"
    Tribe="NONE"
    Seed="18046197663297639751">

    <!-- General commanding this unit -->
    <GeneralID>576</GeneralID>

    <!-- Experience and level -->
    <XP>50</XP>
    <Level>2</Level>

    <!-- Timeline -->
    <CreateTurn>114</CreateTurn>
    <TurnsSinceLastMove>11</TurnsSinceLastMove>

    <!-- Direction unit is facing -->
    <Facing>E</Facing>

    <!-- Origin -->
    <OriginalPlayer>1</OriginalPlayer>

    <!-- Gender (for units that have it, e.g., workers) -->
    <Gender>GENDER_FEMALE</Gender>

    <!-- Cooldown state -->
    <Cooldown>COOLDOWN_GENERAL</Cooldown>
    <CooldownTurns>1</CooldownTurns>

    <!-- Raid participation -->
    <RaidTurn />

    <!-- Family associations per player (P.{player_id}) -->
    <PlayerFamily>
      <P.1>FAMILY_CYPSELID</P.1>
    </PlayerFamily>

    <!-- Movement queue -->
    <QueueList />

    <!-- Acquired promotions -->
    <Promotions>
      <PROMOTION_COMBAT1 />
    </Promotions>

    <!-- Available promotions to choose -->
    <PromotionsAvailable>
      <PROMOTION_COMBAT2 />
      <PROMOTION_TOUGH />
      <PROMOTION_HECKLER />
    </PromotionsAvailable>

    <!-- Bonus effects with stack counts -->
    <BonusEffectUnits />

    <!-- AI state (for AI-controlled units) -->
    <AI>
      <Target>1001</Target>
      <TargetData>38</TargetData>
      <Role>IMPROVE</Role>
    </AI>
  </Unit>
</Tile>
```

### Barbarian Units

Barbarian units have:
- `Player="-1"`
- `Tribe` attribute set (e.g., `TRIBE_SCYTHIANS`)
- No `OriginalPlayer` (or negative value)

---

## 10. Yield Types Reference

From `Reference/XML/Infos/yield.xml`:

### Global Yields (Nation-wide)

| Yield | Description | Stockpiled |
|-------|-------------|------------|
| `YIELD_MONEY` | Gold/Treasury | Yes |
| `YIELD_CIVICS` | Administration points | Yes |
| `YIELD_TRAINING` | Military training points | Yes |
| `YIELD_ORDERS` | Action points per turn | Yes |
| `YIELD_SCIENCE` | Research points | No |

### City Yields (Per-city)

| Yield | Description | Threshold-based |
|-------|-------------|-----------------|
| `YIELD_GROWTH` | Population growth | Yes |
| `YIELD_CULTURE` | Border expansion | No |
| `YIELD_HAPPINESS` | City happiness | Yes |
| `YIELD_DISCONTENT` | Reduces happiness | N/A |

### Material Yields (Tradeable goods)

| Yield | Description | Tradeable |
|-------|-------------|-----------|
| `YIELD_FOOD` | Food supply | Yes |
| `YIELD_IRON` | Iron ore | Yes |
| `YIELD_STONE` | Building stone | Yes |
| `YIELD_WOOD` | Lumber | Yes |

### Derived Yield

| Yield | Description |
|-------|-------------|
| `YIELD_MAINTENANCE` | Costs subtracted from Money |

### Yield Multiplier

From source code: `YIELDS_MULTIPLIER = 10`

All yield values in save files are multiplied by 10 for precision. Divide by 10 when displaying to users.

---

## 11. Terrain and Height Types

### Terrain Types

From `Reference/XML/Infos/terrain.xml`:

| Terrain | Description | Movement Cost | City Site |
|---------|-------------|---------------|-----------|
| `TERRAIN_WATER` | Ocean/Lake | 9 | No |
| `TERRAIN_URBAN` | City tile | 9 | Yes |
| `TERRAIN_LUSH` | Fertile grassland | 9 | Yes |
| `TERRAIN_TEMPERATE` | Standard land | 9 | Yes |
| `TERRAIN_ARID` | Dry plains | 9 | Yes |
| `TERRAIN_SAND` | Desert | 18 | No |
| `TERRAIN_TUNDRA` | Cold plains | 9 | No |
| `TERRAIN_MARSH` | Wetlands | 18 | No |

### Height Types

From `Reference/XML/Infos/height.xml`:

| Height | Description | Impassable | City Site |
|--------|-------------|------------|-----------|
| `HEIGHT_OCEAN` | Deep water | No | No |
| `HEIGHT_COAST` | Coastal water | No | No |
| `HEIGHT_LAKE` | Freshwater | No | No |
| `HEIGHT_FLAT` | Flat terrain | No | No |
| `HEIGHT_HILL` | Elevated terrain | No | Yes |
| `HEIGHT_MOUNTAIN` | Mountain peak | Yes | No |
| `HEIGHT_VOLCANO` | Active volcano | Yes | No |

### Height Effects

| Height | Movement | Range | Reveal | Border |
|--------|----------|-------|--------|--------|
| `HEIGHT_FLAT` | +0 | +0 | +1 | +0 |
| `HEIGHT_HILL` | +9 | +1 | +2 | +200 |
| `HEIGHT_MOUNTAIN` | N/A | +2 | +3 | -1 |

---

## 12. Nation Types

From `Reference/XML/Infos/nation.xml`:

| Nation | Starting Techs |
|--------|----------------|
| `NATION_ROME` | `TECH_TRAPPING`, `TECH_LABOR_FORCE` |
| `NATION_GREECE` | `TECH_TRAPPING`, `TECH_STONECUTTING` |
| `NATION_EGYPT` | `TECH_TRAPPING`, `TECH_ADMINISTRATION` |
| `NATION_PERSIA` | `TECH_TRAPPING`, `TECH_LABOR_FORCE` |
| `NATION_CARTHAGE` | `TECH_TRAPPING`, `TECH_POTTERY` |
| `NATION_BABYLONIA` | `TECH_TRAPPING`, `TECH_ADMINISTRATION` |
| `NATION_ASSYRIA` | `TECH_TRAPPING`, `TECH_MILITARY_DRILL` |
| `NATION_HITTITE` | `TECH_TRAPPING`, `TECH_MILITARY_DRILL` |
| `NATION_KUSH` | `TECH_TRAPPING`, `TECH_LABOR_FORCE` |
| `NATION_AKSUM` | `TECH_TRAPPING`, `TECH_LABOR_FORCE`, `TECH_ADMINISTRATION` |

### Nation-Specific Elements

Each nation has unique:
- Dynasties (ruling families)
- First names (male and female)
- City names
- Unit restrictions
- Character portraits

---

## 13. Family Classes

From `Reference/XML/Infos/familyClass.xml`:

| Family Class | Focus | Preferred Yield | Dowry |
|--------------|-------|-----------------|-------|
| `FAMILYCLASS_LANDOWNERS` | Territory | Wood | Wood |
| `FAMILYCLASS_CHAMPIONS` | Military | Training | Training |
| `FAMILYCLASS_STATESMEN` | Government | Civics | Civics |
| `FAMILYCLASS_PATRONS` | Culture | Stone | Stone |
| `FAMILYCLASS_CLERICS` | Religion | Orders | Orders |
| `FAMILYCLASS_SAGES` | Science | Science | Science |
| `FAMILYCLASS_TRADERS` | Commerce | Money | Money |
| `FAMILYCLASS_ARTISANS` | Production | Iron | Iron |
| `FAMILYCLASS_RIDERS` | Cavalry | Orders | Orders |
| `FAMILYCLASS_HUNTERS` | Ranged | Food | Food |

### Family Opinion Modifiers

Each family class has opinion modifiers for:
- Leader traits (adult, married, foreign spouse)
- City counts (most/fewest)
- Military size (largest/smallest)
- Improvements built
- Laws enacted
- Luxuries available
- Specialists employed

---

## 14. Religion Types

From `Reference/XML/Infos/religion.xml`:

| Religion | Spread Rate | Requirements |
|----------|-------------|--------------|
| `RELIGION_ZOROASTRIANISM` | 5% | 2 Acolyte specialists |
| `RELIGION_JUDAISM` | 5% | 2 Rancher specialists, `TECH_LABOR_FORCE` |
| `RELIGION_CHRISTIANITY` | 10% | Judaism present, 12 citizens, `TECH_METAPHYSICS` |
| `RELIGION_MANICHAEISM` | 15% | Zoroastrianism + Christianity |

### Religion State Elements

```xml
<ReligionFounded>
  <RELIGION_ZOROASTRIANISM>25</RELIGION_ZOROASTRIANISM>
</ReligionFounded>
<ReligionHeadID>
  <RELIGION_ZOROASTRIANISM>125</RELIGION_ZOROASTRIANISM>
</ReligionHeadID>
<ReligionHolyCity>
  <RELIGION_ZOROASTRIANISM>5</RELIGION_ZOROASTRIANISM>
</ReligionHolyCity>
```

---

## 15. Character Ratings

From `Reference/XML/Infos/rating.xml`:

| Rating | Color | Court Yield | Governor Bonus | Combat Effect |
|--------|-------|-------------|----------------|---------------|
| `RATING_WISDOM` | Blue | +10 Science | +2% Science | +1% Critical |
| `RATING_CHARISMA` | Purple | +20 Civics | +2% Civics | +1% Defense |
| `RATING_COURAGE` | Red | +40 Training | +2% Training | +1% Attack |
| `RATING_DISCIPLINE` | Gold | +80 Money | +2% Money | +1 XP/turn |

### Rating Scale

Ratings range from **0 to 10**, with:
- 0-2: Poor
- 3-4: Below Average
- 5: Average
- 6-7: Above Average
- 8-10: Excellent

---

## 16. Opinion System

### Character Opinion Levels

From `Reference/XML/Infos/opinionCharacter.xml`:

| Opinion | Threshold | Birth Mod | Mission Cost | Rate Mod | Strength |
|---------|-----------|-----------|--------------|----------|----------|
| `OPINIONCHARACTER_FURIOUS` | -200 | -100% | +100% | -200% | -20% |
| `OPINIONCHARACTER_ANGRY` | -100 | -50% | +50% | -100% | -10% |
| `OPINIONCHARACTER_UPSET` | -1 | -25% | +25% | -50% | -5% |
| `OPINIONCHARACTER_CAUTIOUS` | 99 | 0 | 0 | 0 | 0 |
| `OPINIONCHARACTER_PLEASED` | 199 | +25% | -25% | +50% | +5% |
| `OPINIONCHARACTER_FRIENDLY` | ∞ | +50% | -50% | +100% | +10% |

### Family Opinion Levels

From `Reference/XML/Infos/opinionFamily.xml`:

| Opinion | Threshold | Effects |
|---------|-----------|---------|
| `OPINIONFAMILY_FURIOUS` | -200 | Rebel risk, production penalties |
| `OPINIONFAMILY_ANGRY` | -100 | Discontent increase |
| `OPINIONFAMILY_UPSET` | -1 | Minor penalties |
| `OPINIONFAMILY_CAUTIOUS` | 99 | Neutral |
| `OPINIONFAMILY_PLEASED` | 199 | Minor bonuses |
| `OPINIONFAMILY_FRIENDLY` | ∞ | Full bonuses |

---

## 17. Victory Types

From `Reference/XML/Infos/victory.xml`:

| Victory | Description | Requirement |
|---------|-------------|-------------|
| `VICTORY_POINTS` | Score victory | Reach VP threshold |
| `VICTORY_DOUBLE` | Double score | Have 2× opponent's score |
| `VICTORY_AMBITION` | Complete ambitions | Finish 10 ambitions |
| `VICTORY_TIME` | Survive | Last 200 turns |
| `VICTORY_CONQUEST` | Military | Eliminate all opponents |
| `VICTORY_ALLIANCE` | Diplomatic | All players allied |

### Victory Configuration

```xml
<VictoryEnabled>
  <VICTORY_POINTS />
  <VICTORY_DOUBLE />
  <VICTORY_AMBITION />
  <VICTORY_TIME />
  <VICTORY_CONQUEST />
</VictoryEnabled>
```

---

## 18. Difficulty Levels

From `Reference/XML/Infos/difficulty.xml`:

| Difficulty | Starting Resources | Empty Sites | Raid Chance |
|------------|-------------------|-------------|-------------|
| `DIFFICULTY_ABLE` | High | 100% | 0% |
| `DIFFICULTY_GOOD` | Medium-High | 75% | 0% |
| `DIFFICULTY_STRONG` | Medium | 50% | 1% |
| `DIFFICULTY_NOBLE` | Medium | 50% | 1% |
| `DIFFICULTY_GLORIOUS` | Low-Medium | 25% | 3% |
| `DIFFICULTY_MAGNIFICENT` | Low | 25% | 3% |
| `DIFFICULTY_GREAT` | Very Low | 25% | 4% |

### Starting Stockpiles by Difficulty

| Difficulty | Civics | Training | Orders | Food | Wood | Iron | Stone |
|------------|--------|----------|--------|------|------|------|-------|
| Able | 400 | 400 | 8 | 400 | 400 | 400 | 400 |
| Good | 300 | 300 | 8 | 200 | 200 | 200 | 200 |
| Strong | 300 | 300 | 8 | 100 | 100 | 100 | 100 |
| Noble | 200 | 200 | 8 | 100 | 100 | 100 | 100 |
| Glorious | 200 | 200 | 8 | 50 | 50 | 50 | 50 |
| Magnificent | 100 | 100 | 8 | 50 | 50 | 50 | 50 |
| Great | 100 | 100 | 8 | 0 | 0 | 0 | 0 |

---

## 19. Map Sizes

From `Reference/XML/Infos/mapSize.xml`:

| Size | Tiles | Opponents | Max Opponents | VP Goal |
|------|-------|-----------|---------------|---------|
| `MAPSIZE_SMALLEST` (Duel) | 2,025 | 2 | 4 | 20 |
| `MAPSIZE_TINY` | 3,364 | 3 | 6 | 50 |
| `MAPSIZE_SMALL` | 4,356 | 4 | 8 | 75 |
| `MAPSIZE_MEDIUM` | 5,476 | 5 | 10 | 100 |
| `MAPSIZE_LARGE` | 6,724 | 6 | 12 | 125 |
| `MAPSIZE_HUGE` | 8,100 | 7 | 14 | 150 |

### Approximate Dimensions

| Size | Approximate Width × Height |
|------|---------------------------|
| Duel | 45 × 45 |
| Tiny | 58 × 58 |
| Small | 66 × 66 |
| Medium | 74 × 74 |
| Large | 82 × 82 |
| Huge | 90 × 90 |

---

## 20. Event Logging System

### GameLogType (from `Source/Base/Game/GameCore/Enums.cs`)

The `GameLogType` enum defines all log event types:

**Summary & General:**
- `TURN_SUMMARY` - Turn summary
- `POPUP_MESSAGE` - Popup notification
- `PREHISTORY` - Pre-game events
- `ACHIEVEMENT` - Achievement unlocked
- `DO_BONUS` - Bonus applied

**Goals:**
- `GOAL_STARTED` - Ambition started
- `GOAL_FINISHED` - Ambition completed
- `GOAL_FAILED` - Ambition failed

**Religion:**
- `RELIGION_FOUNDED` - New religion founded
- `RELIGION_SPREAD` - Religion spread to city
- `PROJECT_SPREAD` - Religious project completed
- `THEOLOGY_ESTABLISHED` - Theology adopted

**Diplomacy:**
- `TRIBE_CONTACT` - First contact with tribe
- `TRIBE_DIPLOMACY` - Diplomatic action with tribe
- `TEAM_CONTACT` - First contact with nation
- `TEAM_DIPLOMACY` - Diplomatic action with nation

**Technology:**
- `TECH_DISCOVERED` - Technology researched
- `LAW_ADOPTED` - Law enacted

**Economy:**
- `RESOURCE_SHORTFALL` - Resource shortage
- `GIFT_ORDERS` - Orders gifted
- `MAX_ORDERS` - Order cap reached
- `MAX_CIVICS` - Civics cap reached
- `MAX_TRAINING` - Training cap reached

**Characters:**
- `GENERAL_INJURY` - General injured
- `COURTIER` - Courtier event
- `CHARACTER_ADULT` - Character came of age
- `CHARACTER_BIRTH` - Character born
- `CHARACTER_MARRIAGE` - Character married
- `CHARACTER_DEATH` - Character died
- `CHARACTER_SUCCESSION` - New ruler

**Cities:**
- `CITY_FOUNDED` - New city founded
- `CITY_EVENT` - City event
- `CITY_PRODUCTION` - Production completed
- `CITY_CANCELLED` - Production cancelled
- `CITY_WARNING` - City warning
- `CITY_DAMAGED` - City took damage
- `CITY_ATTACKED` - City attacked
- `CITY_BREACHED` - City walls breached
- `CITY_CAPTURED` - City captured
- `CITY_RAZED` - City destroyed

**Units:**
- `UNIT_SEEN` - Unit spotted
- `UNIT_REVEALED` - Unit revealed
- `UNIT_REBELLED` - Unit rebelled
- `UNIT_ATTACKED` - Unit attacked
- `UNIT_DAMAGED` - Unit damaged
- `UNIT_LOST` - Unit lost
- `UNIT_CAPTURED` - Unit captured
- `UNIT_KILLED` - Unit killed

**Improvements:**
- `CAMP_DESTROYED` - Barbarian camp destroyed
- `IMPROVEMENT_FINISHED` - Improvement completed
- `IMPROVEMENT_PILLAGED` - Improvement pillaged
- `WONDER_ACTIVITY` - Wonder progress

### Log Data Structure

```xml
<PermanentLogList>
  <LogData>
    <Text><color=#ac5996>Writing</color> discovered</Text>
    <Type>TECH_DISCOVERED</Type>
    <Data1>TECH_WRITING</Data1>
    <Data2></Data2>
    <Data3></Data3>
    <Turn>15</Turn>
    <TeamTurn>-1</TeamTurn>
  </LogData>
</PermanentLogList>
```

### Log Categories

| Category | Types Included |
|----------|---------------|
| `SUMMARY` | Turn summary, popup messages |
| `COMBAT` | Unit attacks, injuries, deaths |
| `OCCURRENCE` | Random events |
| `ECONOMY` | Resource changes |
| `SCIENCE` | Tech discoveries |
| `GOAL` | Ambition progress |
| `RELIGION` | Religious events |
| `EVENT` | Story events |

---

## 21. History Tracking

Players maintain turn-by-turn history data using `T{turn}` element naming.

### PointsHistory

Victory points over time:
```xml
<PointsHistory>
  <T1>0</T1>
  <T2>1</T2>
  <T5>5</T5>
  <T10>12</T10>
</PointsHistory>
```

### YieldRateHistory

Production rates per yield type:
```xml
<YieldRateHistory>
  <YIELD_GROWTH>
    <T1>100</T1>
    <T2>120</T2>
    <T5>180</T5>
  </YIELD_GROWTH>
  <YIELD_CIVICS>
    <T1>50</T1>
    <T2>55</T2>
  </YIELD_CIVICS>
  <YIELD_TRAINING>...</YIELD_TRAINING>
  <YIELD_SCIENCE>...</YIELD_SCIENCE>
  <YIELD_MONEY>...</YIELD_MONEY>
</YieldRateHistory>
```

### MilitaryPowerHistory

Combined military strength:
```xml
<MilitaryPowerHistory>
  <T1>100</T1>
  <T5>250</T5>
  <T10>500</T10>
</MilitaryPowerHistory>
```

### LegitimacyHistory

Ruler legitimacy (0-200 scale):
```xml
<LegitimacyHistory>
  <T1>100</T1>
  <T5>105</T5>
  <T10>115</T10>
</LegitimacyHistory>
```

### FamilyOpinionHistory

Opinion with each family:
```xml
<FamilyOpinionHistory>
  <FAMILY_JULII>
    <T1>100</T1>
    <T5>95</T5>
    <T10>110</T10>
  </FAMILY_JULII>
  <FAMILY_CLAUDII>
    <T1>100</T1>
    <T5>80</T5>
  </FAMILY_CLAUDII>
</FamilyOpinionHistory>
```

### ReligionOpinionHistory

Same structure as family opinions for religious organizations.

### Tile OwnerHistory

Territory control changes per tile:
```xml
<OwnerHistory>
  <T1>0</T1>      <!-- Player 0 owns from turn 1 -->
  <T45>1</T45>    <!-- Player 1 captured on turn 45 -->
  <T82>0</T82>    <!-- Player 0 recaptured on turn 82 -->
</OwnerHistory>
```

Special values:
- `-1` = Neutral (no owner)
- `0+` = Player ID

---

## 22. Constants and Multipliers

From `Source/Base/Game/GameCore/Constants.cs`:

### Value Multipliers

| Constant | Value | Usage |
|----------|-------|-------|
| `YIELDS_MULTIPLIER` | 10 | All yield values |
| `PRICE_MULTIPLIER` | 1000 | Prices and costs |
| `PERCENT_MULTIPLIER` | 100 | Percentage values |

### File Constants

| Constant | Value |
|----------|-------|
| `FILE_PREFIX` | `"OW"` |
| `QUICK_SAVE` | `"OW-Save-Quick.zip"` |
| `QUICK_SAVE_FORMAT` | `"OW-Save-Quick-{0}.zip"` |
| `AUTO_SAVE_FORMAT` | `"OW-Save-Auto-{0}.zip"` |
| `END_SAVE_FORMAT` | `"OW-{0}-Year{1}-{2}.zip"` |
| `MAP_SAVE` | `"OW-Map-Auto.xml"` |

### ID Special Values

| Value | Meaning |
|-------|---------|
| `-1` | None / Invalid / Neutral |
| `0+` | Valid entity ID |
| `int.MinValue` (-2147483648) | Turn not set / Never occurred |

---

## Appendix A: Source File References

All source code is located in:
`Reference/Source/Base/Game/GameCore/`

| File | Contents |
|------|----------|
| `Enums.cs` | All enumeration types |
| `Constants.cs` | Game constants and file naming |
| `Game.cs` | Game state management |
| `Player.cs` | Player data structures |
| `Character.cs` | Character data and logic |
| `City.cs` | City data and production |
| `Tile.cs` | Tile data and terrain |
| `Unit.cs` | Unit data and combat |
| `Infos.cs` | Info/data loading system |

## Appendix B: XML Data Files

All XML data files are in:
`Reference/XML/Infos/`

Key files:
- `yield.xml` - Yield definitions
- `terrain.xml` - Terrain types
- `height.xml` - Height/elevation types
- `nation.xml` - Civilizations
- `familyClass.xml` - Family types
- `religion.xml` - Religions
- `rating.xml` - Character ratings
- `opinionCharacter.xml` - Character opinion levels
- `opinionFamily.xml` - Family opinion levels
- `victory.xml` - Victory conditions
- `difficulty.xml` - Difficulty settings
- `mapSize.xml` - Map size definitions
