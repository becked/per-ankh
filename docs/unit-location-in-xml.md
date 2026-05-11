# Unit Data Locations in XML

> **Corrected 2026-05-10.** A prior version of this doc claimed individual
> unit instances are not present in save files. That was wrong — verified
> against saves from 2022-09 through 2026-04, every save contains
> hundreds of `<Unit>` elements nested inside `<Tile>` elements with full
> per-unit state (XP, promotions, family, facing, etc.). The current
> parser at `src/lib/parser/parsers/units.ts` handles them.

## 1. Individual Unit Instances (`<Tile>/<Unit>`)

**Location:** nested directly inside each top-level `<Tile>` element.

**Counts (verified across `test-data/saves/`):**

| Save (version year) | `<Tile>/<Unit>` instances |
| ------------------- | ------------------------- |
| OW-Rome (2022)      | 419                       |
| OW-Babylonia (2024) | 272                       |
| OW-Aksum (2025)     | 290                       |
| OW-Maurya (2026)    | 223                       |

**Example (OW-Maurya-Year111, Tile 489):**

```xml
<Tile ID="489">
  ...
  <Unit
    ID="365"
    Type="UNIT_BIREME"
    Player="0"
    Tribe="NONE"
    Seed="18046197664133222740">
    <XP>30</XP>
    <TurnsSinceLastMove>11</TurnsSinceLastMove>
    <CreateTurn>90</CreateTurn>
    <Facing>NE</Facing>
    <OriginalPlayer>0</OriginalPlayer>
    <RaidTurn />
    <PlayerFamily>
      <P.0>FAMILY_KOSALA</P.0>
    </PlayerFamily>
    <QueueList />
    <PromotionsAvailable>
      <PROMOTION_STRIKE1 />
      <PROMOTION_TRACKER />
      <PROMOTION_SEABORN />
      <PROMOTION_LADING />
    </PromotionsAvailable>
    <AI />
  </Unit>
</Tile>
```

**Attributes:** `ID`, `Type` (e.g. `UNIT_BIREME`), `Player` (`-1` for
barbarians/tribal), `Tribe` (`NONE` or `TRIBE_*`), `Seed` (i64).

**Common child elements:** `XP`, `Level`, `CreateTurn`, `Facing`,
`OriginalPlayer`, `TurnsSinceLastMove`, `Gender` (workers),
`Sleep` (self-closing), `CurrentFormation`, `Promotions` (acquired),
`PromotionsAvailable`, `BonusEffectUnits` (e.g.
`<EFFECTUNIT_STEADFAST>1</EFFECTUNIT_STEADFAST>`), `PlayerFamily`,
`RaidTurn`, `QueueList`, `AI`.

**Note: `<Unit>` does NOT appear at the XML root.** Only nested inside
`<Tile>`. (The original doc's confusion likely came from grepping the
root level only.)

## 2. Last-Seen Unit References (`<Player>/.../<LastSeenUnits>/<Unit>`)

Separate from per-tile unit instances, players also have
`<LastSeenUnits>` blocks recording fog-of-war: where the player last
observed each known unit.

```xml
<LastSeenUnits>
  <Unit TileID="1894">28</Unit>
  <Unit TileID="2166">55</Unit>
  ...
</LastSeenUnits>
```

Text content is the referenced unit's `ID`; `TileID` is where it was
last seen. These are references, not unit definitions.

## 3. Player-Level Unit Totals (`<UnitsProduced>`)

Location: `<Player>/<UnitsProduced>`. Total count of each unit type
produced over the game.

```xml
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
```

## 4. Player-Level Snapshot (`<UnitsProducedTurn>`)

Location: `<Player>/<UnitsProducedTurn>`. Appears identical to
`<UnitsProduced>` at end-of-game — possibly a snapshot from when the
turn ended, kept for historical reasons.

## 5. City-Level Unit Production (`<UnitProductionCounts>`)

Location: `<City>/<UnitProductionCounts>`. Units produced per city.

```xml
<City ID="5" Name="Akkad" Player="0">
  <UnitProductionCounts>
    <UNIT_SETTLER>4</UNIT_SETTLER>
    <UNIT_WORKER>1</UNIT_WORKER>
  </UnitProductionCounts>
</City>
```

## 6. Military Power History (`<MilitaryPowerHistory>`)

Location: `<Player>/<MilitaryPowerHistory>`. Total military strength
score per turn.

```xml
<MilitaryPowerHistory>
  <T2>40</T2>
  <T3>40</T3>
  <T15>80</T15>
  <T21>160</T21>
</MilitaryPowerHistory>
```

## 7. Combat Statistics (`<Stat>`)

Location: `<Player>/<Stat>`. Combat performance metrics.

```xml
<Stat>
  <STAT_UNIT_MILITARY_KILLED>29</STAT_UNIT_MILITARY_KILLED>
  <STAT_UNIT_MILITARY_KILLED_ANY_GENERAL>12</STAT_UNIT_MILITARY_KILLED_ANY_GENERAL>
  <STAT_UNIT_MILITARY_KILLED_GENERAL>6</STAT_UNIT_MILITARY_KILLED_GENERAL>
  <STAT_UNIT_LOST>11</STAT_UNIT_LOST>
  <STAT_REGULAR_MILITARY_LOST>7</STAT_REGULAR_MILITARY_LOST>
  <STAT_UNIT_PROMOTED>11</STAT_UNIT_PROMOTED>
  <STAT_UNIT_HEALED>25</STAT_UNIT_HEALED>
  <STAT_UNIT_TRAINED>37</STAT_UNIT_TRAINED>
  <STAT_CITY_CAPTURED>1</STAT_CITY_CAPTURED>
  <STAT_CITY_LOST>1</STAT_CITY_LOST>
</Stat>
```

Combat metrics include kills (`STAT_UNIT_MILITARY_KILLED`,
`STAT_UNIT_MILITARY_KILLED_GENERAL`), losses (`STAT_UNIT_LOST`,
`STAT_REGULAR_MILITARY_LOST`), support (`STAT_UNIT_PROMOTED`,
`STAT_UNIT_HEALED`), and territorial (`STAT_CITY_CAPTURED`,
`STAT_CITY_LOST`).

## What's actually NOT in the XML

- Unit display names (units are referenced only by `UNIT_*` type).
- Current HP as a separate field (HP is implicit in `Level` + `XP`
  alongside the unit type's max-HP rules).

Everything else commonly assumed missing — positions, experience,
promotions, family, facing — IS present. See section 1.
