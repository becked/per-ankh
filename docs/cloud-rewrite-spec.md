# Per-Ankh Cloud Rewrite: Technical Specification

This document specifies the architecture and implementation details for rewriting Per-Ankh from a Tauri desktop application (Rust + DuckDB) to a cloud-first web application (TypeScript + Cloudflare D1/R2).

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Parser Rewrite](#2-parser-rewrite)
3. [Data Model](#3-data-model)
4. [API Design](#4-api-design)
5. [Authentication](#5-authentication)
6. [Frontend Migration](#6-frontend-migration)
7. [Sharing Model](#7-sharing-model)
8. [Save File Management](#8-save-file-management)
9. [Cloudflare Resource Limits](#9-cloudflare-resource-limits)
10. [Schema Versioning & Migrations](#10-schema-versioning--migrations)
11. [Map Assets](#11-map-assets)

---

## 1. System Architecture

```
┌──────────────────────────────────────────────────┐
│                    Browser                        │
│                                                   │
│  ┌───────────┐           ┌──────────────────────┐│
│  │ SvelteKit │  postMsg  │     Web Worker        ││
│  │ UI        │◄─────────►│     TypeScript        ││
│  │ + ECharts │           │     Save Parser       ││
│  └─────┬─────┘           │  (fflate + fast-xml)  ││
│        │                 └──────────────────────┘│
└────────┼─────────────────────────────────────────┘
         │ HTTPS
         ▼
┌──────────────────────┐
│  Cloudflare Worker   │
│  (API)               │
│       │              │
│  ┌────┼────┐         │
│  ▼    ▼    ▼         │
│ D1   R2   KV         │
└──────────────────────┘
```

### Component Responsibilities

| Component | Role |
|-----------|------|
| **Browser** | File selection, save parsing (Web Worker), game rendering, auth flow |
| **Web Worker** | ZIP extraction, XML parsing, game data extraction. No server-side parsing ever. |
| **Cloudflare Worker** | API router: auth, upload validation, storage, queries, rate limiting |
| **D1 (SQLite)** | User accounts, game metadata, player summaries for cross-game stats |
| **R2 (Objects)** | Full parsed game JSON blobs (gzipped) + raw save ZIPs |
| **KV** | Session tokens with TTL |

### Design Principles

- **Browser-first computation.** All save file parsing happens client-side. The server never parses save files. Server costs stay minimal.
- **Two-tier storage.** D1 holds small queryable rows (cross-game stats). R2 holds large blobs (full game data). This keeps D1 small and R2 cheap.
- **Progressive sharing.** Games are private by default. Sharing is a visibility toggle, not a separate upload step.
- **Fault-tolerant.** If the backend is down, users can still parse and view saves locally (future enhancement). The core parser runs entirely in the browser.

---

## 2. Parser Rewrite

The Rust parser (~5,300 LOC across 17 modules) is rewritten in TypeScript. The inserter layer (~2,700 LOC) is eliminated — the parser returns structured data directly, no database writes on the client.

### Why TypeScript, not WASM

We considered porting the existing Rust parser to WASM via `wasm-bindgen` to avoid rewriting working code. Rejected for v1:

- **Save sizes don't justify it.** Largest observed save is 28 MB XML; typical is 5–15 MB. Pure-JS parsing handles this in 80–150 MB heap, which is fine on any laptop and acceptable on mobile. The original memory argument for WASM doesn't hold.
- **Bundle cost.** WASM build of the parser would add ~500 KB–1 MB to every page load. TS port is ~60 KB (`fast-xml-parser` + `fflate`).
- **Build and iteration complexity.** Cargo workspace alongside Vite, slower compile cycle, harder debugging across the WASM/JS boundary.
- **Two-language maintenance after Tauri deprecation.** With desktop going away, keeping Rust solely for the WASM parser means maintaining a Cargo workspace and Rust knowledge for one purpose. Higher contributor barrier; no other reason to keep Rust.
- **The "free reuse" isn't free.** The Rust parser is currently entangled with DuckDB types and the inserter layer. Extracting just the pure parsing code would be ~2–3 days of cleanup before it could be wrapped for WASM.

The TS port is a clean break aligned with deprecating Tauri.

### Web Worker Setup

```typescript
// src/lib/parser/worker.ts

type ParseRequest = { type: "parse"; file: ArrayBuffer; fileName: string };
type ParseProgress = { type: "progress"; phase: string; percent: number };
type ParseResult = { type: "result"; data: GameData; rawZip: ArrayBuffer };
type ParseError = { type: "error"; message: string; code: string };

self.onmessage = async (e: MessageEvent<ParseRequest>) => {
  try {
    postMessage({ type: "progress", phase: "Extracting ZIP", percent: 0 });
    const xml = extractXmlFromZip(e.data.file);

    postMessage({ type: "progress", phase: "Parsing XML", percent: 15 });
    const doc = parseXml(xml);

    postMessage({ type: "progress", phase: "Extracting game data", percent: 30 });
    const gameData = extractAllGameData(doc);

    postMessage({ type: "result", data: gameData, rawZip: e.data.file });
  } catch (err) {
    postMessage({ type: "error", message: err.message, code: err.code ?? "PARSE_ERROR" });
  }
};
```

### ZIP Extraction

Replaces `src-tauri/src/parser/save_file.rs`. Uses `fflate` (~5KB gzipped).

```typescript
import { unzipSync, strFromU8 } from "fflate";

const MAX_COMPRESSED = 50 * 1024 * 1024;   // 50 MB
const MAX_UNCOMPRESSED = 100 * 1024 * 1024; // 100 MB
const MAX_ENTRIES = 10;
const MAX_RATIO = 100;                       // zip bomb threshold

function extractXmlFromZip(buffer: ArrayBuffer): string {
  if (buffer.byteLength > MAX_COMPRESSED) throw new ParseError("File too large", "FILE_TOO_LARGE");
  if (buffer.byteLength === 0) throw new ParseError("Empty file", "EMPTY_FILE");

  const files = unzipSync(new Uint8Array(buffer));
  const entries = Object.keys(files);

  if (entries.length > MAX_ENTRIES) throw new ParseError("Too many entries", "INVALID_ARCHIVE");

  const xmlEntry = entries.find(name => name.toLowerCase().endsWith(".xml"));
  if (!xmlEntry) throw new ParseError("No XML file found", "NO_XML");

  const raw = files[xmlEntry];
  if (raw.byteLength > MAX_UNCOMPRESSED) throw new ParseError("Uncompressed too large", "FILE_TOO_LARGE");

  const ratio = raw.byteLength / buffer.byteLength;
  if (ratio > MAX_RATIO) throw new ParseError("Suspicious compression ratio", "ZIP_BOMB");

  return strFromU8(raw);
}
```

Validation rules match the Rust implementation exactly (same size limits, same zip bomb detection).

### XML Parsing

Replaces `src-tauri/src/parser/xml_loader.rs`. Uses `fast-xml-parser`.

```typescript
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  parseAttributeValue: false,     // Keep as strings, parse manually
  parseTagValue: false,           // Keep text content as strings
  isArray: (name) => ALWAYS_ARRAY_TAGS.has(name),
});

// Elements that can repeat and must always be arrays
const ALWAYS_ARRAY_TAGS = new Set([
  "Player", "Character", "Tile", "City", "Family", "Religion", "Tribe",
  "Unit", "LogData", "GoalData", "DiplomacyRelation",
  "TraitTurn", "RelationshipData", "SpouseData", "CompletedBuild",
  "BuildQueueEntry", "ProjectCount", "AgentData", "LuxuryData",
  "CityReligion", "TeamCulture", "TileChange", "TileVisibility",
  "UnitPromotion", "UnitEffect", "UnitFamily",
]);
```

### XML Traversal Translation

The Rust parser uses `roxmltree` DOM traversal with custom `XmlNodeExt` helpers. With `fast-xml-parser`, XML becomes nested JS objects. Translation pattern:

```rust
// Rust (current)
for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
    let xml_id = player_node.req_attr("ID")?.parse::<i32>()?;
    let name = player_node.req_attr("Name")?.to_string();
    let nation = player_node.opt_attr("Nation").map(|s| s.to_string());
    let legitimacy = player_node.opt_child_text("Legitimacy").and_then(|s| s.parse().ok());
}
```

```typescript
// TypeScript (new)
const players = asArray(root.Player);
for (const p of players) {
  const xmlId = requireInt(p["@_ID"], "Player.ID");
  const name = requireStr(p["@_Name"], "Player.Name");
  const nation = optStr(p["@_Nation"]);
  const legitimacy = optInt(p.Legitimacy);
}
```

Helper functions:

```typescript
function asArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined) return [];
  return Array.isArray(val) ? val : [val];
}

function requireStr(val: unknown, path: string): string {
  if (typeof val !== "string" || val === "")
    throw new ParseError(`Missing required field: ${path}`, "MISSING_FIELD");
  return val;
}

function requireInt(val: unknown, path: string): number {
  const n = parseInt(String(val), 10);
  if (Number.isNaN(n)) throw new ParseError(`Invalid integer: ${path}`, "INVALID_FORMAT");
  return n;
}

function optStr(val: unknown): string | null {
  return typeof val === "string" && val !== "" ? val : null;
}

function optInt(val: unknown): number | null {
  if (val === undefined || val === null || val === "") return null;
  const n = parseInt(String(val), 10);
  return Number.isNaN(n) ? null : n;
}
```

### Sparse Timeseries Pattern

Old World encodes turn-by-turn data as `<T2>40</T2><T5>55</T5>` child elements (sparse — only turns with data are present):

```typescript
function parseSparseHistory(
  parent: Record<string, unknown>
): Array<{ turn: number; value: number }> {
  const result: Array<{ turn: number; value: number }> = [];
  for (const [key, val] of Object.entries(parent)) {
    if (!key.startsWith("T")) continue;
    const turn = parseInt(key.slice(1), 10);
    const value = parseInt(String(val), 10);
    if (!Number.isNaN(turn) && !Number.isNaN(value)) {
      result.push({ turn, value });
    }
  }
  return result;
}
```

### Sentinel Value Handling

Replaces `src-tauri/src/parser/xml_loader.rs` sentinel module. Old World XML uses `-1` for "not set":

```typescript
// src/lib/parser/sentinels.ts
export function normalizeId(id: number): number | null {
  return id === -1 ? null : id;
}

export function normalizeTurn(turn: number): number | null {
  return turn < 0 ? null : turn;
}
```

### Winner Detection

From `src-tauri/src/parser/import.rs` `update_winner()`. A game is complete only if a winner can be determined:

```typescript
function detectWinner(gameElement: XmlNode): WinnerInfo | null {
  // Primary: TeamVictories element
  const teamVictories = gameElement.TeamVictories;
  if (teamVictories) {
    const teamEntry = asArray(teamVictories.Team).find(t => t["@_Victory"]);
    if (teamEntry) {
      return {
        winningTeamId: parseInt(String(teamEntry["#text"]), 10),
        victoryType: String(teamEntry["@_Victory"]),
      };
    }
  }
  // Fallback: Victory element
  if (gameElement.Victory) {
    return {
      winningTeamId: null,
      victoryType: String(gameElement.Victory["@_type"] ?? gameElement.Victory),
    };
  }
  return null;
}
```

The winning team ID is then mapped to a player via the `<Team><PlayerTeam>` elements.

### ID Mapping: Eliminated

The Rust `IdMapper` (338 LOC, `src-tauri/src/parser/id_mapper.rs`) exists solely to translate XML IDs to stable database IDs for DuckDB. In the cloud version, **XML IDs are preserved as-is** in the JSON blob. Cross-references within the blob use XML IDs directly. No ID mapping needed.

### Module Structure

```
src/lib/parser/
  worker.ts              — Web Worker entry point
  types.ts               — GameData and all entity interfaces
  extract-zip.ts         — ZIP validation and XML extraction
  parse-xml.ts           — fast-xml-parser config and helpers
  sentinels.ts           — Sentinel value normalization
  validation.ts          — Completion check, game ID extraction
  parsers/
    players.ts           — From parsers/players.rs (256 LOC → ~150 LOC)
    characters.ts        — From parsers/characters.rs
    cities.ts            — From parsers/cities.rs + city_data.rs (667 LOC → ~400 LOC)
    tiles.ts             — From parsers/tiles.rs + tile ownership history
    families.ts          — From parsers/families.rs
    religions.ts         — From parsers/religions.rs
    tribes.ts            — From parsers/tribes.rs
    units.ts             — From parsers/units.rs
    diplomacy.ts         — From parsers/diplomacy.rs
    player-data.ts       — From parsers/player_data.rs (706 LOC → ~400 LOC)
    character-data.ts    — From parsers/character_data.rs
    timeseries.ts        — From parsers/timeseries.rs
    events.ts            — From parsers/events.rs
    match-metadata.ts    — Root attributes, Game element, winner detection
    index.ts             — Orchestrator: calls all parsers, returns GameData
```

Estimated total: **~2,700 LOC TypeScript** vs ~5,300 LOC Rust parsers + ~2,700 LOC inserters. The reduction comes from eliminating the inserter layer, TS being more concise for optional chaining and object construction, and `fast-xml-parser` returning JS objects directly.

### Error Handling

```typescript
class ParseError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "ParseError";
  }
}
```

Error codes: `FILE_TOO_LARGE`, `EMPTY_FILE`, `INVALID_ARCHIVE`, `NO_XML`, `ZIP_BOMB`, `MISSING_FIELD`, `INVALID_FORMAT`, `INCOMPLETE_GAME`, `NO_GAME_ID`, `NO_PLAYERS`.

### Test Corpus

Two sources of save files for parser development and parity testing:

- `test-data/saves/` — checked into the repo for unit tests. Empty in fresh clones; populate locally with a representative subset before running tests.
- `~/Library/Application Support/OldWorld/Saves/Completed/` — the developer's personal completed-saves library on macOS, containing hundreds of real games across all nations and many game versions. This is the realistic corpus for parity testing the TS parser against the existing Rust parser's output. Path differs on Windows / Linux; macOS path is the relevant one for the primary developer.

Parity test harness (phase 1): a CLI that runs the TS parser over a directory of saves and diffs the resulting `GameData` JSON against the equivalent output from the Rust parser. Differences flagged for investigation. The harness is the validation gate before parser work moves on to wiring up the Worker and UI.

---

## 3. Data Model

### Design: Two-Tier Storage

D1 holds anything we aggregate across games. R2 holds full per-game data for single-game detail rendering.

| Tier | Storage | Contents | Purpose |
|------|---------|----------|---------|
| Queryable | D1 | Users, game metadata, end-of-game player summaries, per-turn yield/military/legitimacy series, tech and law adoption events | Cross-game aggregates, game listing, filtering, dashboards, future tournament analytics |
| Blob | R2 | Full parsed game JSON + raw save ZIPs | Single-game detail rendering (events, characters, tile history, family opinion, etc.) |

Anything we view one game at a time stays in the R2 blob. Anything we ever want to compute across many games at once goes in D1.

### D1 Schema

```sql
-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,               -- nanoid(21)
  discord_id TEXT NOT NULL UNIQUE,        -- Discord snowflake ID
  display_name TEXT NOT NULL,             -- Discord global_name (or username fallback)
  avatar_url TEXT,                        -- Discord CDN avatar URL
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- GAMES (one row per imported game per user)
-- ============================================================

CREATE TABLE games (
  game_id TEXT PRIMARY KEY,               -- nanoid(21), used in URLs
  user_id TEXT NOT NULL REFERENCES users(user_id),

  -- Identity
  xml_game_id TEXT NOT NULL,              -- GameId from <Root GameId="...">
  total_turns INTEGER NOT NULL,           -- From <Game><Turn>
  file_hash TEXT NOT NULL,                -- SHA-256 of raw ZIP (dedup key)

  -- Display
  game_name TEXT,
  save_date TEXT,                         -- ISO 8601

  -- Game settings
  map_size TEXT,                          -- MAPSIZE_TINY, MAPSIZE_SMALL, etc.
  map_class TEXT,
  game_mode TEXT,                         -- NETWORK, SINGLEPLAYER
  difficulty TEXT,
  opponent_level TEXT,

  -- Victory
  winner_nation TEXT,
  winner_name TEXT,
  victory_type TEXT,                      -- VICTORY_POINTS, VICTORY_CONQUEST, etc.

  -- Uploader's player
  user_nation TEXT,
  user_won BOOLEAN,

  -- Visibility
  is_public BOOLEAN NOT NULL DEFAULT FALSE,

  -- Storage metadata
  blob_version INTEGER NOT NULL DEFAULT 2,
  blob_size_bytes INTEGER,
  parser_version TEXT NOT NULL,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE (user_id, file_hash)
);

CREATE INDEX idx_games_user ON games(user_id);
CREATE INDEX idx_games_public ON games(is_public) WHERE is_public = TRUE;

-- ============================================================
-- PLAYER SUMMARIES (end-of-game per-player state)
-- One row per player per game. Drives Nations, Families, Rulers,
-- Cities (via milestones), and skill-rating dashboards.
-- ============================================================

CREATE TABLE player_summaries (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_index INTEGER NOT NULL,          -- 0-based, matches XML order

  -- Identity
  player_name TEXT NOT NULL,
  nation TEXT,
  family_classes TEXT,                    -- JSON array of family classes picked, in order
  pick_order INTEGER,                     -- 0-based pick slot
  is_human BOOLEAN NOT NULL,
  is_uploader BOOLEAN NOT NULL,           -- Is this the uploading user's player?

  -- Starting ruler attributes
  starting_ruler_archetype TEXT,
  starting_ruler_traits TEXT,             -- JSON array
  starting_ruler_reign_turns INTEGER,
  succession_count INTEGER,

  -- Final state
  final_points INTEGER,
  final_military_power INTEGER,
  final_legitimacy INTEGER,
  cities_total INTEGER,
  cities_founded INTEGER,
  techs_completed INTEGER,
  laws_count INTEGER,

  -- Milestones (per-player; cross-match "first to N" comparisons happen in queries)
  fifth_city_turn INTEGER,                -- turn this player founded their 5th city; NULL if never
  tenth_city_turn INTEGER,
  fourth_law_turn INTEGER,
  seventh_law_turn INTEGER,

  -- Result
  is_winner BOOLEAN NOT NULL DEFAULT FALSE,
  vp_margin INTEGER,                      -- this player's VP minus 2nd place; can be negative

  PRIMARY KEY (game_id, player_index)
);

CREATE INDEX idx_summaries_nation ON player_summaries(nation);
CREATE INDEX idx_summaries_archetype ON player_summaries(starting_ruler_archetype);

-- ============================================================
-- GAME PLAYER TURN (per-turn numeric series, wide format)
-- One row per (game, player, turn). Drives all Yields-tab charts,
-- military/legitimacy progression, science vs. win-rate correlation.
-- Wide format chosen over long-format (game,player,turn,metric,value)
-- to keep row counts manageable: 200 turns × 8 players = 1,600 rows
-- per game vs. 48,000 in long format.
-- ============================================================

CREATE TABLE game_player_turn (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_index INTEGER NOT NULL,
  turn INTEGER NOT NULL,

  -- 14 yields × (per-turn rate + cumulative)
  food_per_turn INTEGER,           food_cumulative INTEGER,
  growth_per_turn INTEGER,         growth_cumulative INTEGER,
  science_per_turn INTEGER,        science_cumulative INTEGER,
  culture_per_turn INTEGER,        culture_cumulative INTEGER,
  civics_per_turn INTEGER,         civics_cumulative INTEGER,
  training_per_turn INTEGER,       training_cumulative INTEGER,
  money_per_turn INTEGER,          money_cumulative INTEGER,
  orders_per_turn INTEGER,         orders_cumulative INTEGER,
  happiness_per_turn INTEGER,      happiness_cumulative INTEGER,
  discontent_per_turn INTEGER,     discontent_cumulative INTEGER,
  iron_per_turn INTEGER,           iron_cumulative INTEGER,
  stone_per_turn INTEGER,          stone_cumulative INTEGER,
  wood_per_turn INTEGER,           wood_cumulative INTEGER,
  maintenance_per_turn INTEGER,    maintenance_cumulative INTEGER,

  -- Other per-turn metrics
  military_power INTEGER,
  legitimacy INTEGER,

  PRIMARY KEY (game_id, player_index, turn)
);

CREATE INDEX idx_gpt_game ON game_player_turn(game_id);

-- ============================================================
-- TECH EVENTS (when each tech was researched)
-- Drives tech timing heatmap, tech popularity, winner-vs-loser advantage.
-- ============================================================

CREATE TABLE tech_events (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_index INTEGER NOT NULL,
  tech TEXT NOT NULL,                     -- e.g. 'TECH_MASONRY'
  turn INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_index, tech)
);

CREATE INDEX idx_tech_events_tech ON tech_events(tech);

-- ============================================================
-- LAW EVENTS (when each law was adopted)
-- Drives law timing distribution, time-to-4th/7th law charts.
-- A law may appear multiple times if swapped in and out, hence
-- (game_id, player_index, law, turn) PK rather than unique on law.
-- ============================================================

CREATE TABLE law_events (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_index INTEGER NOT NULL,
  law TEXT NOT NULL,
  turn INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_index, law, turn)
);

CREATE INDEX idx_law_events_law ON law_events(law);

-- ============================================================
-- EVENTS (audit log + rate limiting)
-- ============================================================

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,               -- 'upload', 'delete', 'login'
  game_id TEXT,
  user_id TEXT,
  ip_address TEXT,
  metadata TEXT,                          -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_events_user ON events(user_id, event_type, created_at);
CREATE INDEX idx_events_ip ON events(ip_address, event_type, created_at);

CREATE TABLE blocked_ips (
  ip_address TEXT PRIMARY KEY,
  reason TEXT,
  blocked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### R2 Objects

Each game produces two R2 objects:

| Key | Content | Size |
|-----|---------|------|
| `games/{game_id}.json.gz` | Full parsed game data (gzipped JSON) | 0.8-4 MB |
| `saves/{game_id}.zip` | Raw save file ZIP | 0.25-10 MB |

### R2 Blob Schema: `FullGameData`

```typescript
interface FullGameData {
  // Metadata
  version: number;                        // Blob schema version, starting at 2
  parser_version: string;
  created_at: string;                     // ISO 8601

  // Match metadata
  match_metadata: MatchMetadata;

  // --- Currently in SharedGameData (reused) ---
  game_details: GameDetails;
  player_history: PlayerHistory[];
  yield_history: YieldHistory[];
  event_logs: EventLog[];
  law_adoption_history: LawAdoptionHistory[];
  current_laws: PlayerLaw[];
  tech_discovery_history: TechDiscoveryHistory[];
  completed_techs: PlayerTech[];
  units_produced: PlayerUnitProduced[];
  city_statistics: CityStatistics;
  improvement_data: ImprovementData;
  map_tiles: MapTile[];
  game_religions: GameReligion[];
  player_wonders: PlayerWonder[];

  // --- New: not in current SharedGameData ---
  tile_ownership_history: TileOwnershipEntry[];   // Map replay
  characters: CharacterInfo[];
  character_traits: CharacterTraitInfo[];
  character_relationships: CharacterRelationshipInfo[];
  character_marriages: CharacterMarriageInfo[];
  families: FamilyInfo[];
  family_opinion_history: FamilyOpinionEntry[];
  religion_opinion_history: ReligionOpinionEntry[];
  diplomacy: DiplomacyRelation[];
  units: UnitInfo[];
  unit_promotions: UnitPromotionInfo[];
  player_resources: PlayerResourceInfo[];
  player_goals: PlayerGoalInfo[];
  story_events: StoryEvent[];
  memory_data: MemoryInfo[];
  yield_price_history: YieldPriceEntry[];
  tile_visibility: TileVisibilityInfo[];
}

interface MatchMetadata {
  xml_game_id: string;
  total_turns: number;
  game_name: string | null;
  save_date: string | null;
  game_version: string | null;
  map_width: number | null;
  map_height: number | null;
  map_size: string | null;
  map_class: string | null;
  game_mode: string | null;
  difficulty: string | null;
  opponent_level: string | null;
  victory_conditions: string | null;
  enabled_mods: string | null;
  enabled_dlc: string | null;
  winner: WinnerInfo | null;
}

interface WinnerInfo {
  winningTeamId: number | null;
  victoryType: string;
}
```

### Blob Size Estimates

| Component | Est. Uncompressed | Notes |
|-----------|-------------------|-------|
| Current SharedGameData fields | 2-8 MB | Already measured in production |
| tile_ownership_history | 1-5 MB | Sparse: only ownership changes |
| characters + traits + relationships | 0.5-3 MB | ~1,000 chars per game |
| units + promotions | 0.2-1 MB | 100-500 units |
| diplomacy, goals, story_events | 0.1-0.5 MB | Varies by game length |
| **Total uncompressed** | **4-18 MB** | |
| **Gzipped (~5:1)** | **0.8-4 MB** | |

### Cross-Game Query Examples

```sql
-- Win rate by nation (player_summaries)
SELECT ps.nation,
       COUNT(*) AS games,
       SUM(CASE WHEN ps.is_winner THEN 1 ELSE 0 END) AS wins
FROM player_summaries ps
JOIN games g ON ps.game_id = g.game_id
WHERE g.user_id = ? AND ps.is_uploader = TRUE
GROUP BY ps.nation;

-- Average science per turn at turn 50, winners vs. losers (game_player_turn)
SELECT ps.is_winner,
       AVG(gpt.science_per_turn) AS avg_science
FROM game_player_turn gpt
JOIN player_summaries ps
  ON gpt.game_id = ps.game_id AND gpt.player_index = ps.player_index
WHERE gpt.turn = 50
GROUP BY ps.is_winner;

-- Tech timing heatmap: average research turn per tech (tech_events)
SELECT tech,
       AVG(turn) AS avg_turn,
       COUNT(*) AS times_researched
FROM tech_events
GROUP BY tech;

-- Time-to-4th-law distribution (player_summaries milestone)
SELECT fourth_law_turn
FROM player_summaries
WHERE fourth_law_turn IS NOT NULL;

-- Ruler archetype win rate (player_summaries)
SELECT starting_ruler_archetype,
       COUNT(*) AS games,
       SUM(CASE WHEN is_winner THEN 1 ELSE 0 END) AS wins
FROM player_summaries
WHERE starting_ruler_archetype IS NOT NULL
GROUP BY starting_ruler_archetype;

-- Recent games for a user
SELECT game_id, game_name, user_nation, total_turns, victory_type,
       user_won, created_at
FROM games
WHERE user_id = ?
ORDER BY created_at DESC
LIMIT 10;
```

### Storage Estimates

For a 200-turn, 8-player game:

| Table | Rows/game | At 10K games | Approx. storage |
|---|---|---|---|
| `game_player_turn` | 1,600 | 16M | ~3.2 GB |
| `tech_events` | ~400 | 4M | ~250 MB |
| `law_events` | ~160 | 1.6M | ~100 MB |
| `player_summaries` | 8 | 80K | ~20 MB |
| `games` | 1 | 10K | ~3 MB |

Total at 10K games: ~3.6 GB → comfortable in D1's 10 GB limit. At 30K games we approach the limit; mitigations available include bucketing `game_player_turn` by 5-turn windows (5× row reduction, minimal information loss for trend charts).

### Deferred to Later Migrations

Data we'd want for additional dashboards but isn't in v1:

- **Family opinion over time** — heaviest time-series (~9,600 rows/game). Add when a family-opinion-cross-match dashboard ships.
- **Event category timeline per turn** — events bucketed by category and turn. Single-game version computes from the R2 blob.
- **Starting ruler survival per turn** — needs character per-turn data.
- **City founding events** — beyond `fifth_city_turn`/`tenth_city_turn` milestones.

Adding these later is a non-breaking migration: new tables only, no changes to v1 tables.

---

## 4. API Design

Base URL: `https://api.per-ankh.app/v1`

All authenticated endpoints require session cookie:
```
Cookie: session=<token>
```

### Endpoints

#### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/discord/callback` | No | Exchange Discord OAuth code for session |
| `POST` | `/auth/logout` | Yes | Clear session |
| `GET` | `/auth/me` | Yes | Return current user info |

**`POST /auth/discord/callback`**

Request: `{ code: string, redirect_uri: string }`
Response: `200 { user_id, display_name, avatar_url }` + `Set-Cookie: session=...`

**`GET /auth/me`**

Response: `200 { user_id, display_name, avatar_url, discord_id }` or `401`

#### Games

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/games` | Yes | Upload a parsed game |
| `GET` | `/games` | Yes | List user's games |
| `GET` | `/games/:id` | Conditional | Fetch full game blob |
| `PATCH` | `/games/:id` | Yes | Update visibility |
| `DELETE` | `/games/:id` | Yes | Delete game + all storage |
| `GET` | `/games/:id/download` | Yes | Download raw save ZIP |

**`POST /games`** — Upload

Request (multipart/form-data):
- Part `data`: gzipped JSON blob (`FullGameData`, `Content-Type: application/gzip`)
- Part `save`: raw ZIP file (`Content-Type: application/zip`)

Validation:
1. Authenticated
2. Rate limited (per-user: 20/hour)
3. Decompress and validate blob (schema, array bounds, required fields)
4. `match_metadata.winner` must exist (completed game only)
5. Duplicate check: `UNIQUE (user_id, file_hash)` on raw ZIP bytes. Re-uploading the same physical file → 409 with existing `game_id`. Two different saves of the "same" game (e.g. replayed from earlier autosave) are both stored.
6. Size limits: 10 MB compressed blob, 50 MB raw ZIP

Processing:
1. Write `games/{game_id}.json.gz` to R2
2. Write `saves/{game_id}.zip` to R2
3. Insert into D1 `games` (metadata extracted from blob)
4. Insert into D1 `player_summaries` (one row per player, extracted from blob)
5. Insert into D1 `game_player_turn` (one row per player per turn, ~1,600 rows/game)
6. Insert into D1 `tech_events` and `law_events` (sparse rows, ~400 + ~160/game)
7. Log upload event

Response: `201 { game_id, url }` | `400` | `409 { existing_game_id }` | `413` | `429`

**`GET /games`** — List

Query params: `sort` (date_desc|date_asc|name|turns), `nation`, `won` (true|false), `limit` (default 50, max 200), `offset`

Response:
```json
{
  "games": [{
    "game_id": "abc123",
    "game_name": "My Game",
    "save_date": "2025-01-15T12:00:00Z",
    "total_turns": 200,
    "user_nation": "NATION_ROME",
    "user_won": true,
    "winner_nation": "NATION_ROME",
    "victory_type": "VICTORY_POINTS",
    "map_size": "MAPSIZE_LARGE",
    "is_public": false,
    "created_at": "2025-06-01T12:00:00Z"
  }],
  "total": 47
}
```

**`GET /games/:id`** — Fetch game blob

Access: Owner always, or anyone if `is_public = TRUE`.

Response: Full `FullGameData` JSON (decompressed from R2 in Worker).

Cache: `private, max-age=300` (owner), `public, max-age=3600` (public game).

**`PATCH /games/:id`** — Toggle visibility

Request: `{ "is_public": true }`
Response: `200 { game_id, is_public }`

**`DELETE /games/:id`** — Delete game

Removes: D1 `games` row (cascades to `player_summaries`, `game_player_turn`, `tech_events`, `law_events`), R2 blob, R2 ZIP.

Response: `204`

**`GET /games/:id/download`** — Download raw save

Response: Streamed ZIP from R2 with `Content-Type: application/zip`.

#### Stats

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/stats` | Yes | Cross-game aggregate statistics |

Response:
```json
{
  "total_games": 47,
  "total_wins": 32,
  "win_rate": 0.68,
  "avg_game_length": 185,
  "nations": [
    { "nation": "NATION_ROME", "games": 12, "wins": 9 }
  ],
  "victory_types": [
    { "type": "VICTORY_POINTS", "count": 20 }
  ],
  "recent_games": [{ "game_id": "...", "game_name": "...", "user_won": true }]
}
```

#### Rate Limiting

Carried forward from existing share Worker patterns:

| Scope | Limit | Key |
|-------|-------|-----|
| Per-user uploads | 20/hour | `user_id` |
| Per-IP uploads | 30/hour | `CF-Connecting-IP` |
| Global uploads | 500/hour | — |
| Downloads | 200/hour per IP | `CF-Connecting-IP` |

Rate limit checks query `events` table (same pattern as `cloud/src/index.ts`).

---

## 5. Authentication

### Discord OAuth 2.0 Flow

Standard authorization-code OAuth 2.0. Discord is the right primary for Per-Ankh: the Old World community already organizes there, and a single token exchange returns username + avatar (no second profile fetch needed, unlike Steam's OpenID + Web API two-step).

```
1. User clicks "Sign in with Discord"

2. Frontend redirects to Discord:
   https://discord.com/api/oauth2/authorize?
     client_id=<DISCORD_CLIENT_ID>
     &redirect_uri=https://per-ankh.app/auth/callback
     &response_type=code
     &scope=identify

3. User authorizes on discord.com

4. Discord redirects to:
   https://per-ankh.app/auth/callback?code=<AUTH_CODE>

5. SvelteKit callback page sends code to API:
   POST /v1/auth/discord/callback
     { code: <AUTH_CODE>, redirect_uri: "https://per-ankh.app/auth/callback" }

6. Worker exchanges code for access token:
   POST https://discord.com/api/oauth2/token
     grant_type=authorization_code
     &code=<AUTH_CODE>
     &redirect_uri=...
     &client_id=<DISCORD_CLIENT_ID>
     &client_secret=<DISCORD_CLIENT_SECRET>

7. Discord responds: { access_token, token_type, expires_in, ... }

8. Worker fetches user profile:
   GET https://discord.com/api/users/@me
     Authorization: Bearer <access_token>

9. Discord responds:
   {
     id: "1234567890",                    // snowflake → discord_id
     username: "playername",
     global_name: "Player Name",          // preferred display name
     avatar: "a1b2c3...",                 // hash, may be null
     ...
   }

10. Worker computes avatar URL:
    https://cdn.discordapp.com/avatars/<id>/<avatar>.png  (or default)

11. Creates/updates user in D1 (display_name = global_name ?? username)
12. Creates session in KV (30-day TTL)
13. Returns Set-Cookie
```

The access token is discarded after step 11 — Per-Ankh only needs identity, not ongoing Discord API access. Session lifetime is independent of Discord's token expiry.

### Session Management

```typescript
// KV key format: session:{token}
interface SessionData {
  user_id: string;
}

// Cookie settings
// session=<nanoid(32)>; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000; Path=/
```

The session payload is intentionally minimal. Display name, avatar, and Discord ID are looked up from D1 when needed (e.g., for `/auth/me` or rendering the user menu). KV would let us cache more, but doing so means changes to user data lag behind active sessions until they expire — and our scale doesn't make the extra D1 read painful.

### Environment Secrets

```
DISCORD_CLIENT_ID      — Discord application client ID (public, but kept in env for parity)
DISCORD_CLIENT_SECRET  — Discord application client secret (used in token exchange)
```

### Future Auth Providers

To add Steam, GOG, Epic, or Google OAuth later:
1. Add `steam_id TEXT UNIQUE`, `google_id TEXT UNIQUE`, etc. to `users` table
2. Add corresponding callback endpoints (Steam uses OpenID 2.0; the others use OAuth 2.0)
3. Account linking: same user can connect multiple providers

A future Discord-guild gating layer (e.g. requiring membership in the Old World Discord to register for tournaments) would call `GET /users/@me/guilds` at login time, which requires adding the `guilds` scope to step 2 of the flow above.

---

## 6. Frontend Migration

### Reused As-Is

These components and files transfer directly to the web app:

| Path | Description |
|------|-------------|
| `src/lib/game-detail/*.svelte` | All 12 tab components + `GameDetailView.svelte` |
| `src/lib/game-detail/helpers.ts` | Types, constants, `YIELD_CHART_CONFIG`, `CITY_COLUMNS`, pure functions |
| `src/lib/game-detail/index.ts` | Re-exports |
| `src/lib/Chart.svelte` | ECharts wrapper |
| `src/lib/ChartContainer.svelte` | Chart layout container |
| `src/lib/HexMap.svelte` | Map visualization |
| `src/lib/SearchInput.svelte` | Reusable search input |
| `src/lib/config/` | Chart colors, nation colors, terrain colors, theme |
| `src/lib/utils/formatting.ts` | `formatEnum()`, `formatDate()`, `stripMarkup()`, etc. |
| `src/lib/types/` | All TypeScript type definitions (now hand-maintained) |
| `static/sprites/` | All sprite assets |

### Rewritten

| Current | New | Change |
|---------|-----|--------|
| `src/lib/api.ts` (Tauri `invoke()`) | `src/lib/api.ts` (`fetch` to API) | All functions rewritten to use HTTP |
| `src/routes/game/[id]/+page.svelte` | `src/routes/games/[id]/+page.svelte` | Fetch from API instead of Tauri |
| `src/lib/ShareControl.svelte` | `src/lib/VisibilityToggle.svelte` | Public/private toggle |
| `GameSidebar.svelte` | `GameSidebar.svelte` | Fetch game list from API |

### New Components

| Component | Purpose |
|-----------|---------|
| `LoginButton.svelte` | Discord login, redirects to Discord OAuth authorize URL |
| `UserMenu.svelte` | Logged-in user avatar + dropdown |
| `UploadModal.svelte` | File selection, Web Worker progress, upload to API |
| `Dashboard.svelte` | Cross-game stats (win rate, nations chart) |
| `GameLibrary.svelte` | Sortable/filterable grid of games |
| `src/routes/auth/callback/+page.svelte` | Processes Discord redirect (extracts `code`, posts to API) |

### API Layer

```typescript
// src/lib/api.ts
const API_BASE = import.meta.env.VITE_API_URL;

async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
  });
  if (res.status === 401) {
    goto("/login");
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(await res.text());
  return res;
}

export const api = {
  // Auth
  getMe: () => authFetch("/auth/me").then(r => r.json()),
  discordCallback: (code: string, redirectUri: string) =>
    fetch(`${API_BASE}/auth/discord/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
      credentials: "include",
    }),
  logout: () => authFetch("/auth/logout", { method: "POST" }),

  // Games
  listGames: (params?: Record<string, string>) =>
    authFetch(`/games?${new URLSearchParams(params)}`).then(r => r.json()),
  getGame: (gameId: string) =>
    authFetch(`/games/${gameId}`).then(r => r.json()),
  uploadGame: (formData: FormData) =>
    authFetch("/games", { method: "POST", body: formData }),
  deleteGame: (gameId: string) =>
    authFetch(`/games/${gameId}`, { method: "DELETE" }),
  toggleVisibility: (gameId: string, isPublic: boolean) =>
    authFetch(`/games/${gameId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_public: isPublic }),
    }),
  downloadSave: (gameId: string) =>
    authFetch(`/games/${gameId}/download`),

  // Stats
  getStats: () => authFetch("/stats").then(r => r.json()),

  // Public (no auth)
  getPublicGame: (gameId: string) =>
    fetch(`${API_BASE}/games/${gameId}`).then(r => r.json()),
} as const;
```

### Route Structure

```
src/routes/
  +layout.svelte                — Header with auth state, navigation
  +page.svelte                  — Dashboard (logged in) or landing page
  login/+page.svelte            — "Sign in with Discord" button
  auth/callback/+page.svelte    — Processes Discord redirect
  games/+page.svelte            — Game library
  games/[id]/+page.svelte       — Game detail view
  upload/+page.svelte           — Upload with Web Worker progress
```

### Game Detail Page

Structurally identical to the existing web share viewer (`web/src/routes/share/[id]/+page.svelte`), which already fetches a JSON blob and passes it to `GameDetailView`:

```svelte
<script lang="ts">
  import { api } from "$lib/api";
  import GameDetailView from "$lib/game-detail/GameDetailView.svelte";
  import { page } from "$app/stores";

  let data = $state<FullGameData | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    api.getGame($page.params.id)
      .then(d => { data = d; })
      .catch(e => { error = e.message; });
  });
</script>

{#if data}
  <GameDetailView
    gameDetails={data.game_details}
    playerHistory={data.player_history}
    allYields={data.yield_history}
    eventLogs={data.event_logs}
    lawAdoptionHistory={data.law_adoption_history}
    currentLaws={data.current_laws}
    techDiscoveryHistory={data.tech_discovery_history}
    completedTechs={data.completed_techs}
    unitsProduced={data.units_produced}
    cityStatistics={data.city_statistics}
    improvementData={data.improvement_data}
    gameReligions={data.game_religions}
    playerWonders={data.player_wonders}
    mapTiles={data.map_tiles}
  />
{/if}
```

---

## 7. Sharing Model

### Current System (Desktop)

1. Desktop assembles 16-field JSON blob from 12 DuckDB queries
2. Gzips and POSTs to share Worker (anonymous, app-key auth)
3. Separate share/delete lifecycle
4. Share URL: `per-ankh.app/share/{nanoid}`

### Cloud System

Games are cloud-native. Sharing = visibility toggle:

1. All games start as `is_public = FALSE`
2. User clicks "Make Public" → `PATCH /v1/games/:id { is_public: true }`
3. Public URL: `per-ankh.app/games/{game_id}` (same URL, now accessible without auth)
4. User can toggle back to private at any time

No separate share upload, no delete tokens, no app keys. The game is already in the cloud — sharing is just changing who can see it.

### Legacy Share URLs

The existing share Worker (`api.per-ankh.app/v1/share/...`) continues running to serve existing shared games at `per-ankh.app/share/{id}`. No migration needed — old shares and new games coexist.

### Public Game Discovery (Future)

Falls out naturally from the architecture:

```sql
SELECT game_id, game_name, user_nation, total_turns, victory_type
FROM games WHERE is_public = TRUE
ORDER BY created_at DESC LIMIT 50;
```

Not in initial scope but trivial to add.

---

## 8. Save File Management

### Upload Flow

```
User selects .zip file
  │
  ▼
Browser: validate file extension, basic size check
  │
  ▼
Web Worker: extractXmlFromZip() → parseXml() → extractAllGameData()
  │  (progress events via postMessage to UI)
  ▼
Web Worker: validateCompletedGame() — must have winner
  │
  ▼
Browser: receives GameData + raw ZIP bytes
  │
  ▼
Browser: gzip GameData JSON, hash raw ZIP, build FormData (blob + zip + file_hash)
  │
  ▼
POST /v1/games (multipart: gzipped blob + raw ZIP)
  │
  ▼
Worker: validate session → rate limit → decompress → schema check
  │
  ▼
Worker: duplicate check on (user_id, file_hash)
  │
  ▼
Worker: R2 put (blob + zip)
  │
  ▼
Worker: D1 insert (games + player_summaries + game_player_turn + tech_events + law_events)
  │
  ▼
Response: { game_id } → navigate to /games/{game_id}
```

### Duplicate Detection

The `games` table has `UNIQUE (user_id, file_hash)` on the raw ZIP bytes' SHA-256.

- Re-uploading the same physical save file → `409 Conflict` with the existing `game_id`. The user gets a clear "you already have this" message.
- Two different files (different ZIP bytes) are always treated as different games, even if they share `xml_game_id` and `total_turns`. This handles the legitimate case where a user replayed from an earlier autosave and ended a game differently — both records stored.

Earlier drafts keyed dedup on `(user_id, xml_game_id, total_turns)`, but that rejects valid distinct end-states. File-hash keying is more permissive and never errors on something the user can't fix.

### Batch Upload

Initial version: single file at a time. Future enhancement:
1. User selects multiple files via `<input multiple>`
2. Files parsed sequentially in Web Worker
3. Each uploaded individually with per-file progress/status
4. UI shows results: imported, skipped (duplicate), failed (incomplete)

### Reprocessing

Raw ZIPs are kept in R2 at `saves/{game_id}.zip`. When the parser changes materially (see §10 parser version rules), v1 uses **lazy client-side reprocess**:

1. When a user views a game whose `parser_version` is below the current version, the frontend shows a "Re-import available" banner.
2. User clicks "Re-import" → frontend downloads the ZIP from R2, re-parses in the Web Worker, uploads the new blob via the standard upload endpoint (which detects the duplicate file hash and updates the existing game in place rather than creating a new one).
3. No server-side parsing. The Worker stays cheap.

This aligns with the browser-first principle and avoids needing a Durable Object or batch job for v1. If we later need to reprocess en masse (e.g., after a MAJOR parser version bump), an admin batch path can be added — it's not in v1 scope.

The upload endpoint needs a small extension to handle re-imports: when a `(user_id, file_hash)` collision is detected and the incoming `parser_version` is newer than the existing row's, overwrite the blob and D1 rows in place rather than returning 409.

---

## 9. Cloudflare Resource Limits

### Workers Paid Plan Required ($5/month)

The free tier's 10ms CPU limit is too tight for gzip decompression of 1-5 MB blobs. The paid plan provides 30s CPU time.

### D1

| Limit | Value | Per-Ankh Impact |
|-------|-------|----------------|
| Database size | 10 GB | At ~360 KB/game (mostly `game_player_turn`), supports ~28K games before mitigation needed. See §3 storage estimates. |
| Rows read/query | 10M | Cross-game aggregates well below this (e.g., 200 games × 1,600 rows = 320K). |
| Rows written/query | 100K | ~2,200 rows per upload (1 game + 8 summaries + 1,600 turn rows + ~400 tech + ~160 law). Well within. |
| Workers Paid writes/month | 50M | At 800 uploads/month × 2,200 rows = 1.76M writes. ~3.5% of quota. |
| Workers Paid reads/month | 25B | Effectively unbounded for our scale. |

### R2

| Limit | Value | Per-Ankh Impact |
|-------|-------|----------------|
| Object size | 5 GB | Game blobs 1-5 MB, ZIPs 0.25-10 MB. |
| Free tier storage | 10 GB | ~2,000-5,000 games (blob + zip). |
| Paid storage | $0.015/GB/month | 10,000 games * 8 MB avg = 80 GB = $1.20/month. |
| Class B ops (reads) | Free: 10M/month | Each game view = 1 read. |
| No egress fees | — | Key advantage over S3. |

### KV

| Limit | Value | Per-Ankh Impact |
|-------|-------|----------------|
| Free reads | 100K/day | Session lookup on every auth'd API call. |
| Free writes | 1K/day | 1 write per login. |
| TTL | Configurable | 30-day sessions. |

### Request Size

Workers accept up to 100 MB request bodies. A typical upload (5 MB blob + 5 MB ZIP) = 10 MB multipart request. Well within limits.

---

## 10. Schema Versioning & Migrations

### R2 Blob Versioning

The `version` field in `FullGameData` controls blob schema evolution:

```typescript
interface FullGameData {
  version: 2;  // Initial cloud version (v1 = legacy share system)
  // ...
}
```

**Adding fields (non-breaking):**
1. Add field to `FullGameData` interface
2. Update parser to populate it
3. Update Worker validation to accept new version
4. Frontend handles missing fields: `data.newField ?? []`
5. Old blobs continue to work

**Renaming or removing fields (breaking):**
- Avoid. Use additive changes only.
- If unavoidable, reprocess all blobs from raw ZIPs.

### Parser Version Tracking

Each blob records `parser_version` (semver string). When the parser changes:

1. Bump parser version in frontend per the rules below
2. Worker records `parser_version` in D1 `games` table
3. Games with old parser versions show "Re-import available" badge
4. User can trigger re-import (downloads ZIP from R2, re-parses, uploads — see §8)

#### Bump rules

- **PATCH** — bug fix that changes the *value* of a field for some games. Example: correcting a misread sentinel that was producing 0 instead of `null`. Old blobs render but show wrong data. UI shows the "Re-import available" badge on games whose `parser_version` is below the current PATCH; user can opt in to re-import.
- **MINOR** — additive: new field added to `FullGameData`. Old blobs lack it; frontend handles missing fields with `?? null` / `?? []`. No re-import needed for old blobs to keep working. Optional badge if the new field unlocks a visible feature on the detail page.
- **MAJOR** — breaking schema change (rename, removal, type change). Old blobs won't render correctly. Avoid. If unavoidable, requires an admin batch reprocess from raw ZIPs and a coordinated Worker + frontend deploy.

Decision rule for whether to bump: *would a reasonable user expect the data shown to change after a re-import?* If yes, bump PATCH or higher. Refactors and pure-perf changes do not bump version.

The current parser version ships as a build-time constant in the frontend; the badge logic compares the D1 row's stored version against that constant.

### D1 Migrations

Standard numbered SQL migrations applied via `wrangler d1 migrations apply`:

```
cloud/migrations/
  0001_initial.sql
  0002_add_game_mode.sql
```

### Deploy Ordering

For changes touching both Worker and frontend:

1. Deploy Worker with validation accepting both old and new blob versions
2. Deploy frontend with new parser/blob version
3. (Optional) Reprocess old blobs

Worker must accept new versions **before** the frontend starts sending them. Same principle as documented in `CLAUDE.md` for the current share system.

---

## 11. Map Assets

The map sprite atlases are baked offline from pinacotheca's renders (see `CLAUDE.md` "Map Atlas Pipeline"). Today the Tauri build bundles them into `static/atlases/`; in the cloud rewrite they move to R2.

### Hosting

- **Bucket:** R2 `per-ankh-assets` (separate from the existing `per-ankh-shares` bucket)
- **Domain:** `assets.per-ankh.app` (custom domain on the R2 bucket, public read, no Worker in the path)
- **Caching:** Cloudflare CDN edge cache in front of R2 ⇒ first request per region warms cache, subsequent reads hit the edge
- **Cache headers:** `Cache-Control: public, max-age=31536000, immutable` on every asset
- **Cost:** ~50 MB total → free R2 tier; bandwidth free within Cloudflare's network

### Versioning

URLs include a path prefix that changes on every atlas re-bake:

```
https://assets.per-ankh.app/v<N>/atlases/{name}.{webp,json}
https://assets.per-ankh.app/v<N>/atlases/nation-asset-aliases.json
```

`N` is incremented in the bake script's output and committed alongside the atlases. The frontend reads the active prefix from a build-time constant (or a small JSON manifest fetched once at app start). Old prefixes stay live so in-flight clients on a stale build don't break.

### Atlas inventory

Same set the Tauri build produces (12 WebP/JSON pairs + 1 alias JSON):

| Atlas | Cells | Approx size (lossless WebP) | Loaded |
|---|---|---|---|
| `terrain.{webp,json}` | 9 | ~150 KB | always |
| `height.{webp,json}` | 3 | ~85 KB | always |
| `improvements-base.{webp,json}` | 58 | ~1.7 MB | always |
| `resources.{webp,json}` | 20 | ~350 KB | always |
| `improvements-urban-<FAMILY>.{webp,json}` × 10 | ~70-75 each | ~3.2-3.8 MB each | lazy by family |
| `nation-asset-aliases.json` | — | ~2 KB | always |

Always-loaded set: ~2.3 MB. Per-match family fetches: ~3-4 MB per nation present on the map. Worst case (10-nation match): ~37 MB total.

### Lazy loading

The runtime fetches `nation-asset-aliases.json` + the always-loaded atlases on app start. Once tiles arrive, `SpriteMap.svelte` derives the set of urban families present on the map (`unique(tiles.map(t => aliases[t.owner_nation].urban))`) and fires parallel fetches for each family atlas. Tiles whose family hasn't loaded yet fall through to the empty-urban + base layers; once the family atlas resolves, deck.gl picks up the new IconLayer and the composite renders on the next frame.

### Bake pipeline

Same scripts as Tauri (`scripts/bake-{atlases,improvements,resources}.ts`). Cloud build adds one extra step: after the bake writes `static/atlases/`, an upload step pushes those files to R2 under the new version prefix and updates the active-prefix manifest.

```bash
# Tauri (today): bake + bundle
npm run bake:all

# Cloud (future): bake + upload
npm run bake:all
npm run atlases:upload   # wrangler r2 object put per-ankh-assets/v<N>/atlases/...
```

Atlas content is identical between Tauri and cloud — the only difference is where the runtime fetches from.

### Migration ordering (cloud cutover)

1. Bake locally and upload to R2 under prefix `v1/`
2. Deploy frontend that reads from `assets.per-ankh.app/v1/...`
3. Tauri continues serving from `static/atlases/` (no change)
4. On future re-bake: bump to `v2/`, upload, redeploy frontend

Old prefixes can be deleted from R2 once no client traffic is hitting them (CDN cache + browser cache lifetime determines the safe-delete window — give it a few weeks).

---

## Appendix A: File Organization

The cloud rewrite is built **in-place** in the existing `per-ankh` repo, not in a separate `per-ankh-cloud/` repository. The Tauri desktop app remains in the tree during the transition window. When desktop is deprecated and removed, that's a separate mechanical diff.

Rationale: shared code (`src/lib/game-detail/`, `src/lib/config/`, `src/lib/utils/`, `src/lib/types/`, sprite/atlas pipeline, scripts) is already in this repo. A separate cloud repo would require either symlinks (as `web/` does today) or copy-and-diverge. In-place avoids both. The cost is that desktop and cloud code coexist for a few months; mitigation is keeping cloud-only paths obvious (`src/routes/games/`, `src/routes/upload/`, `cloud/`).

### What the cloud rewrite adds to the existing repo

```
per-ankh/
├── src/
│   ├── lib/
│   │   ├── parser/                    # NEW: TypeScript parser
│   │   │   ├── worker.ts
│   │   │   ├── types.ts
│   │   │   ├── extract-zip.ts
│   │   │   ├── parse-xml.ts
│   │   │   ├── sentinels.ts
│   │   │   ├── validation.ts
│   │   │   └── parsers/
│   │   │       ├── players.ts
│   │   │       ├── characters.ts
│   │   │       ├── cities.ts
│   │   │       ├── tiles.ts
│   │   │       ├── families.ts
│   │   │       ├── religions.ts
│   │   │       ├── tribes.ts
│   │   │       ├── units.ts
│   │   │       ├── diplomacy.ts
│   │   │       ├── player-data.ts
│   │   │       ├── character-data.ts
│   │   │       ├── timeseries.ts
│   │   │       ├── events.ts
│   │   │       ├── match-metadata.ts
│   │   │       └── index.ts
│   │   ├── api.ts                     # MIGRATED: dual desktop/cloud during
│   │   │                              #   transition; eventually fetch-only
│   │   ├── UploadModal.svelte         # NEW (cloud-only)
│   │   ├── LoginButton.svelte         # NEW (cloud-only)
│   │   ├── UserMenu.svelte            # NEW (cloud-only)
│   │   ├── Dashboard.svelte           # NEW (cloud-only)
│   │   ├── GameLibrary.svelte         # NEW (cloud-only)
│   │   └── VisibilityToggle.svelte    # NEW (cloud-only; replaces ShareControl)
│   └── routes/
│       ├── login/+page.svelte         # NEW
│       ├── auth/callback/+page.svelte # NEW
│       ├── games/+page.svelte         # NEW (cloud library)
│       ├── games/[id]/+page.svelte    # NEW (cloud detail)
│       └── upload/+page.svelte        # NEW
├── cloud/                             # EXISTS (current share Worker)
│   ├── src/
│   │   ├── index.ts                   # EXTENDED: add /v1/games, /v1/auth, etc.
│   │   ├── auth.ts                    # NEW: Discord OAuth
│   │   ├── validation.ts              # EXTENDED: new blob schema
│   │   └── queries.ts                 # NEW: D1 helpers
│   └── migrations/                    # NEW
│       └── 0001_initial.sql
└── ...
```

### Reused as-is by the cloud rewrite

| Path | Notes |
|------|-------|
| `src/lib/game-detail/` | Direct imports — no symlinks needed (vs. how `web/` works today) |
| `src/lib/config/` | Chart colors, nation/tribe colors, theme |
| `src/lib/utils/` | `formatEnum()`, `formatDate()`, `stripMarkup()`, etc. |
| `src/lib/types/` | TypeScript types (hand-maintained once Rust source goes away) |
| `src/lib/Chart.svelte`, `ChartContainer.svelte`, `HexMap.svelte`, `SearchInput.svelte` | Shared UI |
| `static/sprites/`, `static/atlases/` | Same assets; atlases additionally hosted on R2 per §11 |
| `scripts/bake-*.ts` | Atlas bake pipeline, augmented with R2 upload step (§11) |

### Stays for desktop only (until Tauri deprecation)

`src-tauri/`, `src/routes/game/[id]/` (desktop's pre-existing route), `src/lib/ShareControl.svelte`, `src/lib/GameSidebar.svelte` (Tauri-specific version), and the Tauri `invoke()` paths in `api.ts`. These are deleted in the desktop-removal commit, separate from the cloud-rewrite work.

## Appendix B: Key Source Files for Parser Port

These Rust files define the extraction logic to be ported to TypeScript, listed by size/complexity:

| Rust File | LOC | TS Target | Notes |
|-----------|-----|-----------|-------|
| `src-tauri/src/parser/parsers/player_data.rs` | 706 | `parsers/player-data.ts` | Resources, tech, council, laws, goals |
| `src-tauri/src/parser/parsers/city_data.rs` | 667 | `parsers/cities.ts` | City nested data (9 sub-entities) |
| `src-tauri/src/parser/parsers/timeseries.rs` | ~400 | `parsers/timeseries.ts` | 8 time-series types |
| `src-tauri/src/parser/parsers/events.rs` | ~350 | `parsers/events.ts` | Stories, logs, memories |
| `src-tauri/src/parser/parsers/characters.rs` | ~300 | `parsers/characters.ts` | Character core data |
| `src-tauri/src/parser/parsers/character_data.rs` | ~250 | `parsers/character-data.ts` | Stats, traits, relationships |
| `src-tauri/src/parser/parsers/players.rs` | 256 | `parsers/players.ts` | Player core data |
| `src-tauri/src/parser/parsers/tiles.rs` | ~250 | `parsers/tiles.ts` | Tiles + ownership history |
| `src-tauri/src/parser/parsers/units.rs` | ~200 | `parsers/units.ts` | Units + promotions/effects |
| `src-tauri/src/parser/parsers/diplomacy.rs` | ~150 | `parsers/diplomacy.ts` | Relations |
| `src-tauri/src/parser/game_data.rs` | 668 | `parser/types.ts` | All entity type definitions |

The `GameData` struct in `game_data.rs` has 59 fields across entity types — each becomes a TypeScript interface.
