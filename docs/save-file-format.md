# Old World Save File Format Reference

> **⚠️ Partially stale (as of 2026-06-30).** This is the durable save-**format** reference and most of it is verified accurate against the current TypeScript parser. Three known-stale spots: the "Player ID Mapping" `database_player_id = xml_id + 1` rule is a dead DuckDB convention — the current parser stores the XML id as-is (`src/lib/parser/parsers/players.ts`); the "Questions to Ask User" section is a leftover drafting artifact; and the version/date stamps just below are from 2025. See `docs/doc-audit-2026-06-30.md`.

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

### City location vs territory

Two distinct city↔tile relationships:

| Relationship       | Source                          | Description                         |
| ------------------ | ------------------------------- | ----------------------------------- |
| **City location**  | `City@TileID`                   | The tile where the city center sits |
| **City territory** | `<CityTerritory>` (inside City) | All tiles controlled by this city   |

Improvements and specialists live on **tiles**, not cities. To enumerate
a city's improvements/specialists, walk all tiles whose `owner_city_id`
(derived from `<CityTerritory>`) matches the city.

### Extended city sub-elements

Each city carries a handful of structured child elements that decompose
into rows. The TS parser exposes these as separate derivations.

#### `<UnitProductionCounts>` — per-type units built

```xml
<UnitProductionCounts>
  <UNIT_SETTLER>5</UNIT_SETTLER>
  <UNIT_WORKER>1</UNIT_WORKER>
</UnitProductionCounts>
```

Older saves expose only an aggregate `<UnitProductionCount>` element; newer
saves expose only the per-type breakdown. Sum the children if the
aggregate is absent.

#### `<ProjectCount>` — completed projects, per type

```xml
<ProjectCount>
  <PROJECT_TREASURY_1>1</PROJECT_TREASURY_1>
  <PROJECT_LUXURIOUS_DELIGHTS>1</PROJECT_LUXURIOUS_DELIGHTS>
</ProjectCount>
```

Distinct from `<CompletedBuild>` (a log of one-shot project completions).

#### `<LuxuryTurn>` — luxury imports, per resource

```xml
<LuxuryTurn>
  <RESOURCE_FUR>24</RESOURCE_FUR>
  <RESOURCE_AMBER>61</RESOURCE_AMBER>
</LuxuryTurn>
```

Text is the turn the luxury was imported.

#### `<AgentTurn>` / `<AgentCharacterID>` / `<AgentTileID>` — enemy spies

These three siblings each carry per-player children in the `<P.X>` form:

```xml
<AgentTurn><P.1>72</P.1></AgentTurn>
<AgentCharacterID><P.1>568</P.1></AgentCharacterID>
<AgentTileID><P.1>1745</P.1></AgentTileID>
```

Join across all three by `P.X` key to assemble one enemy-agent record per
hostile player.

#### `<TeamCulture>` and `<TeamHappinessLevel>` — per-team state

Both use the `T.X` keyed form (team-level, not player-level):

```xml
<TeamCulture><T.0>CULTURE_LEGENDARY</T.0></TeamCulture>
<TeamHappinessLevel><T.0>-8</T.0></TeamHappinessLevel>
```

Older saves (2022) expose `<TeamDiscontentLevel>` instead of
`<TeamHappinessLevel>` — fall back to it when the newer name is missing.

#### `<Religion>` — religions present in the city

```xml
<Religion>
  <RELIGION_JUDAISM />
  <RELIGION_CHRISTIANITY />
  <RELIGION_PAGAN_EGYPT />
</Religion>
```

Self-closing children list every religion with any presence in the city.

### City attribute / child reference

Full reference (XML → conceptual field), including elements covered above
and a handful not yet covered in the children listing.

| Field                    | XML                                                             | Notes                                        |
| ------------------------ | --------------------------------------------------------------- | -------------------------------------------- |
| `xml_id`                 | `ID` attr                                                       | 0-based                                      |
| `tile_xml_id`            | `TileID` attr                                                   | City center location                         |
| `player_xml_id`          | `Player` attr                                                   | NULL when city is in anarchy (`Player="-1"`) |
| `family`                 | `Family` attr                                                   | e.g. `FAMILY_SAITE`                          |
| `founded_turn`           | `Founded` attr                                                  | Turn founded                                 |
| `city_name`              | `NameType` (or `Name`)                                          | e.g. `CITYNAME_WASET`                        |
| `governor_xml_id`        | `GovernorID`                                                    | Character ID                                 |
| `governor_turn`          | `GovernorTurn`                                                  | Turn governor was assigned                   |
| `citizens`               | `Citizens`                                                      |                                              |
| `growth_count`           | `GrowthCount`                                                   | Total historical growth                      |
| `specialist_count`       | `SpecialistProducedCount`                                       | (not `SpecialistCount`)                      |
| `unit_production_count`  | `UnitProductionCount` OR sum of `UnitProductionCounts` children | Version-conditional                          |
| `hurry_civics_count`     | `HurryCivicsCount`                                              |                                              |
| `hurry_money_count`      | `HurryMoneyCount`                                               |                                              |
| `hurry_training_count`   | `HurryTrainingCount`                                            |                                              |
| `hurry_population_count` | `HurryPopulationCount`                                          |                                              |
| `buy_tile_count`         | `BuyTileCount`                                                  |                                              |
| `is_capital`             | `<Capital />`                                                   | self-closing flag                            |
| `first_owner_xml_id`     | `FirstPlayer`                                                   | (not `FirstOwnerPlayerID`)                   |
| `last_owner_xml_id`      | `LastPlayer`                                                    |                                              |

Several plausible-looking fields **do not exist** in the XML and must
not be parsed: `GrowthProgress`, `GeneralID`, top-level `Agent` (use
the `<AgentTurn>` / `<AgentCharacterID>` / `<AgentTileID>` sibling
trio instead).

---

## Tile Element

**Location:** `/Root/Tile`
**Count:** All map tiles (example: 2024 tiles)

### Tile Structure

Tile elements have **no attributes** and variable children based on tile
contents — empty terrain, improvements, units, resources, ownership
history, last-seen state, etc.

### Notable children

- **`<OwnerHistory>`** — turn-keyed ownership trail. See _Format Quirks &
  Parsing Gotchas → Tile ownership history_ below.
- **`<Unit>`** — zero or more unit instances actually on this tile. Full
  schema in _Format Quirks → Individual units live inside `<Tile>`_ below
  and in the canonical parser at `src/lib/parser/parsers/units.ts`.
- **`<LastSeenUnits>`** — fog-of-war snapshots of opposing units. Same
  shape as the top-level `<Unit>` block but represents a remembered
  state, not the current state.
- **Improvements / specialists** — when present, attached directly to the
  Tile element (one tile holds at most one improvement and one
  specialist). Improvement metadata: `improvement`, `improvement_pillaged`,
  `improvement_disabled`, `improvement_turns_left`,
  `improvement_develop_turns`.

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

## Format Quirks & Parsing Gotchas

The save-format-bearing nuggets distilled from the larger 2025 docs cleanup
(see `archive/doc-audit.html`). Each subsection captures a non-obvious behaviour or
invariant that the TS parser at `src/lib/parser/` has either had to handle, or
will when the unparsed XML it points at is wired up.

### Sentinel values

- **`-1`** = "no player / unowned / anarchy / tribal / non-allied". Used across
  characters, tiles, tribes, and cities (cities being captured serialize with
  `Player="-1"`). Schema columns that reference players must allow NULL.
  Filtering pattern at parse time: drop or null-coerce any reference equal to
  `-1` before persisting.
- **`2147483647`** = AI player (in `AIControlledToTurn`). The active human has
  `0`. **But** in multiplayer, non-active humans have
  `AIControlledToTurn > 0` and are identified by a non-empty `OnlineID`. The
  load-bearing rule is therefore:

  ```
  isHuman = (OnlineID present and non-empty) OR (AIControlledToTurn === 0)
  ```

  Canonical implementation: `src/lib/parser/parsers/players.ts:54–59`. The
  `AIControlledToTurn === 0` shortcut alone misflags every non-active human
  in a multiplayer save.

### Yields are fixed-point ×10

All yield integers are stored ×10 of the display value. Always divide by 10
at the display layer. See `docs/reference/yields.md` for the design rationale
(precision, multiplayer desync, fixed-point arithmetic).

### Time-series: sparse turn-keyed elements

Player and game-level history is encoded as `<TX>value</TX>` children, where
only turns whose value changed are recorded:

```xml
<YieldRateHistory>
  <YIELD_SCIENCE>
    <T36>42</T36>
    <T70>58</T70>
  </YIELD_SCIENCE>
</YieldRateHistory>
```

Consumers (charts, deltas) must fill-forward: turn 37's value equals turn 36's
recorded value, not zero.

### Player-keyed elements: `<P.0>` format

Per-player values appear as child elements whose tag name is literally
`P.{playerIndex}`. Used for family/religion opinion histories, unit family
associations, city luxury trade. Example from `parseUnits()`:

```xml
<PlayerFamily>
  <P.0>FAMILY_KOSALA</P.0>
  <P.1>FAMILY_FABIUS</P.1>
</PlayerFamily>
```

Parse by stripping the `P.` prefix and treating the remainder as the player's
XML ID.

### Tile ownership history via `<OwnerHistory>`

Tile ownership is sparse, turn-keyed, with `-1` for unowned:

```xml
<Tile>
  <OwnerHistory>
    <T36>0</T36>   <!-- Turn 36: player 0 took ownership -->
    <T70>1</T70>   <!-- Turn 70: player 1 conquered it -->
    <T95>-1</T95>  <!-- Turn 95: became unowned -->
  </OwnerHistory>
</Tile>
```

Current owner = value at max turn. The owner's _city_ is found via the
City element's `CityTerritory` child, **not** on the Tile — this is why
tile-city linkage requires either a two-pass parse or a pre-resolved
tile→city map.

### Greek Diadochi as separate nations

The Hellenistic successor states are encoded as distinct nation values, not
as `NATION_GREECE` + dynasty:

| XML value          | Conceptually      |
| ------------------ | ----------------- |
| `NATION_SELEUCUS`  | Greece, Seleucid  |
| `NATION_PTOLEMY`   | Egypt, Ptolemaic  |
| `NATION_ANTIGONUS` | Greece, Antigonid |

Format-stable across 266 saves spanning 3+ years; the game has not migrated
to a `GREECE + DYNASTY_SELEUCID` shape. UI normalization (if desired)
should happen at query/display time, not at parse time — parse-time
normalization collides with newer saves that may yet adopt the cleaner shape.

### Memory list format changed 2024 → 2025

**2024 format**: five separate lists at the Player level, each with numeric
IDs:

```xml
<MemoryPlayerList>
  <MemoryPlayerData>
    <Type>MEMORYPLAYER_HOSTED_COUNSEL</Type>
    <Player>1</Player>
    <Turn>64</Turn>
  </MemoryPlayerData>
</MemoryPlayerList>
<MemoryFamilyList>
  <MemoryFamilyData>
    <Family>4</Family>      <!-- numeric -->
  </MemoryFamilyData>
</MemoryFamilyList>
```

**2025 format**: one consolidated `MemoryList`, with string names rather than
numeric IDs:

```xml
<MemoryList>
  <MemoryData>
    <Type>MEMORYFAMILY_FOUNDED_CITY</Type>
    <Family>FAMILY_DIDONIAN</Family>  <!-- string -->
  </MemoryData>
</MemoryList>
```

Parser must support both. See `archive/backward-compatibility-memory-parser.md` for
the fallback pattern and full event-type catalogue.

### DLCs vs mods

These are encoded in two different places:

- **Mods** live inside the `Version` Root attribute, as `+`-separated tokens
  after the version number:

  ```
  Version: 1.0.70671+name-every-child1+different-leaders1=-123456
  ```

- **DLCs** live in a separate `<GameContent>` element with self-closing
  children:

  ```xml
  <GameContent>
    <DLC_HEROES_OF_AEGEAN />
    <DLC_THE_SACRED_AND_THE_PROFANE />
  </GameContent>
  ```

A `Version`-string-only DLC parser will report zero DLCs on every save.

### Culture level is a string enum

`<CultureLevel>` stores a string constant, not an integer:

| Value                 | Tier |
| --------------------- | ---- |
| `CULTURE_WEAK`        | 0    |
| `CULTURE_DEVELOPING`  | 1    |
| `CULTURE_STRONG`      | 2    |
| `CULTURE_ESTABLISHED` | 3    |
| `CULTURE_LEGENDARY`   | 4    |

Schema columns must be VARCHAR; integer parsing throws.

### Unit production: version-specific element shape

Older saves expose a single aggregate count:

```xml
<UnitProductionCount>42</UnitProductionCount>
```

Newer saves (2025+) expose only a per-type breakdown:

```xml
<UnitProductionCounts>
  <UNIT_HASTATUS>15</UNIT_HASTATUS>
  <UNIT_SLINGER>9</UNIT_SLINGER>
  <!-- ... -->
</UnitProductionCounts>
```

Parse `UnitProductionCount` first; if absent, sum the children of
`UnitProductionCounts`.

### `FamilyClass` is nested, not a Root child

It looks like it should be a direct child of `<Root>`, but it isn't —
DOM child enumeration misses it. Use a descendants-walk lookup.
The element maps families to archetype constants:

```xml
<FamilyClass>
  <FAMILY_SARGONID>FAMILYCLASS_CHAMPIONS</FAMILY_SARGONID>
  <FAMILY_TUDIYA>FAMILYCLASS_HUNTERS</FAMILY_TUDIYA>
  <FAMILY_ADASI>FAMILYCLASS_PATRONS</FAMILY_ADASI>
</FamilyClass>
```

Known archetype values: `FAMILYCLASS_CHAMPIONS`, `_HUNTERS`, `_PATRONS`,
`_CLERICS`, `_ARTISANS`.

### Individual units live inside `<Tile>`, not at Root

Verified across saves from 2022 through 2026 (223–419 unit instances per
save). The `<Unit>` element carries:

```xml
<Tile ID="100">
  <Unit ID="1" Type="UNIT_HASTATUS" Player="0" Tribe="NONE" Seed="12345">
    <XP>120</XP>
    <Level>2</Level>
    <CreateTurn>50</CreateTurn>
    <Facing>SW</Facing>
    <OriginalPlayer>0</OriginalPlayer>
    <PlayerFamily><P.0>FAMILY_FABIUS</P.0></PlayerFamily>
    <Promotions>            <!-- acquired -->
      <PROMOTION_STRIKE1 />
    </Promotions>
    <PromotionsAvailable>   <!-- not yet acquired -->
      <PROMOTION_TRACKER />
      <PROMOTION_SEABORN />
    </PromotionsAvailable>
  </Unit>
</Tile>
```

Optional fields are version- and unit-type-conditional (`Level` / `XP` for
combat units, `Gender` for workers, etc.). A parallel set of `<Unit>`
elements lives inside `<LastSeenUnits>` and represents fog-of-war snapshots
of opposing units; treat those as a separate data stream.

Aggregate counts (`<UnitsProduced>` at the Player level,
`<UnitProductionCounts>` at the City level) are **also** present — they're
for production analytics, not a substitute for the real unit list.

Canonical TS implementation: `src/lib/parser/parsers/units.ts`.

### Optional `<ID>` in `RelationshipData`

Some character relationships omit the target ID:

```xml
<!-- Case 1: standard, has target -->
<RelationshipData>
  <Type>RELATIONSHIP_PLOTTING_AGAINST</Type>
  <ID>10</ID>
  <Turn>15</Turn>
</RelationshipData>

<!-- Case 2: self/incomplete, no target -->
<RelationshipData>
  <Type>RELATIONSHIP_SOME_TYPE</Type>
  <Turn>20</Turn>
</RelationshipData>
```

Parser must treat `<ID>` as optional and either skip the row or null-coerce
the target.

### Duplicate character rows exist

Marriages, stats, traits, and relationships can appear duplicated for the
same character within a single save. Apply a last-wins dedup pass before
insertion. (The within-import uniqueness invariant below holds for
top-level entities; this is the character-row exception.)

### Within-import uniqueness invariant

Apart from the character-row case above, each entity appears exactly once
per save file. No upstream dedup is required for cities, tiles, units,
players, families, religions, etc. — duplicate-detection at upload time
runs at the file level, not per-entity.

### Parsing-order constraints (multi-pass)

Several relationships require two-pass parsing or pre-resolution:

- **Character parents** — parents may appear later in the XML than children
  that reference them.
- **Tile → city ownership** — ownership lives in `<City><CityTerritory>`,
  not on the Tile; build a tile→city map before assigning Tile.owner_city_id.
- **`birth_city` on characters** — references a city by XML ID.
- **Ownership history** — interlocks with current Tile.owner derivation.

### Enum cleanup conventions

Backend enum strings are prefix-stripped and title-cased for display via
`formatEnum()` in `src/lib/utils/formatting.ts`. Watch for the surprises:

- `MAPCLASS_CoastalRainBasin` → "Coastal Rain Basin" (camel-cased token, not
  underscore-separated).
- `MAPSIZE_SMALLEST` → "Duel" (not "Smallest" — it's a named map size).
- `NATION_*` / `RELIGION_*` / `LEVEL_*` prefixes are stripped before display.

### Typical save scale

Useful as a budget when sizing memory and choosing batch granularity:

- 5 players, ~449 characters, ~5,476 tiles, ~43 cities per save.
- ~2,700 tiles need city ownership resolution.
- 223–419 unit instances inside `<Tile>` (varies by year / war state).
- File size 5–50 MB. DOM parse is fine up to ~20 MB.
- XML parsing is ~6% of upload time; the rest is data shaping + I/O.

### Schema evolution archaeology

The old DuckDB schema's migration log (`schema_migrations` table, v2.0–v2.13)
records what was _learned_ about the format incrementally — each version
bump usually reflects a save-format surprise discovered the hard way:

- **v2.4** — `enabled_dlc` was renamed `enabled_mods` once the
  `Version` attribute was discovered to contain mods only, and a separate
  `enabled_dlc` column was added for `<GameContent>` parsing.
- **v2.7** — Three columns (`growth_progress`, `general_id`, `agent_id`)
  were removed after they were confirmed not to exist in the XML at all.
- **v2.8** — Eight new city columns added once
  `governor_turn`/`hurry_training_count`/`buy_tile_count` were located in
  the actual save XML.
- **v2.9** — Separate tables for project counts, enemy agents, and
  luxuries; also a fallback from `TeamHappinessLevel` to legacy
  `TeamDiscontentLevel` for older saves.
- **v2.10** — Individual unit tables added after Unit instances were
  located inside `<Tile>` (contradicting the earlier "no individual units"
  assumption).
- **v2.13** — `event_logs.data1/data2/data3` changed from INTEGER to
  VARCHAR after string values turned up in real saves.

Future format discoveries should be appended here, even though the DuckDB
schema itself is gone.

### DOM memory caution

When using a full-DOM XML parser (`fast-xml-parser`, `roxmltree`, etc.) on
saves, the parsed-tree footprint can reach ~20 MB per file — small per file,
but the old Rust parser had a latent leak via `Box::leak` that compounded
across batch imports. The TS parser runs each upload in a Web Worker and
discards the tree on completion, which sidesteps the class of bug; preserve
that pattern if the worker pipeline is ever refactored.

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
