
  ---
  Summary: Unit Data Locations in XML

  1. Player-Level Unit Totals (<UnitsProduced>)

  Location: <Player>/<UnitsProduced>

  What it tracks: Total count of each unit type produced by the player
   throughout the entire game.

  <Player ID="0" OnlineID="...">
    <UnitsProduced>
      <UNIT_SETTLER>6</UNIT_SETTLER>
      <UNIT_WORKER>7</UNIT_WORKER>
      <UNIT_MILITIA>6</UNIT_MILITIA>
      <UNIT_WARRIOR>5</UNIT_WARRIOR>
      <UNIT_SPEARMAN>2</UNIT_SPEARMAN>
      <UNIT_SLINGER>4</UNIT_SLINGER>
      <UNIT_CHARIOT>5</UNIT_CHARIOT>
    </UnitsProduced>
  </Player>


  ---
  2. Player-Level Snapshot (<UnitsProducedTurn>)

  Location: <Player>/<UnitsProducedTurn>

  What it tracks: Appears to be identical to <UnitsProduced>
  (end-of-game snapshot). Possibly historical reasons for duplication.

  <UnitsProducedTurn>
    <UNIT_SETTLER>6</UNIT_SETTLER>
    <UNIT_WORKER>7</UNIT_WORKER>
    ...
  </UnitsProducedTurn>


  ---
  3. City-Level Unit Production (<UnitProductionCounts>)

  Location: <CityList>/<City>/<UnitProductionCounts>

  What it tracks: Units produced by each specific city. Lets you
  analyze which cities were military factories vs. expansion engines.

  <City ID="5" Name="Akkad" Player="0">
    <UnitProductionCounts>
      <UNIT_SETTLER>4</UNIT_SETTLER>
      <UNIT_WORKER>1</UNIT_WORKER>
    </UnitProductionCounts>
  </City>


  ---
  What's NOT in the XML

  Individual unit instances - The XML does not appear to track:
  - Specific unit locations on the map
  - Unit health/experience
  - Unit names
  - Currently alive units

  The save only stores production counts (how many were built), not
  the units themselves.

  ---
  Use Cases

  | Data Source           | Best For
                                |
  |-----------------------|-------------------------------------------
  ------------------------------|
  | player_units_produced | "Who built the most military?" "Settler
  spam strategy?"                 |
  | city_unit_production  | "Which cities produced the most units?"
  "Capital vs. expansion cities?" |

  the codebase!



  ---
  Military Unit Data in XML

  1. Military Power by Turn (<MilitaryPowerHistory>) ✅ TRACKED

  Location: <Player>/<MilitaryPowerHistory>

  What it tracks: Total military strength score for each turn

  <Player ID="0">
    <MilitaryPowerHistory>
      <T2>40</T2>
      <T3>40</T3>
      <T4>40</T4>
      <T15>80</T15>
      <T21>160</T21>
    </MilitaryPowerHistory>
  </Player>


  ---
  2. Military Units Produced (<UnitsProduced>)

  Location: <Player>/<UnitsProduced>

  What it tracks: Count of each military unit type produced

  <UnitsProduced>
    <UNIT_MILITIA>6</UNIT_MILITIA>
    <UNIT_WARRIOR>5</UNIT_WARRIOR>
    <UNIT_SPEARMAN>2</UNIT_SPEARMAN>
    <UNIT_CHARIOT>5</UNIT_CHARIOT>
    <UNIT_ARCHER>1</UNIT_ARCHER>
  </UnitsProduced>


  ---
  3. Combat Statistics (<Stat>)

  Location: <Player>/<Stat>

  What it tracks: Combat performance metrics

  <Stat>
    <STAT_UNIT_MILITARY_KILLED>29</STAT_UNIT_MILITARY_KILLED>
    <STAT_UNIT_MILITARY_KILLED_ANY_GENERAL>12</STAT_UNIT_MILITARY_KILL
  ED_ANY_GENERAL>
    <STAT_UNIT_MILITARY_KILLED_GENERAL>6</STAT_UNIT_MILITARY_KILLED_GE
  NERAL>
    <STAT_UNIT_LOST>11</STAT_UNIT_LOST>
    <STAT_REGULAR_MILITARY_LOST>7</STAT_REGULAR_MILITARY_LOST>
    <STAT_UNIT_PROMOTED>11</STAT_UNIT_PROMOTED>
    <STAT_UNIT_HEALED>25</STAT_UNIT_HEALED>
    <STAT_UNIT_TRAINED>37</STAT_UNIT_TRAINED>
    <STAT_CITY_CAPTURED>1</STAT_CITY_CAPTURED>
    <STAT_CITY_LOST>1</STAT_CITY_LOST>
  </Stat>


  ---

  ---
  Missing Combat Data

  The <Stat> element contains rich combat analytics that could be
  tracked 

  - Kills: STAT_UNIT_MILITARY_KILLED,
  STAT_UNIT_MILITARY_KILLED_GENERAL
  - Losses: STAT_UNIT_LOST, STAT_REGULAR_MILITARY_LOST
  - Combat support: STAT_UNIT_PROMOTED, STAT_UNIT_HEALED
  - Territorial: STAT_CITY_CAPTURED, STAT_CITY_LOST


