# XML Data Sources for Old World Save File Charts

This document catalogs all charts in the tournament visualizer, organized by page and tab, with complete documentation of the underlying XML data sources from Old World save files.

**Purpose:** This reference is for development teams building applications that analyze Old World save files. It documents what data exists in save files and how it can be used to create similar visualizations.

**Save File Format:** Old World save files are `.zip` archives containing a single `.xml` file with the complete game state.

---

## Table of Contents

1. [Critical Data Transformation Rules](#critical-data-transformation-rules)
2. [Overview Page](#overview-page)
   - [Summary Tab](#summary-tab)
   - [Nations Tab](#nations-tab)
   - [Families Tab](#families-tab)
   - [Rulers Tab](#rulers-tab)
   - [Yields Tab](#yields-tab)
   - [Laws Tab](#laws-tab)
   - [Cities Tab](#cities-tab)
3. [Matches Page](#matches-page)
   - [Overview Tab](#matches-overview-tab)
   - [Timeline Tab](#timeline-tab)
   - [Events Tab](#events-tab)
   - [Laws Tab](#matches-laws-tab)
   - [Technology Tab](#technology-tab)
   - [Yields Tab](#matches-yields-tab)
   - [Science Tab (Beta)](#science-tab-beta)
   - [Ambitions Tab](#ambitions-tab)
   - [Cities Tab](#matches-cities-tab)
   - [Map Tab](#map-tab)
   - [Improvements Tab](#improvements-tab)
   - [Military Tab](#military-tab)
4. [XML Structure Reference](#xml-structure-reference)

---

## Critical Data Transformation Rules

Before implementing any data extraction, understand these critical rules:

### Player ID Conversion

```
XML Format:     0-based (ID="0", ID="1", ID="2")
Display Format: 1-based (Player 1, Player 2, Player 3)
Conversion:     display_player_id = xml_id + 1
```

**Important:** Player ID="0" is valid and represents the first player.

### Yield Value Scale

```
XML Storage:    Raw integer values (e.g., 215)
Display Value:  Divide by 10 (e.g., 21.5)
```

Old World stores all yield values in units of 0.1 internally. Always divide by 10 for display.

### Coordinate Calculation (for Map)

```
Layout:  Row-major (odd-r pointy-top hex grid)
Formula: x = tile_id % map_width
         y = tile_id // map_width
```

---

## Overview Page

The Overview page shows tournament-wide statistics aggregated across multiple matches.

### Summary Tab

#### 1. Event Category Timeline

**Description:** Stacked area chart showing event frequency by category over normalized game time.

**XML Source:** Events from three sources per match:

1. **MemoryData Events**

   ```
   XPath: //Player[@ID]/MemoryList/MemoryData
   ```

   ```xml
   <Player ID="0">
     <MemoryList>
       <MemoryData>
         <Type>MEMORYPLAYER_ATTACKED_CITY</Type>
         <Turn>45</Turn>
         <Player>1</Player>
       </MemoryData>
     </MemoryList>
   </Player>
   ```

2. **LogData Events**

   ```
   XPath: //Player[@OnlineID]/PermanentLogList/LogData
   ```

   ```xml
   <LogData>
     <Type>LAW_ADOPTED</Type>
     <Turn>23</Turn>
     <Data1>LAW_SLAVERY</Data1>
     <Text>Adopted Slavery</Text>
   </LogData>
   ```

3. **Religion Adoption Events**
   ```
   XPath: //Player[@ID]/RELIGION_*.EVENTSTORY_ADOPT_RELIGION
   ```
   ```xml
   <Player ID="0">
     <RELIGION_ZOROASTRIANISM.EVENTSTORY_ADOPT_RELIGION>74</...>
   </Player>
   ```

**Derivation:** Events are categorized (Ambitions, Battles, Cities, Laws, Religion, Rulers, Techs, Wonders) based on event type prefix, then aggregated by turn across all matches.

---

#### 2. Military Unit Breakdown

**Description:** Sunburst chart showing unit production by role (Cavalry, Ranged, Melee) and unit type.

**XML Source:**

```
XPath: //Player[@OnlineID]/UnitsProduced
```

```xml
<UnitsProduced>
  <UNIT_SETTLER>3</UNIT_SETTLER>
  <UNIT_SPEARMAN>15</UNIT_SPEARMAN>
  <UNIT_ARCHER>8</UNIT_ARCHER>
  <UNIT_HORSEMAN>5</UNIT_HORSEMAN>
  <UNIT_CHARIOT>2</UNIT_CHARIOT>
</UnitsProduced>
```

**Derivation:** Unit types are mapped to roles (e.g., `UNIT_ARCHER` → Ranged, `UNIT_HORSEMAN` → Cavalry) and aggregated across all players/matches.

---

#### 3. Map Breakdown

**Description:** Sunburst chart showing map distribution by Size → Class → Aspect Ratio.

**XML Source:**

```
XPath: Root element attributes
```

```xml
<Root
  MapSize="MAPSIZE_LARGE"
  MapClass="MAPCLASS_CoastalRainBasin"
  MapAspectRatio="MAPASPECTRATIO_WIDE"
  MapWidth="100">
```

**Derivation:**

- `MAPSIZE_LARGE` → "Large" (remove prefix, title case)
- `MAPCLASS_CoastalRainBasin` → "Coastal Rain Basin" (remove prefix, split camel case)
- `MAPASPECTRATIO_WIDE` → "Wide"

---

#### 4. Average Science Per Turn vs Win Rate

**Description:** Line chart comparing science progression between winners and losers.

**XML Source:**

```
XPath: //Player[@OnlineID]/YieldRateHistory/YIELD_SCIENCE
```

```xml
<YieldRateHistory>
  <YIELD_SCIENCE>
    <T1>10</T1>
    <T2>15</T2>
    <T3>22</T3>
  </YIELD_SCIENCE>
</YieldRateHistory>
```

**Derivation:**

1. Extract science rate per turn (divide values by 10)
2. Determine winner from victory conditions or final score
3. Average science rates across all winners vs all losers
4. Plot both lines over turn number

---

### Nations Tab

#### 1. Nation Win Percentage

**Description:** Horizontal bar chart showing win rate per civilization.

**XML Source:**

```
XPath: //Player[@OnlineID]/@Nation
```

```xml
<Player ID="0" OnlineID="123" Nation="NATION_PERSIA">
```

**Winner Determination:** From `//TeamVictoriesCompleted` or highest `score` attribute.

**Derivation:** `win_rate = wins / total_games` per nation.

---

#### 2. Nation Loss Percentage

**Description:** Horizontal bar chart showing loss rate per civilization.

**Derivation:** `loss_rate = losses / total_games` per nation (inverse of win percentage).

---

#### 3. Nation Popularity

**Description:** Horizontal bar chart showing how often each nation is played.

**Derivation:** Count of matches per nation.

---

#### 4. Nation Counter-Pick Effectiveness

**Description:** Heatmap showing win rates for each nation matchup.

**XML Source:** Same as Nation Win Percentage, but requires tracking both players per match.

**Derivation:** For each unique matchup (Nation A vs Nation B), calculate Nation A's win rate.

---

#### 5. Pick Order Win Rate

**Description:** Bar chart showing win rates for first pick vs second pick.

**XML Source:** Pick order is stored externally (Challonge API) and linked via match metadata.

**Derivation:** Cross-reference pick order data with match outcomes.

---

### Families Tab

#### 1. Family Class Win Rate

**Description:** Horizontal bar chart showing win rate per family class (Clerics, Hunters, Landowners, etc.).

**XML Source:**

```
XPath: //City/@Family
```

```xml
<City ID="5" TileID="245" Player="0" Family="FAMILY_JULII">
```

**Family Class Mapping:** Each family constant maps to a class:

- `FAMILY_JULII`, `FAMILY_SCIPIO`, `FAMILY_FLAVII` → Statesmen
- `FAMILY_CLAUDII` → Landowners
- etc. (This mapping is game data, not in save file)

**Derivation:** Aggregate family classes from all cities owned by each player, then calculate win rates.

---

#### 2. Family Class Popularity

**Description:** Horizontal bar chart showing pick frequency per family class.

**Derivation:** Count occurrences of each family class across all matches.

---

#### 3. The Omitted Class

**Description:** Chart showing which family classes players choose NOT to pick.

**Derivation:** Each nation has 4 available family classes but players only start with 3. Track which class is omitted per match.

---

#### 4. Top Class Combinations

**Description:** Horizontal bar chart showing most popular 3-family-class combinations.

**Derivation:** Group by the set of 3 family classes each player uses, count occurrences.

---

#### 5. Class Counter-Pick Effectiveness

**Description:** Heatmap showing win rates for family class matchups.

**Derivation:** Similar to nation counter-pick, but using primary family class.

---

#### 6. Nation × Family Class Affinity

**Description:** Heatmap showing how often each nation picks each family class.

**Derivation:** Cross-tabulate nation selections with family class selections.

---

#### 7. City Distribution by Class

**Description:** Grouped bar comparing city counts for winners vs losers by family class.

**XML Source:**

```
XPath: //City
```

Count cities, group by owner's family class.

---

#### 8-10. Family Opinion Charts

**Description:** Various charts showing family opinion trends over time.

**XML Source:**

```
XPath: //Player[@OnlineID]/FamilyOpinionHistory
```

```xml
<FamilyOpinionHistory>
  <FAMILY_JULII>
    <T2>100</T2>
    <T3>95</T3>
    <T5>90</T5>
  </FAMILY_JULII>
  <FAMILY_SCIPIO>
    <T2>80</T2>
    <T3>75</T3>
  </FAMILY_SCIPIO>
</FamilyOpinionHistory>
```

**Derivation:** Opinion values are already on a 0-200 scale (100 = neutral). Average across families for aggregate charts.

---

### Rulers Tab

#### 1. Archetype Performance

**Description:** Bar/line chart showing win rates and play counts per ruler archetype.

**XML Source:**

```
XPath: //Player[@OnlineID]/Leaders (list of character IDs)
XPath: //Character[@ID]/TraitTurn (traits with acquisition turn)
```

```xml
<Player ID="0" OnlineID="123">
  <Leaders>
    <ID>5</ID>
    <ID>12</ID>
  </Leaders>
</Player>

<Character ID="5" FirstName="NAME_YAZDEGERD">
  <TraitTurn>
    <TRAIT_SCHOLAR_ARCHETYPE>1</TRAIT_SCHOLAR_ARCHETYPE>
    <TRAIT_EDUCATED>1</TRAIT_EDUCATED>
  </TraitTurn>
</Character>
```

**Derivation:**

1. Get first character ID from `Leaders` list (starting ruler)
2. Find archetype from traits ending in `_ARCHETYPE`
3. Aggregate win rates by archetype

---

#### 2. Trait Performance

**Description:** Bar/line chart showing win rates per starting ruler trait.

**XML Source:** Same as Archetype Performance.

**Derivation:**

- Starting trait = first non-archetype trait acquired on turn 1
- Only applies to starting ruler (first in Leaders list)

---

#### 3. Archetype Matchup Matrix

**Description:** Heatmap showing win rates for archetype vs archetype matchups.

**Derivation:** Cross-tabulate starting ruler archetypes with match outcomes.

---

#### 4. Popular Combinations

**Description:** Bar chart showing most common archetype + starting trait combinations.

**Derivation:** Count occurrences of each (archetype, trait) pair.

---

#### 5. Win Rate by Starting Ruler Reign Duration

**Description:** Bar chart showing win rate by how long the starting ruler survived.

**XML Source:**

```
XPath: //Character[@ID]/DeathTurn
```

```xml
<Character ID="5">
  <DeathTurn>42</DeathTurn>
</Character>
```

**Derivation:**

1. Calculate reign duration = `DeathTurn - 1` (or total turns if still alive)
2. Bucket into quartiles
3. Calculate win rate per bucket

---

#### 6. Win Rate by Succession Rate

**Description:** Bar chart showing win rate by how frequently rulers changed.

**Derivation:**

- Succession rate = `(number_of_rulers - 1) / total_turns * 100`
- Bucket and calculate win rates

---

#### 7. Starting Ruler Survival

**Description:** Survival curve showing % of starting rulers still alive over time.

**Derivation:** For each turn, calculate % of starting rulers without a `DeathTurn` <= that turn.

---

### Yields Tab

#### 1-14. Yield Production Charts (Science, Orders, Food, Growth, Culture, Civics, Training, Money, Happiness, Discontent, Iron, Stone, Wood, Maintenance)

**Description:** Stacked subplots showing rate per turn (top) and cumulative total (bottom).

**XML Source (Rate):**

```
XPath: //Player[@OnlineID]/YieldRateHistory/YIELD_{TYPE}
```

```xml
<YieldRateHistory>
  <YIELD_SCIENCE>
    <T1>100</T1>
    <T2>120</T2>
    <T3>150</T3>
  </YIELD_SCIENCE>
</YieldRateHistory>
```

**XML Source (Cumulative Total):** Available in game version 1.0.81366+:

```
XPath: //Player[@OnlineID]/YieldTotalHistory/YIELD_{TYPE}
```

**All 14 Yield Types:**

- `YIELD_SCIENCE` - Research points
- `YIELD_ORDERS` - Action points
- `YIELD_FOOD` - Population food
- `YIELD_GROWTH` - City growth
- `YIELD_CULTURE` - Border expansion
- `YIELD_CIVICS` - Law/government points
- `YIELD_TRAINING` - Military production
- `YIELD_MONEY` - Gold income
- `YIELD_HAPPINESS` - Positive mood
- `YIELD_DISCONTENT` - Negative mood
- `YIELD_IRON` - Strategic resource
- `YIELD_STONE` - Construction material
- `YIELD_WOOD` - Construction material
- `YIELD_MAINTENANCE` - Upkeep costs

**Derivation:**

- **CRITICAL: Divide all raw values by 10 for display**
- Rate chart: Plot per-turn values
- Cumulative: Sum rates from turn 1 to current turn (or use YieldTotalHistory if available)

---

#### 15. Average Military Score Per Turn

**Description:** Line chart with median and percentile bands.

**XML Source:**

```
XPath: //Player[@OnlineID]/MilitaryPowerHistory
```

```xml
<MilitaryPowerHistory>
  <T1>50</T1>
  <T2>65</T2>
  <T3>80</T3>
</MilitaryPowerHistory>
```

**Derivation:** Calculate median and 25th/75th percentiles across all matches per turn.

---

#### 16. Average Legitimacy Per Turn

**Description:** Line chart with median and percentile bands.

**XML Source:**

```
XPath: //Player[@OnlineID]/LegitimacyHistory
```

```xml
<LegitimacyHistory>
  <T1>75</T1>
  <T2>72</T2>
  <T3>70</T3>
</LegitimacyHistory>
```

**Derivation:** Same as military score - median and percentiles.

---

### Laws Tab

#### 1. Law Timing Distribution

**Description:** Box plot showing distribution of turns to reach law milestones.

**XML Source:**

```
XPath: //Player[@OnlineID]/PermanentLogList/LogData[Type='LAW_ADOPTED']
```

```xml
<LogData>
  <Type>LAW_ADOPTED</Type>
  <Turn>23</Turn>
  <Data1>LAW_SLAVERY</Data1>
</LogData>
```

**Derivation:**

1. Count law adoptions per player per turn
2. Find turn when player reached 4 laws, 7 laws
3. Plot distribution across all matches

---

#### 2. Law Progression Efficiency

**Description:** Scatter plot with turn to 4 laws vs turn to 7 laws.

**Derivation:** Same data as above, plot as (x=turn_to_4, y=turn_to_7).

---

### Cities Tab

#### 1. City Expansion Timeline

**Description:** Line chart showing cumulative city count over time per player.

**XML Source:**

```
XPath: //City/@Founded
```

```xml
<City ID="5" Founded="3" Player="0">
```

**Derivation:** For each turn, count cities where `Founded <= turn`.

---

#### 2. Production Strategies

**Description:** Stacked bar showing unit production breakdown per player.

**XML Source:**

```
XPath: //City/UnitProductionCounts
```

```xml
<UnitProductionCounts>
  <UNIT_SETTLER>2</UNIT_SETTLER>
  <UNIT_WORKER>3</UNIT_WORKER>
  <UNIT_SPEARMAN>5</UNIT_SPEARMAN>
</UnitProductionCounts>
```

**Derivation:** Sum production across all cities per player, categorize into Settlers, Workers, Disciples, Military.

---

## Matches Page

The Matches page shows detailed analysis of a single match.

### Matches Overview Tab

**Description:** Summary card with match metadata and player information.

**XML Source:**

```
XPath: Root element attributes + //Player[@OnlineID]
```

```xml
<Root
  GameName="Tournament Match"
  SaveDate="20 September 2025"
  MapSize="MAPSIZE_LARGE"
  MapClass="MAPCLASS_Continent">

  <Player ID="0" OnlineID="123" Name="Player1" Nation="NATION_ROME" score="2450">
  <Player ID="1" OnlineID="456" Name="Player2" Nation="NATION_PERSIA" score="1890">
</Root>
```

---

### Timeline Tab

#### 1. Events Timeline by Category

**Description:** Stacked bar chart showing events over time grouped by category.

**XML Source:** Same as Overview page Event Category Timeline, but for single match.

---

#### 2. Events Data Table

**Description:** Table listing individual events with turn, category, player, description.

**XML Source:** Combined from MemoryData, LogData, and Religion Adoption events.

---

### Events Tab

Same content as Timeline tab (alternative view).

---

### Matches Laws Tab

#### 1. Law Tempo (Cumulative)

**Description:** Line chart showing cumulative law count per player over time.

**XML Source:**

```
XPath: //Player[@OnlineID]/PermanentLogList/LogData[Type='LAW_ADOPTED']
```

---

#### 2. Law Adoption Timeline

**Description:** Timeline showing when each specific law was adopted by each player.

**Derivation:** Extract law name from `Data1` field, plot adoption turn.

---

#### 3. Final Laws by Player

**Description:** Cards showing which laws each player adopted.

**Derivation:** List all `LAW_ADOPTED` events per player.

---

### Technology Tab

#### 1. Tech Tree Visualization

**Description:** Interactive directed graph showing tech dependencies and research status.

**XML Source:**

```
XPath: //Player[@OnlineID]/PermanentLogList/LogData[Type='TECH_DISCOVERED']
```

```xml
<LogData>
  <Type>TECH_DISCOVERED</Type>
  <Turn>15</Turn>
  <Data1>TECH_WRITING</Data1>
</LogData>
```

**Derivation:** Tech tree structure is game data; overlay player's researched techs at selected turn.

---

#### 2. Technology Cumulative Count

**Description:** Line chart showing cumulative tech count per player.

**Derivation:** Count `TECH_DISCOVERED` events per player up to each turn.

---

#### 3. Tech Completion Timeline

**Description:** Timeline showing when each tech was completed.

**Derivation:** Plot tech names vs completion turn.

---

### Matches Yields Tab

#### 1-14. Per-Match Yield Charts

**Description:** Stacked chart showing rate and cumulative for each yield type.

**XML Source:** Same as Overview Yields Tab, filtered to single match.

---

### Science Tab (Beta)

#### 1. Science from Infrastructure

**Description:** Stacked bar showing science contribution by infrastructure type.

**XML Source:**

```
XPath: //Tile/Improvement, //Tile/Specialist
```

**Derivation:** Map improvements and specialists to their science output values (requires game data for yields).

---

#### 2. Direct Science Sources

**Description:** Grouped bar comparing science sources between players.

---

#### 3. Science Infrastructure Timeline

**Description:** Line chart showing science infrastructure count over time.

**XML Source:**

```
XPath: //Tile/OwnerHistory (for tile ownership changes)
```

---

### Ambitions Tab

#### 1. Legitimacy Progression

**Description:** Line chart showing legitimacy over time.

**XML Source:**

```
XPath: //Player[@OnlineID]/LegitimacyHistory
```

---

#### 2. Ambition Summary

**Description:** Table showing completed ambitions.

**XML Source:**

```
XPath: //Player[@OnlineID]/PermanentLogList/LogData[Type starts with 'GOAL_']
```

```xml
<LogData>
  <Type>GOAL_BUILD_WONDER</Type>
  <Turn>45</Turn>
  <Text>Completed ambition: Build a Wonder</Text>
</LogData>
```

---

#### 3. Ambition Timelines

**Description:** Per-player timeline of ambition completions.

---

### Matches Cities Tab

#### 1. Territory Control Over Time

**Description:** Line chart showing territory tile count per player over time.

**XML Source:**

```
XPath: //Tile/OwnerHistory
```

```xml
<Tile ID="245">
  <OwnerHistory>
    <T1>0</T1>
    <T15>1</T15>
    <T45>-1</T45>
  </OwnerHistory>
</Tile>
```

**Derivation:**

- Player ID: 0-based in XML, -1 = unowned
- Count tiles owned by each player at each turn
- Ownership persists until next change entry

---

#### 2. Final Territory Distribution

**Description:** Pie chart showing final territory split.

**Derivation:** Territory count at final turn.

---

#### 3. Cumulative City Count

**Description:** Line chart showing city count over time.

**XML Source:**

```
XPath: //City/@Founded
```

---

#### 4. City Founding Timeline

**Description:** Scatter plot showing when cities were founded.

---

### Map Tab

#### 1. Interactive Map Viewer

**Description:** Pixi.js rendered hex map showing terrain, improvements, specialists, resources, and ownership over time.

**XML Source:**

```
XPath: //Tile[@ID]
```

```xml
<Tile ID="245">
  <Terrain>TERRAIN_GRASSLAND</Terrain>
  <Improvement>IMPROVEMENT_FARM</Improvement>
  <Specialist>SPECIALIST_PRIEST</Specialist>
  <Resource>RESOURCE_WHEAT</Resource>
  <Road />
  <CityTerritory>11</CityTerritory>
  <OwnerHistory>
    <T1>0</T1>
    <T15>1</T15>
  </OwnerHistory>
</Tile>
```

**Coordinate Calculation:**

```
map_width = Root/@MapWidth
x = tile_id % map_width
y = tile_id // map_width
```

**Tile Data Fields:**

- `Terrain`: Base terrain type (`TERRAIN_GRASSLAND`, `TERRAIN_DESERT`, `TERRAIN_WATER`, etc.)
- `Improvement`: Building on tile (`IMPROVEMENT_FARM`, `IMPROVEMENT_MINE`, `IMPROVEMENT_QUARRY`, etc.)
- `Specialist`: Worker assignment (`SPECIALIST_FARMER`, `SPECIALIST_MINER`, `SPECIALIST_PRIEST`, etc.)
- `Resource`: Natural resource (`RESOURCE_WHEAT`, `RESOURCE_IRON`, `RESOURCE_HORSE`, etc.)
- `Road`: Presence of `<Road />` element indicates road exists
- `CityTerritory`: ID of city controlling this tile
- `OwnerHistory`: Player ownership changes over time

---

### Improvements Tab

#### 1. Improvements Butterfly Chart

**Description:** Diverging bar chart comparing improvement counts between players.

**XML Source:**

```
XPath: //Tile/Improvement
```

**Derivation:** At final turn, count each improvement type per player's territory.

---

#### 2. Specialists Butterfly Chart

**Description:** Diverging bar chart comparing specialist counts between players.

**XML Source:**

```
XPath: //Tile/Specialist
```

---

### Military Tab

#### 1. Military Power

**Description:** Line chart showing military strength over time.

**XML Source:**

```
XPath: //Player[@OnlineID]/MilitaryPowerHistory
```

---

#### 2. Unit Listing by Player

**Description:** Cards showing military and non-military unit counts.

**XML Source:**

```
XPath: //Player[@OnlineID]/UnitsProduced
```

---

#### 3-9. Army Composition Charts (Stacked, Grouped, Waffle, Treemap, Icon Grid, Portrait, Marimekko)

**Description:** Various visualizations of unit composition.

**XML Source:** Same as Unit Listing - `UnitsProduced` data rendered in different formats.

---

## XML Structure Reference

### Root Element

```xml
<Root
  GameName="string"
  SaveDate="20 September 2025"
  GameMode="GAMEMODE_STANDARD"
  TurnStyle="TURNSTYLE_TIGHT"
  TurnTimer="TURNTIMER_SLOW"
  MapClass="MAPCLASS_Continent"
  MapSize="MAPSIZE_LARGE"
  MapAspectRatio="MAPASPECTRATIO_WIDE"
  MapWidth="100"
  EventLevel="EVENTLEVEL_HARD"
  OpponentLevel="OPPONENTLEVEL_TOUGH"
  TribeLevel="TRIBELEVEL_DANGEROUS">

  <Game>
    <Turn>85</Turn>
  </Game>

  <VictoryEnabled>
    <VICTORY_SCIENCE />
    <VICTORY_DOMINATION />
  </VictoryEnabled>

  <TeamVictoriesCompleted>
    <Team Victory="VICTORY_SCIENCE">
      <Turn>75</Turn>
    </Team>
  </TeamVictoriesCompleted>

  <!-- Players, Characters, Cities, Tiles... -->
</Root>
```

### Player Element

```xml
<Player
  ID="0"
  OnlineID="38472982"
  Name="PlayerName"
  Nation="NATION_PERSIA"
  team="0"
  difficulty="HANDICAP_NOBLE"
  score="2450">

  <Leaders>
    <ID>5</ID>
    <ID>12</ID>
  </Leaders>

  <MemoryList>
    <MemoryData>...</MemoryData>
  </MemoryList>

  <PermanentLogList>
    <LogData>...</LogData>
  </PermanentLogList>

  <YieldRateHistory>
    <YIELD_SCIENCE><T1>100</T1><T2>120</T2></YIELD_SCIENCE>
    <!-- All 14 yield types -->
  </YieldRateHistory>

  <YieldTotalHistory>
    <!-- Same structure as YieldRateHistory, cumulative totals -->
  </YieldTotalHistory>

  <MilitaryPowerHistory>
    <T1>50</T1><T2>65</T2>
  </MilitaryPowerHistory>

  <LegitimacyHistory>
    <T1>75</T1><T2>72</T2>
  </LegitimacyHistory>

  <PointsHistory>
    <T1>1</T1><T2>2</T2>
  </PointsHistory>

  <FamilyOpinionHistory>
    <FAMILY_JULII><T2>100</T2><T3>95</T3></FAMILY_JULII>
  </FamilyOpinionHistory>

  <UnitsProduced>
    <UNIT_SETTLER>3</UNIT_SETTLER>
    <UNIT_SPEARMAN>15</UNIT_SPEARMAN>
  </UnitsProduced>
</Player>
```

### Character Element

```xml
<Character
  ID="5"
  FirstName="NAME_YAZDEGERD"
  BirthTurn="-2">

  <Cognomen>COGNOMEN_GREAT</Cognomen>
  <Family>FAMILY_SASSANID</Family>
  <DeathTurn>42</DeathTurn>

  <TraitTurn>
    <TRAIT_SCHOLAR_ARCHETYPE>1</TRAIT_SCHOLAR_ARCHETYPE>
    <TRAIT_EDUCATED>1</TRAIT_EDUCATED>
    <TRAIT_BRAVE>15</TRAIT_BRAVE>
  </TraitTurn>
</Character>
```

### City Element

```xml
<City
  ID="5"
  TileID="245"
  Player="0"
  Founded="3"
  Family="FAMILY_JULII">

  <NameType>CITYNAME_WASET</NameType>
  <Name>Wonderland</Name>
  <Citizens>8</Citizens>
  <GovernorID>12</GovernorID>
  <Capital />
  <FirstPlayer>0</FirstPlayer>

  <UnitProductionCounts>
    <UNIT_SETTLER>2</UNIT_SETTLER>
    <UNIT_SPEARMAN>5</UNIT_SPEARMAN>
  </UnitProductionCounts>

  <ProjectCount>
    <PROJECT_FORUM>1</PROJECT_FORUM>
    <PROJECT_TEMPLE>1</PROJECT_TEMPLE>
  </ProjectCount>
</City>
```

### Tile Element

```xml
<Tile ID="245">
  <Terrain>TERRAIN_GRASSLAND</Terrain>
  <Improvement>IMPROVEMENT_FARM</Improvement>
  <Specialist>SPECIALIST_PRIEST</Specialist>
  <Resource>RESOURCE_WHEAT</Resource>
  <Road />
  <CityTerritory>11</CityTerritory>

  <OwnerHistory>
    <T1>0</T1>
    <T15>1</T15>
    <T45>-1</T45>
  </OwnerHistory>
</Tile>
```

### LogData Element

```xml
<LogData>
  <Type>LAW_ADOPTED</Type>
  <Turn>23</Turn>
  <Data1>LAW_SLAVERY</Data1>
  <Data2></Data2>
  <Data3></Data3>
  <Text>Adopted &lt;link help="LAW_SLAVERY"&gt;Slavery&lt;/link&gt;</Text>
</LogData>
```

**Common LogData Types:**

- `LAW_ADOPTED` - Law passed (law name in Data1)
- `TECH_DISCOVERED` - Technology researched (tech name in Data1)
- `CITY_FOUNDED` - City founded (family archetype in Text via regex)
- `CHARACTER_SUCCESSION` - New ruler took power
- `GOAL_*` - Ambition completed

### MemoryData Element

```xml
<MemoryData>
  <Type>MEMORYPLAYER_ATTACKED_CITY</Type>
  <Turn>45</Turn>
  <Player>1</Player>
  <Religion>RELIGION_JUPITER</Religion>
  <Tribe>TRIBE_RAIDERS</Tribe>
  <Family>FAMILY_JULII</Family>
  <Nation>NATION_ROME</Nation>
  <CharacterID>23</CharacterID>
  <CityID>5</CityID>
</MemoryData>
```

**Player ID Assignment:**

- `MEMORYPLAYER_*` events: Use `<Player>` child element
- `MEMORYTRIBE_*`, `MEMORYFAMILY_*`, `MEMORYRELIGION_*` events: Use parent `Player[@ID]`

---

## Data Volume Considerations

- **Tile data is large:** ~2000 tiles × ~100 turns = ~200,000 records per match
- **History elements are sparse:** Only turns with changes are recorded (e.g., `<T2>`, `<T5>`, `<T10>`)
- **Fill forward for missing turns:** Ownership/values persist until next recorded change

---

## Quick Reference: XPath to Chart Type

| Chart Category      | XPath                                                         |
| ------------------- | ------------------------------------------------------------- |
| Player metadata     | `//Player[@OnlineID]` attributes                              |
| Yields              | `//Player/YieldRateHistory/*`, `//Player/YieldTotalHistory/*` |
| Military power      | `//Player/MilitaryPowerHistory`                               |
| Legitimacy          | `//Player/LegitimacyHistory`                                  |
| Victory points      | `//Player/PointsHistory`                                      |
| Family opinion      | `//Player/FamilyOpinionHistory`                               |
| Units produced      | `//Player/UnitsProduced`                                      |
| Rulers              | `//Player/Leaders` + `//Character`                            |
| Laws                | `//Player/PermanentLogList/LogData[Type='LAW_ADOPTED']`       |
| Technologies        | `//Player/PermanentLogList/LogData[Type='TECH_DISCOVERED']`   |
| Events (log)        | `//Player/PermanentLogList/LogData`                           |
| Events (memory)     | `//Player/MemoryList/MemoryData`                              |
| Cities              | `//City`                                                      |
| City production     | `//City/UnitProductionCounts`, `//City/ProjectCount`          |
| Map/Territory       | `//Tile`                                                      |
| Territory ownership | `//Tile/OwnerHistory`                                         |
| Match metadata      | Root element attributes                                       |
