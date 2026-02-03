# Statistics and Visualizations Report

## Executive Summary

This report catalogs potential statistics and visualizations for the Per-Ankh Old World save analyzer. The recommendations are organized by analytical category and prioritized by implementation complexity and player value.

**Database Coverage**: ~85% of XML data structures (54 tables, 16 time-series tracked metrics)

**Current Implementation Status**: ~15% of planned features

- **Overview Page**: Games by nation chart, total games count
- **Game Detail Page**: 10 time-series charts across Events, Economics, and Laws & Technology tabs; complete game settings with winner display
- **Foundation**: Solid architecture with centralized API, type safety, color theming, reusable Chart component with series filters and fullscreen support

**Analysis Categories**:

1. Match Overview & Victory Analysis
2. Economic Performance
3. Military & Warfare
4. Diplomatic Relations
5. Character & Dynasty Management
6. Family & Religion Politics
7. Technology & Research
8. Map Control & Expansion
9. City Management & Urbanization
10. Event Narrative & Story Choices
11. Cross-Match Comparative Analysis

---

## Status & Priority Legend

**Implementation Status:**

- **✅ IMPLEMENTED**: Feature exists in current app
- **🔨 PARTIAL**: Partially implemented, needs enhancement
- **📋 PLANNED**: Not yet implemented

**Implementation Priority:**

- **🟢 Easy**: Simple queries, existing UI patterns, high value
- **🟡 Medium**: Moderate complexity, may need new chart types
- **🔴 Complex**: Advanced queries, custom visualizations, or performance considerations

---

## 1. Match Overview & Victory Analysis

### 1.1 Match Summary Card

**Status**: ✅ IMPLEMENTED
**Priority**: 🟢 Easy
**Type**: Info Card
**Data Sources**: `matches`, `players`, `match_summary` view

**Current Implementation**:

- ✅ Game name, total turns
- ✅ Map size, width, height
- ✅ Game mode, difficulty
- ✅ Players table with: name, nation, type (Human/AI), legitimacy, state religion
- ✅ Player count (calculated from players array)
- ✅ Winner display in summary bar (name, civilization, victory type)
- ✅ Victory conditions displayed in Settings tab
- ✅ DLC list displayed in Settings tab

**Value**: Essential context for every analysis

**File**: `/src/routes/game/[id]/+page.svelte` (Summary bar and Settings tab)

---

### 1.2 Victory Points Timeline

**Status**: ✅ IMPLEMENTED (Game Detail page, Events tab)
**Priority**: 🟢 Easy
**Type**: Line chart
**Data Sources**: `points_history`, `players`

**Current Implementation**:

- ✅ X-axis: Turn number
- ✅ Y-axis: Victory points
- ✅ Series: One line per player (color-coded by nation using `getCivilizationColor()`)
- ✅ Interactive tooltips, legend

**Potential Enhancements**:

- Annotations for key events (wars declared, ambitions completed, tech discoveries)
- Threshold lines for victory conditions
- Inflection point detection and highlighting

**Insights**:

- Which players led at different stages
- Inflection points (sudden score changes)
- Final sprint patterns

**File**: `/src/routes/game/[id]/+page.svelte` (Events tab)

---

### 1.3 Victory Condition Progress

**Status**: 📋 PLANNED (Data available in `player_goals`, not yet exposed)
**Priority**: 🟡 Medium
**Type**: Radial/spider chart
**Data Sources**: `player_goals`, `matches.victory_conditions`

**Visualization**:

- One axis per victory condition
- Player progress % toward each condition
- Highlight achieved conditions

**Implementation Notes**: Need backend query `get_player_goals(matchId)`, ECharts radar chart

**Insights**:

- Which victory paths players pursued
- How close non-winners came to alternative victories

---

### 1.4 Turn Timer Usage (Multiplayer)

**Priority**: 🟡 Medium
**Type**: Bar chart
**Data Sources**: `matches`, `players` (if turn timer data available)

**Metrics**:

- Average turn completion time per player
- Turn timer violations/extensions

**Value**: Multiplayer game pacing analysis

---

## 2. Economic Performance

### 2.1 Yield Production Timeline

**Status**: ✅ IMPLEMENTED (Game Detail page, Economics tab - 6 separate charts)
**Priority**: 🟢 Easy
**Type**: Multi-line chart
**Data Sources**: `yield_history`, `players`

**Current Implementation**:

- ✅ X-axis: Turn number
- ✅ Y-axis: Yield per turn (correctly divides by 10 for display)
- ✅ Series: One line per player (color-coded by nation)
- ✅ 6 separate charts for: Science, Civics, Training, Growth, Culture, Happiness
- ✅ Interactive tooltips, legends

**Potential Enhancements**:

- Unified chart with toggle to show/hide individual yields
- Stacked view option
- Annotations for major buildings/tech that boost yields

**Insights**:

- Economic growth trajectory
- Yield prioritization strategies
- Impact of buildings/technologies on yields

**Note**: Fixed-point arithmetic correctly handled (stored as integers, divided by 10)

**File**: `/src/routes/game/[id]/+page.svelte` (Economics tab)

---

### 2.2 Yield Composition Breakdown

**Status**: 📋 PLANNED (Data available, visualization not yet implemented)
**Priority**: 🟢 Easy
**Type**: Stacked area chart
**Data Sources**: `yield_history`

**Visualization**:

- X-axis: Turn number
- Y-axis: Total yield production (all yields combined)
- Stacked areas: Each yield type as colored band

**Implementation Notes**: Could add as additional Economics tab view, ECharts supports stacked area natively

**Insights**:

- Relative balance of economic focus
- Shifts in economic strategy over time

---

### 2.3 Resource Stockpiles

**Status**: 📋 PLANNED (Data available in `player_resources` table, not yet exposed)
**Priority**: 🟢 Easy
**Type**: Bar chart or gauge
**Data Sources**: `player_resources`

**Metrics**:

- Current stockpile of each yield type
- Comparison to other players
- Stockpile capacity warnings (if applicable)

**Implementation Notes**: Need backend query `get_player_resources(matchId)`, simple bar chart

**Value**: Snapshot of player economic health

---

### 2.4 Market Price Trends

**Status**: 📋 PLANNED (Data available in `yield_prices` table, not yet exposed)
**Priority**: 🟡 Medium
**Type**: Line chart
**Data Sources**: `yield_prices`

**Visualization**:

- X-axis: Turn number
- Y-axis: Price
- Series: One line per yield type

**Implementation Notes**: Need backend query `get_yield_prices(matchId)`, line chart similar to existing

**Insights**:

- Yield value fluctuations
- Optimal buying/selling opportunities
- Market manipulation patterns

---

### 2.5 Economic Efficiency Metrics

**Priority**: 🟡 Medium
**Type**: Calculated KPIs
**Data Sources**: `yield_history`, `cities`, `tiles`

**Metrics**:

- Yields per city (avg production per city)
- Yields per tile (economic density)
- Yields per population (efficiency)
- Growth rate (% change turn-over-turn)

**Value**: Normalized comparisons across different game states

---

### 2.6 Specialist Distribution

**Priority**: 🟡 Medium
**Type**: Pie chart or treemap
**Data Sources**: `tiles` (specialist column)

**Metrics**:

- Count of each specialist type (SPECIALIST_POET_1, SPECIALIST_OFFICER_1, etc.)
- Distribution by city
- Specialist density heatmap

**Insights**:

- Specialist allocation strategy
- Which cities focus on which specialists

---

## 3. Military & Warfare

### 3.1 Military Power Timeline

**Status**: ✅ IMPLEMENTED (Game Detail page, Events tab)
**Priority**: 🟢 Easy
**Type**: Line chart
**Data Sources**: `military_history`, `players`

**Current Implementation**:

- ✅ X-axis: Turn number
- ✅ Y-axis: Military power
- ✅ Series: One line per player (color-coded by nation)
- ✅ Interactive tooltips, legend

**Potential Enhancements**:

- War period annotations (shaded regions during active wars)
- Major battle markers
- Military power ratio chart (relative strength comparison)

**Insights**:

- Military buildup periods
- Power projection comparisons
- Correlation with wars

**File**: `/src/routes/game/[id]/+page.svelte` (Events tab)

---

### 3.2 Unit Production Summary

**Status**: 📋 PLANNED (Data available in `player_units_produced`, `city_units_produced`)
**Priority**: 🟢 Easy
**Type**: Horizontal bar chart
**Data Sources**: `player_units_produced`, `city_units_produced`

**Metrics**:

- Total units produced by type
- Units per city breakdown
- Unit type distribution (melee vs ranged vs siege)

**Implementation Notes**: Need backend query `get_unit_production(matchId)`, horizontal bar chart

**Insights**:

- Military composition strategy
- Production focus by era

---

### 3.3 War Timeline

**Priority**: 🟡 Medium
**Type**: Gantt chart / timeline
**Data Sources**: `diplomacy`, `event_logs`

**Visualization**:

- Y-axis: Player pairs
- X-axis: Turn number
- Bars: War periods (start to peace)
- Color: War score (winning/losing)

**Insights**:

- Conflict frequency and duration
- Simultaneous wars (multi-front conflicts)
- Peace treaty patterns

---

### 3.4 Casualties and Losses

**Priority**: 🔴 Complex
**Type**: Bar chart
**Data Sources**: `event_logs` (LOG_UNIT_KILLED, etc.)

**Metrics**:

- Units lost per player
- Units lost per war
- Loss ratio (casualties vs enemy casualties)

**Note**: Requires parsing event_logs for unit death events

---

### 3.5 Military Units Heatmap

**Priority**: 🔴 Complex
**Type**: Map overlay
**Data Sources**: Unit positions (if available)

**Visualization**:

- Map-based visualization
- Color intensity: Unit concentration

**Note**: Individual unit data not persistently tracked in XML

---

## 4. Diplomatic Relations

### 4.1 Diplomacy Matrix

**Priority**: 🟢 Easy
**Type**: Matrix heatmap
**Data Sources**: `diplomacy`

**Visualization**:

- Rows: Player/tribe A
- Columns: Player/tribe B
- Cell color: Relationship status (War=red, Peace=green, Truce=yellow)
- Cell annotation: War score

**Insights**:

- Alliance blocs
- Isolation patterns
- Diplomatic stability

---

### 4.2 Relationship Timeline

**Priority**: 🟡 Medium
**Type**: Line chart with state changes
**Data Sources**: `diplomacy`, `memory_data`

**Visualization**:

- X-axis: Turn number
- Y-axis: Relationship state (categorical)
- Annotations: Key diplomatic events (war declared, peace signed)

**Insights**:

- Diplomatic volatility
- Trigger events for relationship changes

---

### 4.3 Family Opinion Tracker

**Status**: 📋 PLANNED (Data available in `family_opinion_history`, not yet exposed)
**Priority**: 🟢 Easy
**Type**: Multi-line chart
**Data Sources**: `family_opinion_history`, `families`

**Visualization**:

- X-axis: Turn number
- Y-axis: Opinion value (-100 to +100)
- Series: One line per family
- Threshold lines: Critical opinion levels (e.g., rebellion risk)

**Implementation Notes**: Need backend query `get_family_opinion_history(matchId)`, line chart similar to existing

**Insights**:

- Family satisfaction trends
- Impact of laws/events on opinion
- Most/least favored families

---

### 4.4 Religion Opinion Tracker

**Status**: 📋 PLANNED (Data available in `religion_opinion_history`, not yet exposed)
**Priority**: 🟢 Easy
**Type**: Multi-line chart
**Data Sources**: `religion_opinion_history`, `religions`

**Visualization**:

- X-axis: Turn number
- Y-axis: Opinion value
- Series: One line per religion

**Implementation Notes**: Need backend query `get_religion_opinion_history(matchId)`, line chart similar to existing

**Insights**:

- Religious stability
- State religion changes impact
- Religious harmony vs conflict

---

### 4.5 Diplomatic Memory Analysis

**Priority**: 🟡 Medium
**Type**: Timeline with annotations
**Data Sources**: `memory_data`

**Metrics**:

- Grievance count by type (MEMORYPLAYER_ATTACKED_CITY, etc.)
- Memory decay timeline
- Grudge patterns (repeated grievances)

**Insights**:

- What causes lasting diplomatic damage
- Forgiveness timelines

---

## 5. Character & Dynasty Management

### 5.1 Dynastic Timeline (Family Tree)

**Priority**: 🔴 Complex
**Type**: Tree diagram / genealogy chart
**Data Sources**: `characters`, `character_marriages`, `character_lineage` view

**Visualization**:

- Nodes: Characters (with portraits if available)
- Edges: Parent-child relationships, marriages
- Node color: Alive vs deceased
- Node size: Character level/importance
- Annotations: Birth/death turns, traits, archetypes

**Insights**:

- Dynasty continuity
- Inheritance patterns
- Genetic trait inheritance (if applicable)

**Complexity**: Requires graph layout algorithms (D3.js tree, etc.)

---

### 5.2 Ruler Succession Timeline

**Priority**: 🟡 Medium
**Type**: Timeline with portraits
**Data Sources**: `characters`, `rulers` view

**Visualization**:

- X-axis: Turn number
- Y-axis: Ruler portrait/name
- Segments: Reign duration
- Annotations: Death reason, age at death

**Insights**:

- Succession stability
- Reign lengths
- Causes of succession (natural death vs assassination)

---

### 5.3 Character Stats Distribution

**Priority**: 🟢 Easy
**Type**: Radar/spider chart
**Data Sources**: `character_stats`, `characters`

**Visualization**:

- Axes: RATING_WISDOM, RATING_CHARISMA, RATING_COURAGE, RATING_DISCIPLINE
- Multiple overlays: Compare characters (current ruler vs heir, etc.)

**Insights**:

- Ruler quality over time
- Attribute balance
- Ideal ruler profiles

---

### 5.4 Character Traits Analysis

**Priority**: 🟡 Medium
**Type**: Bar chart / word cloud
**Data Sources**: `character_traits`

**Metrics**:

- Most common traits in dynasty
- Trait acquisition frequency
- Trait duration (acquired_turn to removed_turn)
- Positive vs negative trait balance

**Insights**:

- Dynasty character patterns
- Trait management effectiveness

---

### 5.5 Character Lifespan & Mortality

**Priority**: 🟢 Easy
**Type**: Histogram
**Data Sources**: `characters`

**Metrics**:

- Age at death distribution (death_turn - birth_turn)
- Death reason breakdown (DEATH_OLD_AGE, DEATH_BATTLE, etc.)
- Average lifespan by gender/archetype

**Insights**:

- Dynasty longevity
- Risk factors (battlefield deaths, illnesses)

---

### 5.6 Character Mission Success Rates

**Priority**: 🟡 Medium
**Type**: Bar chart
**Data Sources**: `character_missions`

**Metrics**:

- Mission completion rate by type
- Average mission duration
- Character success rates (by character)

**Insights**:

- Mission prioritization
- Effective mission pairings

---

### 5.7 Character Relationship Network

**Priority**: 🔴 Complex
**Type**: Network graph
**Data Sources**: `character_relationships`

**Visualization**:

- Nodes: Characters
- Edges: Relationships (RELATIONSHIP_LOVES, RELATIONSHIP_PLOTTING_AGAINST, etc.)
- Edge color: Relationship type
- Edge thickness: Relationship strength (relationship_value)

**Insights**:

- Court intrigue patterns
- Loyalty networks
- Plotting clusters

**Complexity**: Network layout algorithms required

---

### 5.8 Council Appointment History

**Priority**: 🟡 Medium
**Type**: Timeline
**Data Sources**: `player_council`

**Visualization**:

- X-axis: Turn number
- Y-axis: Council position
- Segments: Character tenure in position
- Color: Character family affiliation

**Insights**:

- Council stability
- Family representation in government
- Appointment patterns (meritocracy vs nepotism)

---

## 6. Family & Religion Politics

### 6.1 Family Power Distribution

**Priority**: 🟢 Easy
**Type**: Pie chart / bar chart
**Data Sources**: `families`, `characters`, `cities`

**Metrics**:

- Families by member count
- Families by city ownership (seat cities)
- Families by council representation

**Insights**:

- Dominant families
- Family balance of power

---

### 6.2 Family Class Comparison

**Priority**: 🟡 Medium
**Type**: Grouped bar chart
**Data Sources**: `families`, `family_opinion_history`

**Metrics**:

- Average opinion by family class (FAMILYCLASS_CHAMPIONS vs FAMILYCLASS_TRADERS, etc.)
- Opinion trends by class

**Insights**:

- Which family classes are easier to satisfy
- Class-based policy effectiveness

---

### 6.3 Religion Spread Map

**Priority**: 🔴 Complex
**Type**: Map visualization
**Data Sources**: `religions`, `city_religions`, `tiles`

**Visualization**:

- Map overlay showing religious distribution
- Color: Religion type
- Intensity: Religion presence strength
- Animation: Spread over time

**Insights**:

- Religious expansion patterns
- Holy city influence radius
- Religious competition

---

### 6.4 State Religion Changes

**Priority**: 🟡 Medium
**Type**: Timeline
**Data Sources**: `players`, `religions`

**Metrics**:

- State religion change events
- Opinion impact of changes
- Religious stability periods

**Insights**:

- Religious policy volatility
- Optimal timing for conversion

---

### 6.5 Family Law Opinion Heatmap

**Priority**: 🟡 Medium
**Type**: Heatmap
**Data Sources**: `family_law_opinions`, `laws`

**Visualization**:

- Rows: Families
- Columns: Law categories
- Cell color: Opinion value

**Insights**:

- Which families support which laws
- Controversial laws
- Consensus policies

---

## 7. Technology & Research

### 7.1 Tech Tree Completion

**Status**: 📋 PLANNED (Data available in `technologies_completed`, not yet exposed)
**Priority**: 🟢 Easy
**Type**: Progress bar / percentage
**Data Sources**: `technologies_completed`, tech tree definition

**Metrics**:

- % of total techs researched
- Techs per era
- Comparison to other players

**Implementation Notes**: Need backend query `get_tech_completion(matchId)`, simple progress bars/percentages

**Value**: Quick research progress indicator

**Location**: Laws & Technology tab on Game Detail page (currently shows Law Adoption chart)

---

### 7.2 Law Adoption History

**Status**: ✅ IMPLEMENTED (Game Detail page, Laws & Technology tab)
**Priority**: 🟢 Easy
**Type**: Line chart with markers
**Data Sources**: `player_laws`, `laws`

**Current Implementation**:

- ✅ X-axis: Turn number
- ✅ Y-axis: Cumulative law count by class
- ✅ Series: One line per player (color-coded by nation)
- ✅ Law name markers with tooltips on adoption events
- ✅ Series filter for player selection
- ✅ Fullscreen support

**Insights**:

- Law adoption pace comparison
- Law class preferences (Champions, Traders, etc.)
- Government stability through law accumulation

**File**: `/src/routes/game/[id]/+page.svelte` (Laws & Technology tab)

---

### 7.3 Technology Timeline (PLANNED)

**Priority**: 🟡 Medium
**Type**: Gantt chart / timeline
**Data Sources**: `technologies_completed`, `technology_progress`

**Visualization**:

- X-axis: Turn number
- Y-axis: Tech name (grouped by tree/era)
- Bars: Research duration (start to completion)

**Insights**:

- Research speed
- Tech path prioritization
- Bottlenecks (long research times)

---

### 7.4 Tech Tree Path Visualization

**Priority**: 🔴 Complex
**Type**: Tree/graph diagram
**Data Sources**: `technologies_completed`, tech tree prerequisites

**Visualization**:

- Nodes: Technologies
- Edges: Prerequisites
- Node color: Completed (green), in-progress (yellow), available (gray), locked (red)

**Insights**:

- Research strategy
- Path to specific techs
- Skipped technologies

**Complexity**: Requires tech tree definition data

---

### 7.5 Science Output Analysis

**Status**: ✅ IMPLEMENTED (Game Detail page, Economics tab)
**Priority**: 🟢 Easy
**Type**: Line chart
**Data Sources**: `yield_history` (YIELD_SCIENCE)

**Current Implementation**:

- ✅ X-axis: Turn number
- ✅ Y-axis: Science per turn (correctly divided by 10)
- ✅ Series: One line per player (color-coded by nation)

**Potential Enhancements**:

- Annotations for major tech completions
- Tech completion markers on chart
- Science acceleration rate calculation

**Insights**:

- Science scaling over time
- Impact of buildings/specialists on research

**File**: `/src/routes/game/[id]/+page.svelte` (Economics tab, Science chart)

---

### 7.6 Cross-Player Tech Race

**Priority**: 🟡 Medium
**Type**: Multi-line chart
**Data Sources**: `technologies_completed` (cross-player)

**Visualization**:

- X-axis: Turn number
- Y-axis: Total techs completed
- Series: One line per player

**Insights**:

- Tech leadership
- Catch-up mechanics
- Era transitions timing

---

## 8. Map Control & Expansion

### 8.1 Territory Control Map

**Priority**: 🔴 Complex
**Type**: Interactive map
**Data Sources**: `tiles`, `tile_ownership_history`

**Visualization**:

- Hex grid map
- Color: Owner player (by nation color)
- Terrain overlay: terrain, height, vegetation
- Resources: Icon overlay
- Improvements: Icon overlay
- Animation: Territory changes over time

**Insights**:

- Expansion patterns
- Contested regions
- Strategic resource control

**Complexity**: Requires hex grid rendering, spatial data visualization

---

### 8.2 Territorial Expansion Timeline

**Status**: 📋 PLANNED (Data available in `tile_ownership_history`, not yet exposed)
**Priority**: 🟡 Medium
**Type**: Area chart
**Data Sources**: `tile_ownership_history`

**Visualization**:

- X-axis: Turn number
- Y-axis: Tile count
- Series: One area per player (stacked or overlapping)

**Implementation Notes**: Need backend query `get_territorial_expansion(matchId)`, area/line chart

**Insights**:

- Expansion rate
- Territorial gains/losses
- Stagnation periods

---

### 8.3 Resource Control Analysis

**Priority**: 🟡 Medium
**Type**: Bar chart
**Data Sources**: `tiles` (resource column)

**Metrics**:

- Count of each resource type controlled by player
- Strategic resource monopolies
- Luxury resource diversity

**Insights**:

- Resource advantages
- Trade leverage
- Missing resources (vulnerabilities)

---

### 8.4 Improvement Coverage

**Priority**: 🟢 Easy
**Type**: Stacked bar chart
**Data Sources**: `tiles`

**Metrics**:

- Tiles improved vs unimproved
- Improvement type distribution
- Pillaged improvements (maintenance issues)

**Insights**:

- Infrastructure development
- Yield optimization opportunities

---

### 8.5 Map Density Heatmap

**Priority**: 🟡 Medium
**Type**: Heatmap overlay on map
**Data Sources**: `tiles`, `cities`

**Metrics**:

- City density (cities per region)
- Specialist density
- Improvement density

**Insights**:

- Developed vs undeveloped regions
- Optimal expansion targets

---

## 9. City Management & Urbanization

### 9.1 City Count Timeline

**Status**: 📋 PLANNED (Data available in `cities` table, not yet exposed)
**Priority**: 🟢 Easy
**Type**: Line chart
**Data Sources**: `cities`

**Visualization**:

- X-axis: Turn number
- Y-axis: City count
- Series: One line per player

**Implementation Notes**: Need backend query to count cities by player over time, line chart similar to existing

**Insights**:

- Expansion pace
- City founding strategies

**Note**: Requires tracking city founded_turn and aggregating by turn

---

### 9.2 Population Growth

**Priority**: 🟢 Easy
**Type**: Multi-line chart
**Data Sources**: `cities`

**Visualization**:

- X-axis: Turn number
- Y-axis: Total population (sum of all cities)
- Series: Per player OR per city (toggle)

**Insights**:

- Population growth trajectory
- Growth rate comparison

---

### 9.3 City Production Analysis

**Priority**: 🟡 Medium
**Type**: Horizontal bar chart
**Data Sources**: `city_production_queue`, `city_units_produced`, `city_projects_completed`

**Metrics**:

- Units produced per city
- Projects completed per city
- Production diversity index

**Insights**:

- Specialized vs generalist cities
- Production efficiency

---

### 9.4 City Yields Dashboard

**Priority**: 🟡 Medium
**Type**: Table with sparklines
**Data Sources**: `cities`, `city_yields`

**Columns**:

- City name
- Population
- Growth progress
- Culture level
- Happiness level
- Yields (with sparklines showing trends)

**Value**: Comprehensive city health monitoring

---

### 9.5 Governor Effectiveness

**Priority**: 🟡 Medium
**Type**: Scatter plot
**Data Sources**: `cities`, `characters`, `character_stats`

**Visualization**:

- X-axis: Governor wisdom/charisma
- Y-axis: City yield output
- Point size: City population
- Color: City age

**Insights**:

- Correlation between governor stats and city performance
- Optimal governor allocation

---

### 9.6 City Culture Competition

**Priority**: 🟡 Medium
**Type**: Stacked bar chart
**Data Sources**: `city_culture`

**Visualization**:

- X-axis: Cities
- Y-axis: Culture level
- Stacked bars: Culture by team

**Insights**:

- Cultural pressure on border cities
- Cultural flip risks

---

### 9.7 City Specialization Matrix

**Priority**: 🟡 Medium
**Type**: Heatmap
**Data Sources**: `cities`, `city_yields`

**Visualization**:

- Rows: Cities
- Columns: Yield types
- Cell color: Yield production intensity

**Insights**:

- Which cities specialize in which yields
- Balanced vs specialized city strategies

---

## 10. Event Narrative & Story Choices

### 10.1 Event Choice Distribution

**Status**: 📋 PLANNED (Data available in `story_choices`, `story_events`, not yet exposed)
**Priority**: 🟢 Easy
**Type**: Pie chart / bar chart
**Data Sources**: `story_choices`, `story_events`

**Metrics**:

- Choice frequency by option type
- Player decision patterns (aggressive vs diplomatic, etc.)

**Implementation Notes**: Need backend query `get_event_choices(matchId)`, pie/bar chart

**Insights**:

- Player personality/playstyle
- Risky vs safe decision-making

---

### 10.2 Event Outcome Analysis

**Priority**: 🟡 Medium
**Type**: Sankey diagram
**Data Sources**: `story_events`, `story_choices`, `event_outcomes`

**Visualization**:

- Flow from event type → choice → outcome
- Width: Frequency

**Insights**:

- Best choice outcomes
- Event consequence patterns

---

### 10.3 Event Timeline

**Priority**: 🟡 Medium
**Type**: Timeline
**Data Sources**: `story_events`, `event_logs`

**Visualization**:

- X-axis: Turn number
- Y-axis: Event categories
- Points: Individual events (with tooltips showing details)

**Insights**:

- Event clustering (eventful periods)
- Event trigger patterns

---

### 10.4 Memory Impact Analysis

**Priority**: 🟡 Medium
**Type**: Bar chart
**Data Sources**: `memory_data`

**Metrics**:

- Memory count by type
- Memory duration analysis
- Impact on diplomacy/family opinion

**Insights**:

- What creates lasting impressions
- Memory decay patterns

---

## 11. Cross-Match Comparative Analysis

### 11.1 Player Performance Dashboard

**Priority**: 🟡 Medium
**Type**: Multi-metric card
**Data Sources**: `player_performance` view, `matches`, `players`

**Metrics** (per player across all matches):

- Total matches played
- Win count & win rate
- Average final score
- Favorite nation
- Average game length

**Value**: Player skill tracking over time

---

### 11.2 Nation Win Rates

**Status**: 🔨 PARTIAL (Games by nation chart on Overview page, no win rate calculation)
**Priority**: 🟢 Easy
**Type**: Bar chart
**Data Sources**: `players`, `matches`

**Current Implementation**:

- ✅ Bar chart showing games played per nation
- ✅ Nation-specific colors
- ✅ Formatted nation names

**Missing Features**:

- Win % by nation
- Average final score by nation
- Win/loss breakdown

**Enhancement Path**: Add backend query to calculate win rates, expand chart to show wins vs total games

**Insights**:

- Nation balance
- Meta-game dominant civilizations

**File**: `/src/routes/+page.svelte` (Overview page)

---

### 11.3 Map Size Impact Analysis

**Priority**: 🟡 Medium
**Type**: Grouped bar chart
**Data Sources**: `matches`

**Metrics**:

- Average game length by map size
- Average final score by map size
- Victory condition distribution by map size

**Insights**:

- How map size affects gameplay
- Optimal settings for different playstyles

---

### 11.4 Difficulty vs Performance

**Priority**: 🟡 Medium
**Type**: Box plot
**Data Sources**: `matches`, `players`

**Visualization**:

- X-axis: Difficulty level
- Y-axis: Final score distribution
- Box plot showing score ranges

**Insights**:

- Difficulty impact on outcomes
- Score normalization needs

---

### 11.5 Victory Condition Frequency

**Priority**: 🟢 Easy
**Type**: Pie chart
**Data Sources**: `matches`, `player_goals`

**Metrics**:

- How often each victory type is achieved
- Average turns to victory by type

**Insights**:

- Easiest/hardest victory conditions
- Playstyle preferences

---

### 11.6 Meta Strategy Analysis

**Priority**: 🔴 Complex
**Type**: Correlation matrix
**Data Sources**: Multiple tables

**Metrics**:

- Correlation between early-game strategy and victory (e.g., early expansion vs tech focus)
- Tech path → win rate correlation
- Early war → final score correlation

**Insights**:

- Effective opening strategies
- Critical turning point decisions

**Complexity**: Requires defining strategy signatures and statistical analysis

---

### 11.7 Game Length Distribution

**Priority**: 🟢 Easy
**Type**: Histogram
**Data Sources**: `matches`

**Metrics**:

- Distribution of total_turns across all matches
- Average game length by victory type

**Insights**:

- Typical game pacing
- Quick vs long game patterns

---

## 12. Advanced & Experimental

### 12.1 Legitimacy Crisis Detector

**Priority**: 🟡 Medium
**Type**: Alert system / line chart with thresholds
**Data Sources**: `legitimacy_history`

**Metrics**:

- Legitimacy drops below critical thresholds
- Time spent in crisis
- Recovery patterns

**Value**: Historical crisis analysis

---

### 12.2 Economic Boom/Bust Cycles

**Priority**: 🟡 Medium
**Type**: Line chart with cycle detection
**Data Sources**: `yield_history`

**Metrics**:

- Identify periods of rapid growth vs stagnation
- Cycle frequency and amplitude
- Boom trigger events

**Insights**:

- Economic stability vs volatility
- Growth catalysts

---

### 12.3 Inflation Tracking

**Priority**: 🟡 Medium
**Type**: Line chart
**Data Sources**: `yield_prices`

**Metrics**:

- Price index over time
- Inflation rate calculation
- Real vs nominal value comparisons

**Insights**:

- Economic health indicator
- Market manipulation detection

---

### 12.4 Turn-by-Turn Replay System

**Priority**: 🔴 Complex
**Type**: Interactive animation
**Data Sources**: All time-series tables

**Features**:

- Scrubber to move through turns
- All visualizations update in sync
- Playback controls (play, pause, speed)

**Value**: Cinematic game recap, educational tool

**Complexity**: High - requires synchronized state management

---

### 12.5 AI Behavior Pattern Recognition

**Priority**: 🔴 Complex
**Type**: Machine learning insights
**Data Sources**: All tables (AI player actions)

**Metrics**:

- AI decision patterns
- Predictable behaviors
- Exploitable weaknesses

**Complexity**: Requires ML models, large dataset

---

### 12.6 "What-If" Scenario Simulator

**Priority**: 🔴 Complex
**Type**: Interactive simulator
**Data Sources**: All tables + game rules engine

**Features**:

- Rewind to any turn
- Modify decisions (e.g., different tech choice)
- Simulate forward with AI

**Complexity**: Requires game logic implementation

---

## Implementation Priorities

### Phase 1: Core Analytics (MVP)

**Goal**: Essential insights for every match

**Status**: 50% Complete (5/10 features)

**Completed**:

1. ✅ Victory Points Timeline (1.2)
2. ✅ Yield Production Timeline (2.1)
3. ✅ Military Power Timeline (3.1)
4. ✅ Match Summary Card (1.1) - Winner display, victory conditions, DLC list
5. ✅ Law Adoption History (7.2) - Laws & Technology tab

**Remaining**: 6. 📋 Family Opinion Tracker (4.3) 7. 📋 Religion Opinion Tracker (4.4) 8. 📋 Tech Tree Completion (7.1) 9. 📋 Territorial Expansion Timeline (8.2) 10. 📋 City Count Timeline (9.1)

**Rationale**: Covers all major game systems with simple visualizations

**Recommended Next Steps**:

1. Add Family Opinion Tracker (similar to existing charts, data already parsed)
2. Add Religion Opinion Tracker (similar to existing charts, data already parsed)
3. Add Tech Tree Completion metrics to Laws & Technology tab

---

### Phase 2: Deep Dive Analysis

**Goal**: Detailed insights for specific areas

1. Dynastic Timeline (5.1) - High player interest
2. Territory Control Map (8.1) - Visually compelling
3. Yield Composition Breakdown (2.2)
4. Unit Production Summary (3.2)
5. Character Stats Distribution (5.3)
6. Resource Control Analysis (8.3)
7. Population Growth (9.2)
8. Technology Timeline (7.2)
9. Diplomacy Matrix (4.1)
10. City Production Analysis (9.3)

**Rationale**: Player-requested features, visual appeal

---

### Phase 3: Comparative & Advanced

**Goal**: Cross-match insights and advanced analytics

1. Player Performance Dashboard (11.1)
2. Nation Win Rates (11.2)
3. Character Relationship Network (5.7)
4. Tech Tree Path Visualization (7.3)
5. Event Outcome Analysis (10.2)
6. Map Density Heatmap (8.5)
7. Governor Effectiveness (9.5)
8. Meta Strategy Analysis (11.6)

**Rationale**: Requires multiple matches, complex visualizations

---

### Phase 4: Experimental & Polish

**Goal**: Innovative features and UX refinement

1. Turn-by-Turn Replay System (12.4)
2. Religion Spread Map (6.3)
3. War Timeline (3.3)
4. Economic Boom/Bust Cycles (12.2)
5. City Yields Dashboard (9.4)
6. Ruler Succession Timeline (5.2)

**Rationale**: High complexity, experimental value

---

## Data Quality Considerations

### Known Limitations

1. **Unit Tracking**: Individual unit state not persisted in XML saves
   - **Impact**: Cannot show detailed unit movement, kill ratios per unit
   - **Mitigation**: Use aggregate production data, event logs for casualties

2. **Fixed-Point Arithmetic**: `yield_history` stores values as integers
   - **Impact**: Must divide by 10 for display (215 → 21.5)
   - **Mitigation**: Document clearly, add utility functions

3. **Incomplete XML Coverage**: ~85% of XML structures captured
   - **Impact**: Some niche features may lack data
   - **Mitigation**: Prioritize well-covered areas, document gaps

4. **Multi-Turn Snapshots**: Single save file = single point in time
   - **Impact**: Time-series data only if multiple saves from same game
   - **Mitigation**: Encourage players to export saves regularly

### Performance Optimization

1. **Large Time-Series Queries**: Turn-by-turn data can be massive
   - **Solution**: Aggregate queries, pagination, sampling for long games

2. **Cross-Match Aggregation**: Analyzing 100+ matches simultaneously
   - **Solution**: Materialized views, caching, background computation

3. **Map Rendering**: 10,000+ tiles with overlays
   - **Solution**: Canvas rendering, viewport culling, LOD

---

## Visualization Library Recommendations

### Current Stack

- **Apache ECharts**: Already integrated, excellent for:
  - Line charts, bar charts, area charts
  - Multi-series, interactive tooltips
  - Export functionality

### Additional Libraries (if needed)

1. **D3.js**: For advanced custom visualizations
   - Family trees (dendrograms)
   - Network graphs (character relationships)
   - Geospatial maps (if ECharts insufficient)

2. **Leaflet / Pigeon Maps**: For hex grid map rendering
   - Tile-based rendering
   - Zoom/pan interactions
   - Overlay support

3. **React Flow / Cytoscape.js**: For graph/network visualizations
   - Tech tree paths
   - Character relationship networks

4. **Recharts**: Simpler alternative to ECharts (if needed)
   - Svelte integration might be easier
   - Less feature-rich but lighter weight

**Recommendation**: Maximize ECharts usage before adding dependencies

---

## User Experience Considerations

### 1. Progressive Disclosure

- **Problem**: Too many stats overwhelming
- **Solution**:
  - Landing page with high-level summary
  - Drill-down to detailed views
  - Collapsible sections

### 2. Comparative Mode

- **Feature**: Select 2-4 players/matches to compare side-by-side
- **Value**: Understand relative performance

### 3. Time Range Filtering

- **Feature**: Slider to focus on specific turn ranges
- **Value**: Isolate critical game phases (early, mid, late game)

### 4. Export & Sharing

- **Feature**: Export charts as PNG, share match summaries
- **Value**: Community engagement, content creation

### 5. Narrative Insights

- **Feature**: Auto-generated commentary (e.g., "Player dominated economically but fell behind militarily in Turn 50-100")
- **Value**: Actionable insights without manual analysis

---

## Conclusion

The Per-Ankh database provides a rich foundation for comprehensive Old World analytics. This report identifies **70+ potential statistics and visualizations** across 11 analytical categories.

**Current Status**:

- **Implementation Progress**: ~15% of total features (5 of 40 core features)
- **Phase 1 (MVP)**: 50% complete (5/10 features)
- **Strong Foundation**: Centralized API, type-safe data layer, reusable Chart component with series filters and fullscreen support, nation color theming

**Implemented Features**:

- ✅ Victory Points Timeline (Events)
- ✅ Military Power Timeline (Events)
- ✅ Legitimacy Timeline (Economics)
- ✅ 6 Yield Production Charts (Economics: Science, Civics, Training, Growth, Culture, Happiness)
- ✅ Games by Nation Chart (Overview)
- ✅ Match Summary Card (Settings) - Winner display, victory conditions, DLC list
- ✅ Law Adoption History (Laws & Technology) - Cumulative law adoption with markers

**Recent Enhancements**:

- ✅ Series filters on all game detail charts (toggle player visibility)
- ✅ Fullscreen chart support with open/close animations
- ✅ Event log filtering and deduplication
- ✅ Egyptian hieroglyph animation in import modal

**Immediate Next Steps** (Complete Phase 1 MVP):

1. Family Opinion Tracker - data ready, similar pattern to existing charts
2. Religion Opinion Tracker - data ready, similar pattern to existing charts
3. Tech Tree Completion metrics - add to Laws & Technology tab
4. Territorial Expansion Timeline
5. City Count Timeline

**Recommended Implementation Approach**:

1. ✅ ~~Start with Phase 1 (10 core visualizations)~~ **In Progress: 5/10 done**
2. Complete remaining Phase 1 features (5 features, all "Easy" priority)
3. Gather user feedback on most valuable insights
4. Iteratively add Phase 2-4 features based on demand
5. Maintain focus on performance and usability as dataset grows

**Key Success Factors**:

- ✅ Leverage existing ECharts expertise - already working well
- ✅ Prioritize well-supported data areas first - family/religion/tech/city data all ready
- Document data quality limitations clearly
- Design for scalability (100+ matches, 500+ turn games)

**Data Advantage**: With 54 tables and comprehensive time-series tracking already in place, the hard work (data collection) is done. Most remaining features are simple backend queries + chart configurations following existing patterns.

**Recent Progress** (2025-11-22):

- ✅ Match Summary Card complete (winner display, victory type, victory conditions, DLC list)
- ✅ Law Adoption History chart added to Laws & Technology tab
- ✅ Series filters added to all game detail charts
- ✅ Fullscreen chart support with animations

---

## Appendix: Quick Reference Tables

### Visualization Type Quick Reference

| Visualization Type | Best For                   | Complexity | Library         |
| ------------------ | -------------------------- | ---------- | --------------- |
| Line Chart         | Time-series trends         | 🟢 Easy    | ECharts         |
| Bar Chart          | Categorical comparisons    | 🟢 Easy    | ECharts         |
| Pie Chart          | Composition/distribution   | 🟢 Easy    | ECharts         |
| Stacked Area       | Composition over time      | 🟢 Easy    | ECharts         |
| Heatmap            | Multi-dimensional patterns | 🟡 Medium  | ECharts         |
| Scatter Plot       | Correlation analysis       | 🟡 Medium  | ECharts         |
| Radar/Spider       | Multi-attribute comparison | 🟡 Medium  | ECharts         |
| Sankey             | Flow analysis              | 🟡 Medium  | ECharts         |
| Tree/Dendrogram    | Hierarchical data          | 🔴 Complex | D3.js           |
| Network Graph      | Relationships              | 🔴 Complex | D3.js/Cytoscape |
| Geospatial Map     | Spatial data               | 🔴 Complex | Leaflet/Custom  |

### Data Table Quick Reference

| Analysis Category | Primary Tables                                          | Time-Series Tables                               |
| ----------------- | ------------------------------------------------------- | ------------------------------------------------ |
| Match Overview    | matches, players                                        | -                                                |
| Economics         | player_resources                                        | yield_history, yield_prices                      |
| Military          | player_units_produced, city_units_produced              | military_history                                 |
| Diplomacy         | diplomacy, memory_data                                  | family_opinion_history, religion_opinion_history |
| Characters        | characters, character_traits, character_stats           | -                                                |
| Families          | families, family_law_opinions                           | family_opinion_history                           |
| Religions         | religions, city_religions                               | religion_opinion_history                         |
| Technology        | technologies_completed, technology_progress             | -                                                |
| Map               | tiles, tile_changes                                     | tile_ownership_history                           |
| Cities            | cities, city_yields, city_production_queue              | -                                                |
| Events            | story_events, story_choices, event_outcomes, event_logs | -                                                |

---

---

## Implementation Status Summary

### By Category

| Category                 | Total Features | Implemented | Partial | Planned |
| ------------------------ | -------------- | ----------- | ------- | ------- |
| Match Overview & Victory | 4              | 2           | 0       | 2       |
| Economic Performance     | 6              | 1           | 0       | 5       |
| Military & Warfare       | 5              | 1           | 0       | 4       |
| Diplomatic Relations     | 5              | 0           | 0       | 5       |
| Character & Dynasty      | 8              | 0           | 0       | 8       |
| Family & Religion        | 5              | 0           | 0       | 5       |
| Technology & Research    | 6              | 2           | 0       | 4       |
| Map Control & Expansion  | 5              | 0           | 0       | 5       |
| City Management          | 7              | 0           | 0       | 7       |
| Event Narrative          | 4              | 0           | 0       | 4       |
| Cross-Match Analysis     | 7              | 0           | 1       | 6       |
| Advanced & Experimental  | 6              | 0           | 0       | 6       |
| **TOTAL**                | **68**         | **6**       | **1**   | **61**  |

### Quick Wins (Easy features with data ready)

These features can be added quickly following existing chart patterns:

1. **Family Opinion Tracker** (4.3) - Line chart, similar to Victory Points
2. **Religion Opinion Tracker** (4.4) - Line chart, similar to Victory Points
3. **Resource Stockpiles** (2.3) - Bar chart, new backend query needed
4. **Unit Production Summary** (3.2) - Horizontal bar chart
5. **Tech Tree Completion** (7.1) - Progress bars/percentages
6. **City Count Timeline** (9.1) - Line chart
7. **Event Choice Distribution** (10.1) - Pie/bar chart

All use existing Chart component, similar query patterns, and ECharts configurations.

---

**Document Version**: 2.2 (Validation and status update)
**Last Updated**: 2025-11-22
**Author**: Claude Code Analysis
**Database Schema Version**: 2.2

**Changelog**:

- 2025-11-22 v2.2: Validated report against codebase; updated Match Summary Card to IMPLEMENTED; added Law Adoption History (7.2); updated Phase 1 progress to 50%; added series filter and fullscreen enhancements
- 2025-11-15 v2.1: Updated Feature 1.1 to reflect winner backend completion, frontend pending
- 2025-11-15 v2.0: Initial status tracking across all features
- 2025-11-14 v1.0: Original feature catalog
