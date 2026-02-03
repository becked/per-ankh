# Old World Save File Format Reference

**Version:** 1.0.79513 (as of October 2025)
**Last Updated:** October 8, 2025

## Overview

Old World save files are **ZIP archives** containing a single XML file. The XML file contains the complete game state including map data, player information, cities, characters, events, and game history.

### File Structure

```
match_*.zip
└── OW-{MapName}-Year{N}-{Timestamp}.xml
```

**Example:**

- Archive: `match_426504721_anarkos-becked.zip`
- Contains: `OW-Persia-Year69-2025-09-20-09-47-27.xml` (2.6 MB uncompressed)

### Accessing Save File Content

```bash
# List contents
unzip -l saves/match_*.zip

# Extract to examine
unzip saves/match_*.zip

# Quick peek at XML content
unzip -p saves/match_*.zip | head -n 100
```

---

## XML Document Structure

### Processing Instructions

```xml
<?xml version="1.0" encoding="utf-8"?>
<?ActivePlayer 0?>
```

The `ActivePlayer` processing instruction indicates which player is currently active (0-based index).

### Root Element: `<Root>`

The root element contains all game data. It has **31 attributes** defining game settings and metadata.

#### Root Attributes

**Game Identity:**

- `GameId`: Unique UUID for the game session
- `GameName`: Human-readable game name (e.g., "anarkos vs becked 2.0")
- `SaveDate`: Date string when save was created (e.g., "20 September 2025")
- `Version`: Game version (e.g., "Version: 1.0.79513")

**Map Configuration:**

- `MapWidth`: Map width in tiles (e.g., 46)
- `MinLatitude`: Minimum latitude for map generation (e.g., 35)
- `MaxLatitude`: Maximum latitude for map generation (e.g., 55)
- `MapEdgesSafe`: Boolean - whether map edges are safe zones
- `MinCitySiteDistance`: Minimum distance between city sites (e.g., 8)
- `MapClass`: Map type (e.g., `MAPCLASS_CoastalRainBasin`)
- `MapAspectRatio`: Aspect ratio (e.g., `MAPASPECTRATIO_SQUARE`)
- `MapSize`: Size category (e.g., `MAPSIZE_SMALLEST`)

**Map Seeds:**

- `FirstSeed`: Initial random seed (e.g., 58702068)
- `MapSeed`: Map generation seed (same as FirstSeed in most cases)

**Game Mode Settings:**

- `GameMode`: Mode type (e.g., `NETWORK` for multiplayer)
- `TurnStyle`: Turn timer style (e.g., `TURNSTYLE_TIGHT`)
- `TurnTimer`: Turn timer duration (e.g., `TURNTIMER_SLOW`)
- `SimultaneousTurns`: Boolean (0 or 1) - simultaneous turn mode
- `OpponentLevel`: AI difficulty (e.g., `OPPONENTLEVEL_PEACEFUL`)
- `TribeLevel`: Barbarian tribe difficulty (e.g., `TRIBELEVEL_NORMAL`)

**Game Rules:**

- `Development`: Starting development level (e.g., `DEVELOPMENT_FLEDGLING`)
- `HumanDevelopment`: Human player development (e.g., `DEVELOPMENT_NONE`)
- `Advantage`: Player advantage setting (e.g., `ADVANTAGE_NONE`)
- `SuccessionGender`: Gender succession rules (e.g., `SUCCESSIONGENDER_ABSOLUTE_COGNATIC`)
- `SuccessionOrder`: Succession order rules (e.g., `SUCCESSIONORDER_PRIMOGENITURE`)
- `Mortality`: Character mortality rate (e.g., `MORTALITY_STANDARD`)
- `TurnScale`: What each turn represents (e.g., `TURNSCALE_YEAR`)
- `TeamNation`: Team/nation configuration (e.g., `TEAMNATION_GAME_UNIQUE`)
- `ForceMarch`: Force march rules (e.g., `FORCEMARCH_DOUBLE_FATIGUE`)
- `EventLevel`: Event frequency (e.g., `EVENTLEVEL_MODERATE`)
- `VictoryPointModifier`: Victory point scaling (e.g., `VICTORYPOINT_MEDIUM_HIGH`)

#### Root Children - Top-Level Sections

The root element contains multiple types of child elements, organized by function:

**Count by Element Type (example from 2-player game):**

- `Tile`: 2024 elements (map tiles)
- `Character`: 101 elements (all characters in game)
- `City`: 14 elements (all cities)
- `Tribe`: 10 elements (barbarian tribes)
- `Player`: 2 elements (player data)
- Various configuration sections: 1 element each

**Configuration Sections:**

- `GameContentEnabled`: DLC/expansion content hashes
- `Team`: Player team assignments
- `Difficulty`: Per-player difficulty settings
- `Development`: Per-player development levels
- `Nation`: Per-player nation selections
- `Dynasty`: Per-player dynasty selections
- `Archetype`: Per-player leader archetypes
- `Humans`: Which players are human-controlled
- `StartingPlayerOptions`: Per-player starting options
- `GameOptions`: Game-wide option flags
- `OccurrenceLevels`: Event occurrence settings
- `VictoryEnabled`: Enabled victory conditions
- `GameContent`: Active DLC list
- `MapMultiOptions`: Multi-selection map options
- `MapSingleOptions`: Single-selection map options

**Example GameContentEnabled:**

```xml
<GameContentEnabled
  BASE_CONTENT.1="m9NE7EwYzrw8QIMAur1i2tbi1c3pTYKE4SCQAIFDj/A="
  NATION_HITTITES.1="lagPkX2HIt83lsLqTxLZXM9+skDkUqFlkRf1UpvUnTabhepEObR9cbEG/R6mKPJw"
  AKSUM.1="7SnLuU6ZWkSWYyqtiIGSq01igMVffb9AwJJ+BJ70DAw="
  ... />
```

**Example GameOptions:**

```xml
<GameOptions>
  <GAMEOPTION_CUSTOM_LEADER />
  <GAMEOPTION_NO_UNDO />
  <GAMEOPTION_COMPETITIVE_MODE />
  <GAMEOPTION_NO_BONUS_IMPROVEMENTS />
  <GAMEOPTION_ALLOW_OBSERVE />
</GameOptions>
```

**Example VictoryEnabled:**

```xml
<VictoryEnabled>
  <VICTORY_POINTS />
  <VICTORY_TIME />
  <VICTORY_CONQUEST />
</VictoryEnabled>
```

**Example GameContent:**

```xml
<GameContent>
  <DLC_HEROES_OF_AEGEAN />
  <DLC_THE_SACRED_AND_THE_PROFANE />
  <DLC_PHARAOHS_OF_THE_NILE />
  <DLC_WONDERS_AND_DYNASTIES />
  <DLC_BEHIND_THE_THRONE />
  <DLC_CALAMITIES />
</GameContent>
```

---

## Player Element

**Location:** `/Root/Player[@ID]`
**Count:** Typically 2 (1v1 tournament games)

### Player Attributes

Players are identified by a 0-based `ID` attribute and contain comprehensive player state.

**Example Attributes:**

```xml
<Player
  ID="0"
  Name="anarkos"
  Email=""
  OnlineID="76561198101749655"
  CustomReminder=""
  Language="LANGUAGE_ENGLISH"
  Nation="NATION_PERSIA"
  Dynasty="DYNASTY_CYRUS"
  AIControlledToTurn="2147483647"
  ...>
```

**Key Attributes:**

- `ID`: Player index (0-based, **IMPORTANT:** ID=0 is valid!)
- `Name`: Player username
- `Email`: Player email (usually empty in tournament saves)
- `OnlineID`: Steam/platform ID
- `Language`: UI language preference
- `Nation`: Selected nation (e.g., `NATION_PERSIA`)
- `Dynasty`: Selected dynasty (e.g., `DYNASTY_CYRUS`)
- `AIControlledToTurn`: When AI control ends (2147483647 = never for human players)

### Player Children - Overview

The Player element has **~75 different child element types** containing various aspects of player state.

#### Simple Value Elements

Elements containing single values (usually integers or enums):

```xml
<OriginalCapitalCityID>0</OriginalCapitalCityID>
<FounderID>9</FounderID>
<ChosenHeirID>20</ChosenHeirID>
<LastDoTurn>69</LastDoTurn>
<TimeStockpile>1009</TimeStockpile>
<Legitimacy>100</Legitimacy>
<RecruitLegitimacy>15</RecruitLegitimacy>
<AmbitionDelay>10</AmbitionDelay>
<BuyTileCount>0</BuyTileCount>
<StateReligionChangeCount>1</StateReligionChangeCount>
<TribeMercenaryCount>0</TribeMercenaryCount>
<StartTurnCities>7</StartTurnCities>
<TechResearching>TECH_STONECUTTING</TechResearching>
<PopupTechDiscovered>TECH_MANOR</PopupTechDiscovered>
<SuccessionGender>SUCCESSIONGENDER_ABSOLUTE_COGNATIC</SuccessionGender>
<TheologyEstablishedCount>0</TheologyEstablishedCount>
```

#### Boolean/Flag Elements

Elements that are present (true) or absent (false):

```xml
<Founded />
<Surrendered />
<TurnEnded />
<CompletedGameSaved />
```

#### Resource/Yield Elements

**YieldStockpile** - Current resource stockpiles:

```xml
<YieldStockpile>
  <YIELD_CIVICS>253</YIELD_CIVICS>
  <YIELD_TRAINING>1360</YIELD_TRAINING>
  <YIELD_SCIENCE>169</YIELD_SCIENCE>
  <YIELD_ORDERS>219</YIELD_ORDERS>
  <YIELD_IRON>138</YIELD_IRON>
  <YIELD_STONE>178</YIELD_STONE>
  <YIELD_WOOD>780</YIELD_WOOD>
</YieldStockpile>
```

#### Technology Elements

**TechProgress** - Research progress on technologies (cost in science points):

```xml
<TechProgress>
  <TECH_STONECUTTING>856</TECH_STONECUTTING>
  <TECH_STONECUTTING_BONUS_STONE>620</TECH_STONECUTTING_BONUS_STONE>
  <TECH_DIVINATION>820</TECH_DIVINATION>
  <TECH_ADMINISTRATION>968</TECH_ADMINISTRATION>
  ...
</TechProgress>
```

**TechCount** - Number of times each tech has been discovered:

```xml
<TechCount>
  <TECH_IRONWORKING>1</TECH_IRONWORKING>
  <TECH_TRAPPING>1</TECH_TRAPPING>
  <TECH_SPEARMEN>1</TECH_SPEARMEN>
  ...
</TechCount>
```

**Other Tech Elements:**

- `TechAvailable`: Available techs to research
- `TechLocked`: Locked technologies
- `TechPassed`: Technologies passed on
- `TechTrashed`: Trashed technologies
- `TechTarget`: Current tech research target

#### Laws and Government

**ActiveLaw** - Currently active laws by category:

```xml
<ActiveLaw>
  <LAW_SLAVERY>LAW_SLAVERY</LAW_SLAVERY>
  <LAW_ORDERS>LAW_ORDERS_LABOR_FORCE</LAW_ORDERS>
  <LAW_TRAINING>LAW_TRAINING_CONSCRIPTION</LAW_TRAINING>
  <LAW_DISCIPLINE>LAW_DISCIPLINE_PROMOTION</LAW_DISCIPLINE>
  <LAW_SUCCESSION>LAW_SUCCESSION_PRIMOGENITURE</LAW_SUCCESSION>
</ActiveLaw>
```

**LawClassChangeCount** - Times each law category was changed:

```xml
<LawClassChangeCount>
  <LAWCLASS_ORDERS>1</LAWCLASS_ORDERS>
  <LAWCLASS_TRAINING>1</LAWCLASS_TRAINING>
  <LAWCLASS_DISCIPLINE>1</LAWCLASS_DISCIPLINE>
  <LAWCLASS_SUCCESSION>1</LAWCLASS_SUCCESSION>
</LawClassChangeCount>
```

#### Goals and Missions

**GoalList** - Active goals:

```xml
<GoalList>
  <Goal>
    <Type>GOAL_THE_IRON_THRONE</Type>
    <Started>67</Started>
  </Goal>
  <Goal>
    <Type>GOAL_KINGDOM</Type>
    <Started>38</Started>
  </Goal>
  ...
</GoalList>
```

**GoalStartedCount** - Count of started goals by type:

```xml
<GoalStartedCount>
  <GOAL_IRON_THRONE>1</GOAL_IRON_THRONE>
  <GOAL_THE_IRON_THRONE>1</GOAL_THE_IRON_THRONE>
  <GOAL_KINGDOM>1</GOAL_KINGDOM>
  <GOAL_CITIES>1</GOAL_CITIES>
</GoalStartedCount>
```

**MissionStartedTurn** - Turn each mission type was started:

```xml
<MissionStartedTurn>
  <MISSION_PRODUCTION>36</MISSION_PRODUCTION>
  <MISSION_IMPROVEMENTS>62</MISSION_IMPROVEMENTS>
  <MISSION_FOOD>32</MISSION_FOOD>
  <MISSION_WONDERS>32</MISSION_WONDERS>
</MissionStartedTurn>
```

#### Bonuses and Modifiers

**BonusCount** - Count of bonuses applied (126+ different bonus types):

```xml
<BonusCount>
  <BONUS_XP_CHARACTER_SMALL>8</BONUS_XP_CHARACTER_SMALL>
  <BONUS_XP_CHARACTER_AVERAGE>5</BONUS_XP_CHARACTER_AVERAGE>
  <BONUS_XP_CHARACTER_LARGE>1</BONUS_XP_CHARACTER_LARGE>
  <BONUS_GIVE_TRAIT_BLINDED>1</BONUS_GIVE_TRAIT_BLINDED>
  <BONUS_KILL_CHARACTER>2</BONUS_KILL_CHARACTER>
  <BONUS_SET_TACTICIAN_ARCHETYPE>1</BONUS_SET_TACTICIAN_ARCHETYPE>
  ...
</BonusCount>
```

#### Resources and Luxuries

**ResourceRevealed** - Which resources have been discovered:

```xml
<ResourceRevealed>
  <RESOURCE_FOOD>1</RESOURCE_FOOD>
  <RESOURCE_WOOD>1</RESOURCE_WOOD>
  <RESOURCE_STONE>1</RESOURCE_STONE>
  <RESOURCE_IRON>1</RESOURCE_IRON>
  <RESOURCE_DEER>1</RESOURCE_DEER>
  ...
</ResourceRevealed>
```

#### Families

**Families** - List of family IDs in the nation:

```xml
<Families>
  <Family>FAMILY_ACHAEMENID</Family>
  <Family>FAMILY_ARSACID</Family>
  <Family>FAMILY_SASANID</Family>
</Families>
```

**FamilyHeadID** - Character ID of each family head:

```xml
<FamilyHeadID>
  <FAMILY_ACHAEMENID>9</FAMILY_ACHAEMENID>
  <FAMILY_ARSACID>72</FAMILY_ARSACID>
  <FAMILY_SASANID>64</FAMILY_SASANID>
</FamilyHeadID>
```

**FamilySeatCityID** - City ID of family seats:

```xml
<FamilySeatCityID>
  <FAMILY_ACHAEMENID>0</FAMILY_ACHAEMENID>
  <FAMILY_ARSACID>10</FAMILY_ARSACID>
  <FAMILY_SASANID>7</FAMILY_SASANID>
</FamilySeatCityID>
```

#### Leaders and Council

**Leaders** - List of leader character IDs:

```xml
<Leaders>
  <Leader>9</Leader>
  <Leader>20</Leader>
  <Leader>64</Leader>
</Leaders>
```

**CouncilCharacter** - Characters in council positions:

```xml
<CouncilCharacter>
  <COUNCIL_SPYMASTER>64</COUNCIL_SPYMASTER>
  <COUNCIL_CHANCELLOR>72</COUNCIL_CHANCELLOR>
</CouncilCharacter>
```

#### History Tracking

Several elements track turn-by-turn history (typically one entry per turn):

**LegitimacyHistory** - Legitimacy score per turn:

```xml
<LegitimacyHistory>
  <T2>100</T2>
  <T3>100</T3>
  <T4>100</T4>
  ...
  <T69>100</T69>
</LegitimacyHistory>
```

**MilitaryPowerHistory** - Military power rating per turn:

```xml
<MilitaryPowerHistory>
  <T2>0</T2>
  <T3>0</T3>
  <T4>18</T4>
  ...
  <T69>142</T69>
</MilitaryPowerHistory>
```

**PointsHistory** - Victory points per turn:

```xml
<PointsHistory>
  <T2>0</T2>
  <T3>0</T3>
  <T4>2</T4>
  ...
  <T69>157</T69>
</PointsHistory>
```

**YieldRateHistory** - Production rates per turn by yield type:

```xml
<YieldRateHistory>
  <YIELD_FOOD>
    <T2>11</T2>
    <T3>11</T3>
    ...
  </YIELD_FOOD>
  <YIELD_GROWTH>
    <T2>0</T2>
    <T3>0</T3>
    ...
  </YIELD_GROWTH>
  ...
</YieldRateHistory>
```

**FamilyOpinionHistory** - Family opinion ratings per turn:

```xml
<FamilyOpinionHistory>
  <FAMILY_ACHAEMENID>
    <T2>100</T2>
    <T3>100</T3>
    ...
  </FAMILY_ACHAEMENID>
  ...
</FamilyOpinionHistory>
```

**ReligionOpinionHistory** - Religion opinion ratings per turn:

```xml
<ReligionOpinionHistory>
  <RELIGION_PAGAN_PERSIA>
    <T14>100</T14>
    <T15>100</T15>
    ...
  </RELIGION_PAGAN_PERSIA>
  ...
</ReligionOpinionHistory>
```

#### Events and Stories

**AllEventStoryTurn** - When each event story type was triggered:

```xml
<AllEventStoryTurn>
  <EVENTSTORY_COURTIER_MISSION_PRODUCTION>36</EVENTSTORY_COURTIER_MISSION_PRODUCTION>
  <EVENTSTORY_COURTIER_MISSION_FOOD>32</EVENTSTORY_COURTIER_MISSION_FOOD>
  ...
</AllEventStoryTurn>
```

**EventClassTurn** - When each event class occurred:

```xml
<EventClassTurn>
  <EVENTCLASS_FAMILY>69</EVENTCLASS_FAMILY>
  <EVENTCLASS_RELIGION>68</EVENTCLASS_RELIGION>
  <EVENTCLASS_CHARACTER>62</EVENTCLASS_CHARACTER>
  ...
</EventClassTurn>
```

**PlayerEventStoryTurn**, **FamilyEventStoryTurn**, **ReligionEventStoryTurn**, **TribeEventStoryTurn** - Similar structures for different event categories.

#### Production Tracking

**UnitsProduced** - Count of units produced by type:

```xml
<UnitsProduced>
  <UNIT_SETTLER>3</UNIT_SETTLER>
  <UNIT_SCOUT>1</UNIT_SCOUT>
  <UNIT_WARRIOR>6</UNIT_WARRIOR>
  <UNIT_SLINGER>4</UNIT_SLINGER>
  ...
</UnitsProduced>
```

**UnitsProducedTurn** - Turn when each unit type was last produced:

```xml
<UnitsProducedTurn>
  <UNIT_SETTLER>55</UNIT_SETTLER>
  <UNIT_SCOUT>1</UNIT_SCOUT>
  <UNIT_WARRIOR>66</UNIT_WARRIOR>
  ...
</UnitsProducedTurn>
```

**ProjectsProduced** - Count of projects completed:

```xml
<ProjectsProduced>
  <PROJECT_TRAIN_DISCIPLE>1</PROJECT_TRAIN_DISCIPLE>
  <PROJECT_SPREAD_RELIGION>1</PROJECT_SPREAD_RELIGION>
  <PROJECT_HOLD_FESTIVAL>1</PROJECT_HOLD_FESTIVAL>
  ...
</ProjectsProduced>
```

#### AI Data

**AI** - AI decision-making data (53+ child elements):

```xml
<AI>
  <LastCityProdRecalc>69</LastCityProdRecalc>
  <LastMilitaryEval>69</LastMilitaryEval>
  <TurnsSinceFullProdRecalc>3</TurnsSinceFullProdRecalc>
  ... (extensive AI state data)
</AI>
```

#### UI and Player Interaction

**PlayerOptions** - UI and gameplay preferences:

```xml
<PlayerOptions>
  <PLAYEROPTION_NO_TUTORIAL />
</PlayerOptions>
```

**TurnSummary** - Summary data for the turn:

```xml
<TurnSummary>
  <Turn>...</Turn>
</TurnSummary>
```

**PopupList** - Queued UI popups:

```xml
<PopupList>
  <Popup>...</Popup>
</PopupList>
```

**Pings** - Map pings:

```xml
<Pings>
  <Ping>...</Ping>
  <Ping>...</Ping>
</Pings>
```

**ChatLogList** - In-game chat messages:

```xml
<ChatLogList>
  <Chat>...</Chat>
  <Chat>...</Chat>
  ...
</ChatLogList>
```

---

## LogData (Event Logs)

**Location:** `/Root/Player[@ID]/PermanentLogList/LogData`
**Purpose:** Comprehensive turn-by-turn event history
**Persistence:** Permanent log visible in game UI

### LogData Structure

Each `LogData` element represents a single historical event:

```xml
<LogData>
  <Text>Discovered <color=#e3c08c><link="HELP_LINK,HELP_TECH,TECH_IRONWORKING">Ironworking</link></color></Text>
  <Type>TECH_DISCOVERED</Type>
  <Data1>TECH_IRONWORKING</Data1>
  <Data2>None</Data2>
  <Data3>None</Data3>
  <Turn>1</Turn>
  <TeamTurn>0</TeamTurn>
</LogData>
```

### LogData Fields

| Field      | Type       | Description                                       |
| ---------- | ---------- | ------------------------------------------------- |
| `Text`     | String     | Rich text for UI display (with color/link markup) |
| `Type`     | Enum       | Event type identifier                             |
| `Data1`    | String/Int | Primary event data (varies by Type)               |
| `Data2`    | String/Int | Secondary event data (often "None")               |
| `Data3`    | String/Int | Tertiary event data (often "None")                |
| `Turn`     | Integer    | Game turn when event occurred                     |
| `TeamTurn` | Integer    | Team turn index (usually 0)                       |

### LogData Event Types

**Common Event Types:**

| Type                   | Data1           | Data2        | Data3 | Description                   |
| ---------------------- | --------------- | ------------ | ----- | ----------------------------- |
| `TECH_DISCOVERED`      | Tech ID         | None         | None  | Technology researched         |
| `LAW_ADOPTED`          | Law ID          | None         | None  | Law enacted                   |
| `CITY_FOUNDED`         | Tile ID         | None         | None  | City founded                  |
| `CITY_BREACHED`        | Tile ID         | None         | None  | City walls breached           |
| `CHARACTER_BIRTH`      | Character ID    | None         | None  | Character born                |
| `CHARACTER_DEATH`      | Character ID    | None         | None  | Character died                |
| `CHARACTER_SUCCESSION` | Character ID    | None         | None  | New ruler crowned             |
| `GOAL_STARTED`         | Goal index      | None         | None  | Ambition/Legacy started       |
| `GOAL_FINISHED`        | Goal index      | None         | None  | Ambition/Legacy completed     |
| `GOAL_FAILED`          | Goal index (-1) | None         | None  | Ambition/Legacy failed        |
| `RELIGION_FOUNDED`     | Tile ID         | Religion ID  | None  | Religion founded              |
| `TEAM_CONTACT`         | Player ID       | None         | None  | Met another player            |
| `TEAM_DIPLOMACY`       | Player ID       | None         | None  | Diplomatic action with player |
| `TRIBE_CONTACT`        | Tile ID         | Tribe index  | None  | Met barbarian tribe           |
| `COURTIER`             | Courtier type   | Character ID | None  | Courtier recruited            |

### LogData Count

Typical counts in a 69-turn game:

- Player 0: 68 LogData entries
- Player 1: 63 LogData entries

The number of events varies based on gameplay activity.

### Ownership and Player ID Mapping

**CRITICAL:** LogData elements are stored in the Player's `PermanentLogList`, meaning they belong to that player's perspective.

**Player ID Conversion:**

- XML: `<Player ID="0">` → Database: `player_id = 1`
- XML: `<Player ID="1">` → Database: `player_id = 2`
- **Formula:** `database_player_id = xml_player_id + 1`

**Player ID="0" is VALID and should NOT be skipped!**

---

## MemoryData (AI Memories)

**Location:** `/Root/Player[@ID]/MemoryList/MemoryData`
**Purpose:** AI decision-making memory system
**Persistence:** Limited historical data for AI behavior

### MemoryData Structure

Each `MemoryData` element represents a memory stored in a player's mind:

```xml
<MemoryData>
  <Type>MEMORYPLAYER_ATTACKED_CITY</Type>
  <Player>1</Player>
  <Turn>60</Turn>
</MemoryData>
```

### MemoryData Fields

| Field         | Type    | Optional | Description                                        |
| ------------- | ------- | -------- | -------------------------------------------------- |
| `Type`        | Enum    | Required | Memory type identifier                             |
| `Turn`        | Integer | Required | Turn when memory was created                       |
| `Player`      | Integer | Optional | Subject player (for MEMORYPLAYER\_\* events)       |
| `Family`      | Enum    | Optional | Subject family (for MEMORYFAMILY\_\* events)       |
| `Religion`    | Enum    | Optional | Subject religion (for MEMORYRELIGION\_\* events)   |
| `CharacterID` | Integer | Optional | Subject character (for MEMORYCHARACTER\_\* events) |
| `Tribe`       | Enum    | Optional | Subject tribe (for MEMORYTRIBE\_\* events)         |
| `City`        | Integer | Optional | Subject city (rarely used)                         |

### MemoryData Event Types and Ownership

**Key Concept:** MemoryData events are stored in a player's MemoryList, representing that **player's perspective/memory**.

#### MEMORYPLAYER\_\* Events

**Ownership:** Uses `<Player>` child element (the opponent/subject)

```xml
<!-- Stored in Player ID="0"'s MemoryList -->
<MemoryData>
  <Type>MEMORYPLAYER_ATTACKED_CITY</Type>
  <Player>1</Player>  <!-- Player 1 is the attacker -->
  <Turn>63</Turn>
</MemoryData>
```

**Interpretation:** Player 0 remembers that Player 1 attacked a city on turn 63.

**Common MEMORYPLAYER\_\* Types:**

- `MEMORYPLAYER_ATTACKED_CITY`: Opponent attacked our city
- `MEMORYPLAYER_ATTACKED_UNIT`: Opponent attacked our unit
- `MEMORYPLAYER_CAPTURED_CITY`: Opponent captured a city

#### MEMORYTRIBE/FAMILY/RELIGION\_\* Events

**Ownership:** Uses owner `Player[@ID]` (the viewer/experiencer)

```xml
<!-- Stored in Player ID="0"'s MemoryList -->
<MemoryData>
  <Type>MEMORYTRIBE_ATTACKED_UNIT</Type>
  <Tribe>TRIBE_RAIDERS</Tribe>  <!-- NO <Player> child -->
  <Turn>63</Turn>
</MemoryData>
```

**Interpretation:** Player 0 experienced Raiders attacking their units on turn 63.

**Note:** These events have **NO `<Player>` child element** - the owner is implicit from the MemoryList location.

**Common Types:**

- `MEMORYTRIBE_ATTACKED_UNIT`: Tribe attacked our unit
- `MEMORYFAMILY_FOUNDED_CITY`: Family founded a city
- `MEMORYFAMILY_SLAVE_REVOLT_1`: Family had slave revolt
- `MEMORYFAMILY_MARRIED_INTO_ROYAL_LINE`: Family married into royalty
- `MEMORYRELIGION_OUR_AMBITION`: Our religion triggered ambition
- `MEMORYRELIGION_FUNERAL_RITES`: Religion held funeral rites
- `MEMORYRELIGION_SPREAD_RELIGION`: Religion spread

#### MEMORYCHARACTER\_\* Events

**Ownership:** Uses owner `Player[@ID]`

```xml
<MemoryData>
  <Type>MEMORYCHARACTER_UPGRADED_RECENTLY</Type>
  <CharacterID>64</CharacterID>
  <Turn>65</Turn>
</MemoryData>
```

**Common Types:**

- `MEMORYCHARACTER_UPGRADED_RECENTLY`: Character upgraded
- `MEMORYCHARACTER_SPOUSE_TOO_EXPENSIVE`: Marriage too expensive

### MemoryData Count

Typical counts in a 69-turn game:

- Player 0: 53 total MemoryData entries
- Player 1: 56 total MemoryData entries

### Entity Field Usage Statistics

From a sample 53-entry MemoryList:

- `Player` field: 30/53 (56%)
- `Tribe` field: 12/53 (22%)
- `Family` field: 4/53 (7%)
- `Religion` field: 4/53 (7%)
- `CharacterID` field: Varies
- `City` field: Rare

### Database Mapping

**Consistent with LogData mapping:**

- XML `Player[@ID="0"]` → Database `player_id=1`
- XML `Player[@ID="1"]` → Database `player_id=2`

---

## Character Element

**Location:** `/Root/Character[@ID]`
**Count:** Variable (example: 101 characters in a 69-turn game)

### Character Attributes

```xml
<Character
  ID="0"
  BirthTurn="-20"
  Player="-1"
  Gender="GENDER_FEMALE"
  FirstName="NAME_HELDICA"
  Seed="18046197664312680090">
```

**Key Attributes:**

- `ID`: Unique character identifier (0-based)
- `BirthTurn`: Turn when born (negative = before game start)
- `Player`: Owner player ID (-1 = no owner, barbarian, or dead)
- `Gender`: `GENDER_MALE` or `GENDER_FEMALE`
- `FirstName`: Name identifier (from name database)
- `Seed`: Random seed for character generation

### Character Children

**Sample Structure (first 40 children):**

```xml
<NicknameType>GENDERED_TEXT_NICKNAME_THE_VAN</NicknameType>
<Portrait>CHARACTER_PORTRAIT_VANDAL_FEMA</Portrait>
<NameType>NAME_HELDICA</NameType>
<Level>1</Level>
<DeathTurn>43</DeathTurn>
<Infertile />
<Tribe>TRIBE_VANDALS</Tribe>
<DeathReason>TEXT_TRAIT_SEVERELY_ILL_F</DeathReason>
<Rating>
  <RATING_STRENGTH>3</RATING_STRENGTH>
  <RATING_WISDOM>2</RATING_WISDOM>
  <RATING_CHARISMA>1</RATING_CHARISMA>
  <RATING_DISCIPLINE>2</RATING_DISCIPLINE>
</Rating>
<Stat>0</Stat>
<TraitTurn>
  <TRAIT_SEVERELY_ILL>38</TRAIT_SEVERELY_ILL>
  <TRAIT_WICKED>-20</TRAIT_WICKED>
  <TRAIT_VANDAL>-20</TRAIT_VANDAL>
</TraitTurn>
```

**Key Child Elements:**

- `Level`: Character level/experience
- `DeathTurn`: Turn when died (absent if alive)
- `DeathReason`: Cause of death
- `Tribe`: Associated tribe (for barbarian characters)
- `Rating`: Core stats (Strength, Wisdom, Charisma, Discipline)
- `TraitTurn`: Traits with turn acquired
- `Portrait`: Portrait identifier
- `Infertile`: Boolean flag (present = true)

---

## City Element

**Location:** `/Root/City[@ID]`
**Count:** Variable (example: 14 cities in a 69-turn game)

### City Attributes

```xml
<City
  ID="0"
  TileID="1292"
  Player="1"
  Family="FAMILY_TUDIYA"
  Founded="1">
```

**Key Attributes:**

- `ID`: Unique city identifier (0-based)
- `TileID`: Map tile where city is located
- `Player`: Owner player ID
- `Family`: Founding family
- `Founded`: Turn when city was founded

### City Children (First 40)

```xml
<NameType>CITYNAME_NINEVEH</NameType>
<GovernorID>72</GovernorID>
<Citizens>3</Citizens>
<GrowthCount>7</GrowthCount>
<HurryCivicsCount>4</HurryCivicsCount>
<SpecialistProducedCount>5</SpecialistProducedCount>
<Capital />
<FirstPlayer>1</FirstPlayer>
<LastPlayer>1</LastPlayer>
<YieldProgress>
  <YIELD_FOOD>6</YIELD_FOOD>
  <YIELD_GROWTH>3</YIELD_GROWTH>
  <YIELD_SCIENCE>28</YIELD_SCIENCE>
</YieldProgress>
<YieldOverflow>
  <YIELD_FOOD>0</YIELD_FOOD>
  <YIELD_TRAINING>0</YIELD_TRAINING>
  <YIELD_CIVICS>0</YIELD_CIVICS>
</YieldOverflow>
<UnitProductionCounts>...</UnitProductionCounts>
<ProjectCount>...</ProjectCount>
<LuxuryTurn>...</LuxuryTurn>
<TeamCultureStep>...</TeamCultureStep>
<TeamHappinessLevel>...</TeamHappinessLevel>
<YieldLevel>...</YieldLevel>
<Religion>...</Religion>
<PlayerFamily>...</PlayerFamily>
<TeamCulture>...</TeamCulture>
<EventStoryTurn>...</EventStoryTurn>
<CompletedBuild>...</CompletedBuild>
```

**Key Child Elements:**

- `NameType`: City name identifier
- `GovernorID`: Character ID of governor
- `Citizens`: Population count
- `GrowthCount`: Growth level
- `Capital`: Boolean flag (present = capital city)
- `FirstPlayer`: Original founding player
- `LastPlayer`: Current/last owner player
- `YieldProgress`: Production progress by yield type
- `Religion`: Religious state
- `TeamCulture`: Cultural influence by team

---

## Tile Element

**Location:** `/Root/Tile`
**Count:** All map tiles (example: 2024 tiles)

### Tile Structure

Tile elements have **no attributes** and variable children based on tile contents.

**Note:** The exact structure varies significantly based on what's on the tile (empty terrain, improvements, units, resources, etc.). Detailed tile structure requires further investigation if needed.

---

## Tribe Element

**Location:** `/Root/Tribe`
**Count:** Variable (example: 10 tribes, some entries may be empty)

### Tribe Structure

Tribe elements represent barbarian tribes. Like Tile elements, they have **no attributes** in the sample data examined.

**Note:** Detailed tribe structure requires further investigation if needed.

---

## Game Element

**Location:** `/Root/Game`
**Count:** 1 (singleton)

### Game Attributes

The Game element has **no attributes** (empty in samples).

### Game Children (First 50)

```xml
<Seed>18046197663754941529</Seed>
<NextUnitID>221</NextUnitID>
<NextCityID>14</NextCityID>
<NextCharacterID>106</NextCharacterID>
<NextOccurrenceID>0</NextOccurrenceID>
<MapClass>MAPCLASS_CoastalRainBasin</MapClass>
<MapSize>MAPSIZE_SMALLEST</MapSize>
<Turn>69</Turn>
<TurnTime>250</TurnTime>
<RecentHumanAttacks>10</RecentHumanAttacks>
<GameOver />
<NoReplay />
<NoFogOfWar />
<TeamTurn>1</TeamTurn>
<PlayerTurn>1</PlayerTurn>
<TeamVictories>...</TeamVictories>
<TeamVictoriesCompleted>...</TeamVictoriesCompleted>
<YieldPrice>...</YieldPrice>
<YieldPriceTurn>...</YieldPriceTurn>
<YieldPriceHistory>...</YieldPriceHistory>
<ReligionFounded>...</ReligionFounded>
<ReligionHeadID>...</ReligionHeadID>
<ReligionHolyCity>...</ReligionHolyCity>
<ImprovementDisabled>...</ImprovementDisabled>
<ReligionFounder>...</ReligionFounder>
<FamilyClass>...</FamilyClass>
<TribeConflictTurn>...</TribeConflictTurn>
<TribeDiplomacyTurn>...</TribeDiplomacyTurn>
<TribeDiplomacyBlock>...</TribeDiplomacyBlock>
<TribeWarScore>...</TribeWarScore>
<TeamConflictTurn>...</TeamConflictTurn>
<TeamDiplomacyTurn>...</TeamDiplomacyTurn>
<TeamDiplomacyBlock>...</TeamDiplomacyBlock>
<TeamWarScore>...</TeamWarScore>
<TribeContact>...</TribeContact>
<TeamContact>...</TeamContact>
<TribeDiplomacy>...</TribeDiplomacy>
<TeamDiplomacy>...</TeamDiplomacy>
```

**Key Elements:**

- `Seed`: Game random seed
- `NextUnitID`, `NextCityID`, `NextCharacterID`: Next available IDs for entities
- `Turn`: Current turn number
- `TurnTime`: Turn timer duration
- `TeamTurn`, `PlayerTurn`: Current team/player turn index
- `GameOver`, `NoReplay`, `NoFogOfWar`: Game state flags
- `ReligionFounded`, `ReligionHeadID`, `ReligionHolyCity`: Religion state
- `TribeConflictTurn`, `TeamConflictTurn`: Conflict tracking
- `TribeDiplomacy`, `TeamDiplomacy`: Diplomatic relationships

---

## Key Concepts and Gotchas

### Player ID Mapping (CRITICAL!)

**XML uses 0-based IDs, database uses 1-based:**

```python
# XML: <Player ID="0">
# Database: player_id = 1
database_player_id = int(xml_id) + 1
```

**Important:** Player ID="0" is **VALID** and should NOT be skipped!

### Data Sources - No Overlap

**MemoryData Events** (limited historical data):

- Character/diplomatic memories for AI decision-making
- Event types: `MEMORYPLAYER_*`, `MEMORYFAMILY_*`, etc.
- Location: `Player/MemoryList/MemoryData`

**LogData Events** (comprehensive turn-by-turn logs):

- Complete gameplay history
- Event types: `LAW_ADOPTED`, `TECH_DISCOVERED`, `GOAL_STARTED`, etc.
- Location: `Player/PermanentLogList/LogData`

**No overlap:** Different event type namespaces, different purposes.

### Memory Event Ownership

**Key Concept:** MemoryData events are stored in a player's MemoryList, representing that player's perspective/memory.

**Player ID Assignment:**

1. **MEMORYPLAYER\_\* events**: Use `<Player>` child element (the opponent/subject)
   - Example: If Becked's memory says "MEMORYPLAYER_ATTACKED_CITY Player=1", it means Becked remembers Fluffbunny (Player 1) attacking a city

2. **MEMORYTRIBE/FAMILY/RELIGION\_\* events**: Use owner `Player[@ID]` (the viewer)
   - Example: If Becked's memory says "MEMORYTRIBE_ATTACKED_UNIT Tribe=Raiders", it means Becked witnessed/experienced Raiders attacking units
   - **No `<Player>` child element** exists for these events

### XML Structure Notes

- Save files are `.zip` archives containing a single `.xml` file
- Extract for inspection: `unzip -p saves/match_*.zip | head -n 1000`
- Root element contains match metadata as attributes
- Player elements contain turn-by-turn data

---

## Appendix: Common Enumerations

### Nations

- `NATION_PERSIA`
- `NATION_GREECE`
- `NATION_ROME`
- `NATION_CARTHAGE`
- `NATION_BABYLON`
- `NATION_EGYPT`
- `NATION_ASSYRIA`
- (and others based on DLC)

### Dynasties

Dynasty IDs follow the pattern `DYNASTY_{NAME}`, e.g.:

- `DYNASTY_CYRUS` (Persia)
- `DYNASTY_DEFAULT`

### Technologies

Tech IDs follow the pattern `TECH_{NAME}`, e.g.:

- `TECH_IRONWORKING`
- `TECH_TRAPPING`
- `TECH_STONECUTTING`
- `TECH_DIVINATION`

### Laws

Law IDs follow the pattern `LAW_{CATEGORY}_{NAME}`, e.g.:

- `LAW_SLAVERY`
- `LAW_ORDERS_LABOR_FORCE`
- `LAW_TRAINING_CONSCRIPTION`
- `LAW_DISCIPLINE_PROMOTION`
- `LAW_SUCCESSION_PRIMOGENITURE`

### Yield Types

- `YIELD_FOOD`
- `YIELD_WOOD`
- `YIELD_STONE`
- `YIELD_IRON`
- `YIELD_CIVICS`
- `YIELD_TRAINING`
- `YIELD_SCIENCE`
- `YIELD_ORDERS`
- `YIELD_GROWTH`
- `YIELD_CULTURE`

### Unit Types

Unit IDs follow the pattern `UNIT_{NAME}`, e.g.:

- `UNIT_SETTLER`
- `UNIT_SCOUT`
- `UNIT_WARRIOR`
- `UNIT_SLINGER`
- `UNIT_SPEARMAN`

### Difficulty Levels

- `DIFFICULTY_MAGNIFICENT`
- (others not observed in sample)

### Game Modes

- `NETWORK` (multiplayer)
- (others not observed in sample)

### Victory Types

- `VICTORY_POINTS`
- `VICTORY_TIME`
- `VICTORY_CONQUEST`

---

## Questions to Ask User

Before finalizing this reference document, please clarify:

1. **Tile structure:** Should I investigate detailed tile structure (terrain, improvements, units)?
2. **Tribe structure:** Should I document barbarian tribe internal structure?
3. **Character details:** Should I document all character fields comprehensively?
4. **Unit data:** Are there Unit elements in the XML? Should they be documented?
5. **Event exhaustiveness:** Should I catalog ALL possible LogData and MemoryData event types?
6. **Families detail:** Should I document Family element structure beyond what's shown?
7. **AI data:** Should I document the internal AI decision-making data structure?

---

## Document Maintenance

This document should be updated when:

- Game version changes significantly
- New DLC adds new data structures
- New event types are discovered
- Database schema changes require new XML field mappings

**Current Version:** Based on Old World v1.0.79513 (September 2025)
