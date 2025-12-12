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

### Version Information

| Attribute | Type | Description |
|-----------|------|-------------|
| `Version` | string | Game version (e.g., `Version: 1.0.80522`) |
| `GameId` | GUID | Unique game identifier |
| `FirstSeed` | long | Initial random seed for game generation |

### Map Configuration

| Attribute | Type | Values |
|-----------|------|--------|
| `MapWidth` | int | Map width in tiles (e.g., `76`) |
| `MapClass` | enum | See Map Classes below |
| `MapSize` | enum | See Map Sizes section |
| `MapAspectRatio` | enum | `MAPASPECTRATIO_STANDARD`, `MAPASPECTRATIO_WIDE`, etc. |
| `MapPath` | string | Path to custom map file (empty for generated maps) |

**Map Classes (from `MapClassType` enum):**
- `MAPCLASS_InlandSea`
- `MAPCLASS_Seaside`
- `MAPCLASS_Continents`
- `MAPCLASS_Mediterranean`
- `MAPCLASS_Archipelago`
- `MAPCLASS_Bay`
- `MAPCLASS_Highlands`
- `MAPCLASS_Desert`
- `MAPCLASS_Donut`
- `MAPCLASS_PlayerIslands`

### Game Mode Settings

| Attribute | Type | Values |
|-----------|------|--------|
| `GameMode` | enum | `SINGLE_PLAYER`, `NETWORK`, `LAN`, `PLAY_BY_CLOUD`, `HOTSEAT`, `SERVER` |
| `TurnStyle` | enum | `TURNSTYLE_STRICT`, `TURNSTYLE_TIGHT`, `TURNSTYLE_LOOSE` |
| `TurnTimer` | enum | `TURNTIMER_NONE`, `TURNTIMER_SLOW`, `TURNTIMER_MEDIUM`, `TURNTIMER_FAST` |

### Difficulty and AI Settings

| Attribute | Type | Values |
|-----------|------|--------|
| `Difficulty` | enum | See Difficulty section |
| `OpponentLevel` | enum | `OPPONENTLEVEL_PEACEFUL` through `OPPONENTLEVEL_RUTHLESS` |
| `TribeLevel` | enum | `TRIBELEVEL_WEAK` through `TRIBELEVEL_FIERCE` |
| `EventLevel` | enum | `EVENTLEVEL_NONE`, `EVENTLEVEL_LOW`, `EVENTLEVEL_MODERATE`, `EVENTLEVEL_HIGH` |
| `Mortality` | enum | `MORTALITY_NONE`, `MORTALITY_LOW`, `MORTALITY_STANDARD`, `MORTALITY_HIGH` |
| `Development` | enum | `DEVELOPMENT_FLEDGLING`, `DEVELOPMENT_DEVELOPING`, `DEVELOPMENT_ADVANCED`, `DEVELOPMENT_ESTABLISHED` |

### Succession Settings

| Attribute | Type | Values |
|-----------|------|--------|
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
  <Seed>948676584249414482</Seed>
  <Turn>166</Turn>
  <TurnTime>0</TurnTime>
  <GameOver />
  <TeamTurn>0</TeamTurn>
  <PlayerTurn>0</PlayerTurn>
  <WinnerTeam>0</WinnerTeam>
  <WinnerVictory>2</WinnerVictory>

  <!-- ID Counters -->
  <NextUnitID>1101</NextUnitID>
  <NextCityID>50</NextCityID>
  <NextCharacterID>625</NextCharacterID>

  <!-- Global settings -->
  <MinCitySiteDistance>8</MinCitySiteDistance>

  <!-- Market prices -->
  <YieldPrice>
    <YIELD_ORDERS>250</YIELD_ORDERS>
    <YIELD_FOOD>80</YIELD_FOOD>
    <YIELD_IRON>120</YIELD_IRON>
    <YIELD_STONE>90</YIELD_STONE>
    <YIELD_WOOD>70</YIELD_WOOD>
  </YieldPrice>

  <!-- Religion state -->
  <ReligionFounded>
    <RELIGION_ZOROASTRIANISM>25</RELIGION_ZOROASTRIANISM>
    <RELIGION_JUDAISM>42</RELIGION_JUDAISM>
  </ReligionFounded>
  <ReligionHeadID>
    <RELIGION_ZOROASTRIANISM>125</RELIGION_ZOROASTRIANISM>
  </ReligionHeadID>
  <ReligionHolyCity>
    <RELIGION_ZOROASTRIANISM>5</RELIGION_ZOROASTRIANISM>
  </ReligionHolyCity>

  <!-- Family assignments -->
  <FamilyClass>
    <FAMILY_JULII>FAMILYCLASS_STATESMEN</FAMILY_JULII>
    <FAMILY_CLAUDII>FAMILYCLASS_CHAMPIONS</FAMILY_CLAUDII>
    <FAMILY_CORNELII>FAMILYCLASS_LANDOWNERS</FAMILY_CORNELII>
    <FAMILY_AEMILII>FAMILYCLASS_TRADERS</FAMILY_AEMILII>
  </FamilyClass>
</Game>
```

### Key Game State Fields

| Element | Type | Description |
|---------|------|-------------|
| `Seed` | ulong | Current RNG seed |
| `Turn` | int | Current game turn (1 turn = 1 year in-game) |
| `GameOver` | empty | Present if game has ended |
| `WinnerTeam` | int | Team ID of winner (-1 if none) |
| `WinnerVictory` | int | Victory type index achieved |
| `NextUnitID` | int | Next available unit ID |
| `NextCityID` | int | Next available city ID |
| `NextCharacterID` | int | Next available character ID |
| `YieldPrice` | dict | Current market prices for goods |

---

## 5. Player Elements

Each player (human or AI) has a `<Player>` element.

### Player Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `ID` | int | Player index (0-based) |
| `Name` | string | Player display name |
| `Email` | string | Player email (multiplayer) |
| `OnlineID` | GUID | Steam/platform ID (human players only) |
| `Nation` | enum | Civilization (e.g., `NATION_ROME`) |
| `AIControlledToTurn` | int | Turn until AI takes control |

### Identifying Human Players

- Human players have a non-empty `OnlineID` attribute
- AI players have empty or missing `OnlineID`
- Player index 0 is typically the first human player

### Player Child Elements

```xml
<Player ID="0" Nation="NATION_ROME" OnlineID="abc123...">
  <!-- Leadership -->
  <FounderID>25</FounderID>
  <ChosenHeirID>-1</ChosenHeirID>
  <Leaders>
    <ID>4</ID>
    <ID>20</ID>
    <ID>45</ID>
  </Leaders>

  <!-- Turn tracking -->
  <LastDoTurn>166</LastDoTurn>
  <StartTurnCities>11</StartTurnCities>

  <!-- Succession rules -->
  <SuccessionGender>SUCCESSIONGENDER_ABSOLUTE_COGNATIC</SuccessionGender>
  <SuccessionOrder>SUCCESSIONORDER_PRIMOGENITURE</SuccessionOrder>

  <!-- Resource stockpiles -->
  <YieldStockpile>
    <YIELD_CIVICS>5000</YIELD_CIVICS>
    <YIELD_TRAINING>3200</YIELD_TRAINING>
    <YIELD_MONEY>15000</YIELD_MONEY>
    <YIELD_FOOD>800</YIELD_FOOD>
    <YIELD_IRON>450</YIELD_IRON>
    <YIELD_STONE>320</YIELD_STONE>
    <YIELD_WOOD>280</YIELD_WOOD>
    <YIELD_ORDERS>12</YIELD_ORDERS>
  </YieldStockpile>

  <!-- Technology progress -->
  <TechProgress>
    <TECH_METAPHYSICS>250</TECH_METAPHYSICS>
  </TechProgress>
  <TechCount>
    <TECH_TRAPPING>2</TECH_TRAPPING>
    <TECH_STONECUTTING>1</TECH_STONECUTTING>
    <TECH_IRONWORKING>1</TECH_IRONWORKING>
  </TechCount>

  <!-- Laws -->
  <LawClassChangeCount>
    <LAWCLASS_ECONOMY>2</LAWCLASS_ECONOMY>
    <LAWCLASS_MILITARY>1</LAWCLASS_MILITARY>
  </LawClassChangeCount>

  <!-- History data (see History section) -->
  <PointsHistory>...</PointsHistory>
  <YieldRateHistory>...</YieldRateHistory>
  <MilitaryPowerHistory>...</MilitaryPowerHistory>
  <LegitimacyHistory>...</LegitimacyHistory>
  <FamilyOpinionHistory>...</FamilyOpinionHistory>
  <ReligionOpinionHistory>...</ReligionOpinionHistory>

  <!-- Event logs -->
  <PermanentLogList>...</PermanentLogList>
  <MemoryList>...</MemoryList>
</Player>
```

### Key Player Elements

| Element | Description |
|---------|-------------|
| `FounderID` | Character ID of dynasty founder |
| `Leaders` | List of character IDs who have been rulers (succession history) |
| `YieldStockpile` | Current resource amounts |
| `TechProgress` | Research points toward technologies |
| `TechCount` | Number of times each tech was researched |

---

## 6. Character Elements

Characters represent rulers, heirs, courtiers, and other notable people.

### Character Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `ID` | int | Unique character ID |
| `BirthTurn` | int | Turn of birth (negative = before game start) |
| `Player` | int | Owner player ID |
| `Gender` | enum | `GENDER_MALE` or `GENDER_FEMALE` |
| `FirstName` | enum | Name type (e.g., `NAME_JULIUS`) |
| `Seed` | ulong | Character's random seed |

### Character Structure (from `Source/Base/Game/GameCore/Character.cs`)

```xml
<Character
  ID="25"
  BirthTurn="-26"
  Player="0"
  Gender="GENDER_MALE"
  FirstName="NAME_MARCUS"
  Seed="32379498">

  <!-- Identity -->
  <Nickname>the Elder</Nickname>
  <Portrait>CHARACTER_PORTRAIT_ROME_LEADER_MALE_15</Portrait>
  <Title>TITLE_AUGUSTUS</Title>

  <!-- Experience -->
  <XP>70</XP>
  <Level>3</Level>

  <!-- Life events -->
  <DeathTurn>125</DeathTurn>
  <LeaderTurn>45</LeaderTurn>
  <AbdicateTurn>-2147483648</AbdicateTurn>

  <!-- Affiliations -->
  <Nation>NATION_ROME</Nation>
  <Family>FAMILY_JULII</Family>
  <WasFamilyHead>FAMILY_JULII</WasFamilyHead>
  <Religion>RELIGION_ZOROASTRIANISM</Religion>
  <WasReligionHead>RELIGION_NONE</WasReligionHead>

  <!-- Family connections -->
  <FatherID>12</FatherID>
  <MotherID>15</MotherID>
  <BirthFatherID>12</BirthFatherID>
  <BirthMotherID>15</BirthMotherID>
  <BirthCityID>0</BirthCityID>
  <Spouses>
    <ID>28</ID>
    <ID>42</ID>
  </Spouses>
  <Children>
    <ID>35</ID>
    <ID>38</ID>
  </Children>

  <!-- Ratings (0-10 scale) -->
  <Rating>
    <RATING_WISDOM>4</RATING_WISDOM>
    <RATING_CHARISMA>6</RATING_CHARISMA>
    <RATING_COURAGE>8</RATING_COURAGE>
    <RATING_DISCIPLINE>5</RATING_DISCIPLINE>
  </Rating>

  <!-- Stats (varies by stat type) -->
  <Stat>
    <STAT_LEGITIMACY>125</STAT_LEGITIMACY>
  </Stat>

  <!-- Traits with acquisition turn -->
  <Trait>
    <TRAIT_EDUCATED />
    <TRAIT_COMMANDER_ARCHETYPE />
    <TRAIT_BRAVE />
  </Trait>
  <TraitTurn>
    <TRAIT_EDUCATED>1</TRAIT_EDUCATED>
    <TRAIT_COMMANDER_ARCHETYPE>1</TRAIT_COMMANDER_ARCHETYPE>
    <TRAIT_BRAVE>45</TRAIT_BRAVE>
  </TraitTurn>

  <!-- Note: Role assignments are tracked on the other entity:
       - Units have GeneralID pointing to the commanding character
       - Cities have GovernorID and AgentID pointing to characters -->

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
  TileID="3442"
  Player="0"
  Family="FAMILY_JULII"
  Founded="1">

  <Name>CITYNAME_ROME</Name>
  <Capital />

  <!-- Leadership -->
  <GovernorID>125</GovernorID>

  <!-- Population -->
  <GrowthCount>15</GrowthCount>
  <Citizens>8</Citizens>
  <SpecialistProducedCount>24</SpecialistProducedCount>

  <!-- Ownership history -->
  <FirstPlayer>0</FirstPlayer>
  <LastPlayer>0</LastPlayer>

  <!-- Production -->
  <YieldProgress>
    <YIELD_GROWTH>450</YIELD_GROWTH>
    <YIELD_CULTURE>200</YIELD_CULTURE>
  </YieldProgress>
  <YieldOverflow>
    <YIELD_TRAINING>50</YIELD_TRAINING>
  </YieldOverflow>

  <!-- Completed projects -->
  <ProjectCount>
    <PROJECT_INQUIRY>3</PROJECT_INQUIRY>
    <PROJECT_FESTIVAL>2</PROJECT_FESTIVAL>
    <PROJECT_OFFER>1</PROJECT_OFFER>
  </ProjectCount>

  <!-- Produced units -->
  <UnitProductionCounts>
    <UNIT_SLINGER>2</UNIT_SLINGER>
    <UNIT_WARRIOR>3</UNIT_WARRIOR>
    <UNIT_WORKER>4</UNIT_WORKER>
  </UnitProductionCounts>

  <!-- Culture and religion -->
  <TeamCultureStep>
    <0>3</0>
    <1>1</1>
  </TeamCultureStep>
  <ReligionTurn>
    <RELIGION_ZOROASTRIANISM>45</RELIGION_ZOROASTRIANISM>
  </ReligionTurn>

  <!-- Happiness modifiers -->
  <LuxuryTurn>
    <RESOURCE_WINE>25</RESOURCE_WINE>
    <RESOURCE_INCENSE>32</RESOURCE_INCENSE>
  </LuxuryTurn>
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
<Tile ID="155">
  <!-- Terrain -->
  <Terrain>TERRAIN_TEMPERATE</Terrain>
  <Height>HEIGHT_HILL</Height>
  <Vegetation>VEGETATION_FOREST</Vegetation>

  <!-- Resources -->
  <Resource>RESOURCE_IRON</Resource>

  <!-- Improvements -->
  <Improvement>IMPROVEMENT_MINE_2</Improvement>
  <ImprovementBuildTurnsOriginal>5</ImprovementBuildTurnsOriginal>
  <ImprovementBuildTurnsLeft>0</ImprovementBuildTurnsLeft>
  <ImprovementCost>
    <YIELD_STONE>36</YIELD_STONE>
  </ImprovementCost>

  <!-- Specialist working this tile -->
  <Specialist>SPECIALIST_FARMER</Specialist>

  <!-- Territory -->
  <CityTerritory>5</CityTerritory>

  <!-- Road (empty element = road present) -->
  <Road />

  <!-- Rivers (boolean: 0 or 1 for each hex edge) -->
  <RiverW>1</RiverW>
  <RiverSW>0</RiverSW>
  <RiverSE>1</RiverSE>

  <!-- Seeds -->
  <InitSeed>5456059863076450570</InitSeed>
  <TurnSeed>11997237878226446141</TurnSeed>

  <!-- Tribal/barbarian site -->
  <TribeSite>TRIBE_VANDALS</TribeSite>

  <!-- Religion presence -->
  <Religion />

  <!-- Ownership history (see History section) -->
  <OwnerHistory>
    <T1>0</T1>
    <T45>1</T45>
    <T82>0</T82>
  </OwnerHistory>

  <!-- Visibility per team -->
  <RevealedTurn>
    <T0>1</T0>
    <T1>25</T1>
  </RevealedTurn>

  <!-- Units on this tile (see Unit Elements section) -->
  <Unit ID="91" Type="UNIT_LEGIONARY" Player="0">
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
<Tile ID="1255">
  <!-- ... tile data ... -->
  <Unit
    ID="91"
    Type="UNIT_LEGIONARY"
    Player="0"
    Seed="2395150775299824834">

    <!-- Direction unit is facing -->
    <Facing>E</Facing>

    <!-- Experience and level -->
    <XP>150</XP>
    <Level>2</Level>

    <!-- Timeline -->
    <CreateTurn>45</CreateTurn>
    <TurnsSinceLastMove>0</TurnsSinceLastMove>

    <!-- Acquired promotions -->
    <Promotions>
      <PROMOTION_FIERCE />
      <PROMOTION_DISCIPLINED />
    </Promotions>

    <!-- Available promotions to choose -->
    <PromotionsAvailable>
      <PROMOTION_HARDY />
    </PromotionsAvailable>

    <!-- General commanding this unit -->
    <GeneralID>125</GeneralID>

    <!-- Unit state flags -->
    <Sleep />

    <!-- Formation -->
    <CurrentFormation>UNITFORMATION_BLOCK</CurrentFormation>

    <!-- Origin -->
    <OriginalPlayer>0</OriginalPlayer>

    <!-- Gender (for units that have it) -->
    <Gender>GENDER_MALE</Gender>

    <!-- Family associations per player -->
    <PlayerFamily>
      <Player Family="FAMILY_JULII">0</Player>
    </PlayerFamily>

    <!-- Bonus effects with stack counts -->
    <BonusEffectUnits>
      <EFFECTUNIT_HEAL>2</EFFECTUNIT_HEAL>
    </BonusEffectUnits>
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
