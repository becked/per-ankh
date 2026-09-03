# Challenge maps — design

A **challenge** is a turn-1 save that one user posts with a set of objectives; anyone signed in downloads it, plays it, and uploads the save from the turn they met every objective. The app scores the upload itself, from the parsed save, and ranks everyone on a per-challenge leaderboard. Challenges are numbered; the community ran #1–#26 by hand on Discord before Per-Ankh, so the first one here is **#27**.

Status: **design, not built.** Written 2026-09-02. Nothing in `src/` or `cloud/` exists yet; §12 is the build order.

## 1. The rules, as posted

This is the community's rule text, which the design has to reproduce faithfully because the players already know it:

> Share the turn you meet all the objectives. You do not need to win the game. The order you reach the objectives does not matter.
>
> Score is: the turn you reach all the objectives. Faster is better.
>
> Standard criteria: all families that have family seats should be above −100 opinion. All cities founded by you should be undamaged. For your custom leader, only pick standard traits; no dynasty-unique traits.

Objectives are set by the creator. There can be several, and all of them must be met. The kinds asked for: *reach X by turn Y*, *reach Z as fast as possible*, *research a tech*, *build a wonder or an improvement*, *train a unit*.

## 2. The one decision everything else follows from

**The score is the turn of the save you upload.** Not a turn reconstructed from the save's histories — the save's own `Game.Turn`.

Three reasons, in order of weight:

1. **It is the posted rule.** "Share the turn you meet all the objectives" is what players did on Discord with a screenshot; the save is the screenshot.
2. **Every check runs against one state.** The standard criteria are snapshots — the save records a city's damage and a family's opinion *now*, not per turn — so they can only be evaluated at the save's turn. If the score were an earlier reconstructed turn, a player could complete on turn 40 with a damaged city, wait for it to heal, and upload turn 45 to score 40 with clean criteria. Scoring the save's own turn closes that: the criteria are checked at the turn you are claiming.
3. **A later save is never rejected, only scored later.** A player who forgets and plays on to turn 45 gets 45, and the result card tells them "every objective was met by turn 40 — upload the turn-40 autosave to score 40" whenever the histories can say so (§5.4). Re-uploading an earlier autosave is legitimate: it is the same game, scored on its own state.

So an upload is accepted only if, *at that save*, every objective is met and every criterion holds; the score is `total_turns`; the leaderboard is ascending.

## 3. What a challenge is made of

### 3.1 The map

The creator uploads a **turn-1 save** — the `.zip` Old World writes, exactly as game uploads work today. It is parsed in the browser by the existing parser (§7.1) to extract the **setup**: nation, starting leader and their turn-1 traits, map size / class / aspect, difficulty, opponent level, game options, disabled wonders, game version, DLC, and the save's `GameId`. The ZIP goes to R2; the setup is persisted as JSON on the challenge (the same shape of thing as `map_pool` JSON on a tournament).

A challenge map is **not** a `games` row. A game is a played match; a turn-1 save has nothing to chart, would sit in the creator's library as a one-turn game, and would need excluding from every corpus predicate. It is a file plus a dozen facts, and that is how it is stored.

A challenge is **single-player**: the map has exactly one human seat and either no AI at all (Tribes only — the preferred shape) or one AI. Creation refuses anything else, and the roster — the human's `player_index` and nation, and the AI count — is part of the setup every submission is checked against (§4).

Maps are usually generated *with* a second seat — a mirror map needs two players to be laid out, and a hotseat game with a second human is the quickest way to get one — and the game has no "remove player" button. So the create page does it to the save (`src/lib/challenges/strip-seats.ts`): every seat after the first is removed — its entries in the root per-player lists and `<Humans>`, its `Game` diplomacy/contact keys, its `<Player>` block, its units, its per-team tile reveals — and its reserved start sites become ordinary sites. Nothing is renumbered, so the first seat has to be the creator's. The transform is a browser DOM rewrite, confirmed against a real two-human map that the game then loaded as a solo game, and the stripped file is what gets stored and downloaded — the creator takes the challenge from the same file as everyone else. Removing an AI seat runs the same code and has not been loaded in game yet. Every map, stripped or not, also has the creator's `Email` and `OnlineID` blanked on its `<Player>` before it is parsed or stored (`scrubIdentity`) — the map is a public download, and `online_id` never leaves its lane.

Sharing a save shares the creator's `online_id` (Steam/GOG/Epic) inside it, exactly as any save posted to Discord does. The download is therefore session-gated like `GET /v1/games/:id/download`, and the create form says so in one line.

### 3.2 Objectives

An ordered list, JSON on the challenge. The vocabulary below was sized against the 26 challenges the community has already run (§3.5): every kind earns its place by expressing at least one of them, and each is a reading of data the save already carries.

| kind | fields | met when | deadline (`by_turn`) |
|---|---|---|---|
| `tech` | `target: TECH_*` | the player has completed the tech (`completed_techs`) | yes — `completed_turn` |
| `build` | `target: IMPROVEMENT_*` or `ANY_WONDER`, `state: completed \| started` (default completed), `count` (default 1) | ≥ `count` tiles carrying the improvement, owned by the player (`improvement_data`); `started` also counts tiles where it is under construction (`build_turns_left > 0`). `ANY_WONDER` counts distinct wonders | completed wonders only — the `WONDER_ACTIVITY` log records a wonder's completion; an ordinary improvement has no turn, and neither does a start. The schema and the create form refuse a deadline anywhere else |
| `unit` | `target: UNIT_*`, `count` (default 1) | whole-game production of the type ≥ `count` (`units_produced`; excludes starting units, survives the unit's death) — *train* | no |
| `army` | `count`, `types?: UNIT_*[]`, `min_strength?`, `unique_only?`, `land_only?`, `min_types?`, `min_per_type?`, `trained_only?` | ≥ `count` living units of the player passing every filter (`units` + baked `UNIT_STATS`) — *have* | no — a snapshot |
| `city` | `count` (default 1), `culture?: CULTURE_*`, `capital?`, `min_happiness?`, `improvements?: {IMPROVEMENT_*: n}`, `specialists?: {SPECIALIST_*: n}` | ≥ `count` cities owned by the player where every stated condition holds (`city_statistics`, `improvement_data` grouped by city) | no — a snapshot |
| `capture` | `capital?` (default false), `count` (default 1) | ≥ `count` cities owned by the player that another player founded; `capital` restricts to the AI's first city (its capital, founded on its turn 1) | yes — the city tile's `tile_ownership_history` records the flip |
| `religion` | `target: RELIGION_*` or `ANY`, `state_religion?`, `min_theology_tier?` | the player founded it (`game_religions.founder_nation`); optionally it is the player's `state_religion` and has a theology of tier ≥ n (`theologies` + baked tiers from `theology.xml`) | founding only — `founded_turn` |
| `cognomen` | `target: COGNOMEN_*` | the reigning leader carries it (`characters[].cognomen`) | no — the history is not parsed |
| `metric` | `metric`, `value` | the metric reached ≥ `value` at some turn ≤ the limit | yes — every metric is per-turn history |
| `victory` | — | the player won (`match_metadata.game_over` and the winner is the player) | yes — `total_turns` |

A `build` with `count` and `ANY_WONDER` + `started` is how "start all 13 wonders" is written; the create form prefills `count` with the number of wonders the map has not disabled (`disabled_improvements`), so the number is the map's, not typed.

**Metrics** are the vocabulary the save speaks and the Records tab already ranks:

- Yields, as `{ metric: "YIELD_MONEY", measure: "rate" | "cumulative" }` — from `yield_history`; the fourteen yields of `YIELD_SERIES` (`src/lib/stats/charts/yields.ts`), whose labels and colours the picker reuses.
- `points`, `military_power`, `legitimacy` — from `player_history`.
- `tech_count` — from `tech_discovery_history`; `law_count` — from `law_adoption_history`.
- `cities_founded` — cities with `first_owner_player_xml_id` = the player and `founded_turn` ≤ the limit.

GDP would be a fifth bullet once its basket module is dual-emitted like the tables below; nobody has asked.

**"As fast as possible" is not a kind.** It is any objective without a deadline; the score already measures it. The create form says so where the deadline field is.

A **deadline** (`by_turn`) constrains that objective only: it must have been met at a turn ≤ `by_turn`. It does not cap the run. (A whole-run cap — "everything by turn 80" — is one optional column and one check if it is ever wanted; a turn-300 completion today simply ranks last.)

**Semantics of "met"**, uniformly: a history-backed objective is met if the player *ever* reached it at a turn ≤ min(`by_turn`, save turn); a yield that hit 2000 on turn 38 and fell to 1900 by the save still counts, which is what "reach" means and what a human judge reading a graph would rule. A snapshot objective (`army`, `city`, `unit`, `cognomen`) is met iff the save's state satisfies it, and cannot carry `by_turn` — the create form and the Valibot schema both refuse it.

### 3.3 Criteria

The three standard criteria are fixed in *kind* but the community has varied their *parameters* (opinion floor of 0 instead of −100, "all cities" instead of "founded cities", "found with all three families"), so each is a row with defaults rather than a constant. The create page shows the standard set pre-filled; a creator who leaves it alone gets exactly the posted rule text. All are evaluated at the save's state and each renders as its own line so a failed run says which one.

| criterion | fields (defaults = the standard rule) | holds when |
|---|---|---|
| `families` | `min_opinion: -100`, `scope: seated \| all` (seated), `count?: {min?, max?}` | every family in scope (seated = `seat_city_xml_id` set) has latest `family_opinion_history` opinion ≥ `min_opinion` (−100 is the game's Angry threshold, `generated/family-opinion.ts`, so the page can say "not Angry"); the player's family count is within `count` when given ("found with all 3 families" = `min: 3`; "only one family" = `max: 1`) |
| `cities` | `scope: founded \| all` (founded) | every city in scope currently owned by the player has `damage === 0`. Founded = `first_owner_player_xml_id` is the player; a founded city later lost to conquest is out of the player's hands and not checked — the rule does not say "don't lose cities" |
| `leader` | `standard_traits_only: true`, `required_traits?: TRAIT_*[]` | when the map plays with `GAMEOPTION_CUSTOM_LEADER` (the player builds the leader on turn 1, which is why the rule exists): the traits the submission's starting leader carries at `acquired_turn ≤ 1` that the map's leader did not already have contain no **dynasty-unique** trait and every `required_traits` entry ("you must pick Debauched"). Dynasty-unique = any `trait.xml` entry carrying `<EncyclopediaCharacter>` — the 45 traits tied to a historical ruler, baked to `src/lib/generated/dynasty-traits.ts` by `scripts/bake-dynasty-traits.ts`. Diffing against the map's leader rather than testing the trait alone is what keeps a historical-leader map (Ramesses starts with `TRAIT_CHARIOT_MASTER`) from failing every submission by construction |
| `economy` | `min_rates: {YIELD_*: n}` — off by default | each listed yield's `rate` at the save turn ≥ n ("all positive for money, food, iron, stone, wood" = five entries at 1; "produce your UU's cost each turn" = `YIELD_IRON: 200`) |
| `max_cities` | `n` — off by default | the player owns ≤ n cities ("you can only have one city") |

The starting leader is the map's first leader — the player's character with the earliest `became_leader_turn` — read at creation and stored in the setup. A pick-later map has none (`<Leaders />` is empty until the player builds one on turn 1), so the submission's own first leader is used then; either way the check is on that character, not on whoever reigns at the save.

**Anything the save cannot see** — "you may not deliberately remove your leader from power", "always be at war once you make contact", "no cities past the centre line" — goes in the challenge's description, in the creator's words, as it did on Discord. It is not scored. (An earlier draft carried these as a separate honour-system list; one free-text field is enough.)

### 3.4 Parser work this needs

The scorer reads the blob, so what the blob does not carry has to be added first. Each is additive (`PARSER_VERSION` minor bump, `KNOWN_PARSER_VERSIONS` entry, schema field):

- `improvement_data.improvements[].build_turns_left` — for `build … started`. The tile parser already has an `improvementTurnsLeft` field for this, but reads the tag `ImprovementTurnsLeft`, which no save in the fixtures writes; the game writes `ImprovementBuildTurnsLeft`. It has been `null` on every parse and nothing consumes it, which is why it never showed. Read both names.
- `units[].original_tribe` — from `<OriginalTribe>`; a mercenary hired from a tribe carries it, which is what `army.trained_only` needs ("tribal or barbarian mercs do not count").
- `UNIT_STATS[].nation` — `<NationPrereq>` from `unit.xml`, for `unique_only`. A bake-script change, no parser bump.
- `THEOLOGY_TIERS` — `<iTier>` from `theology.xml`, new generated table, for `religion.min_theology_tier`.
- `player_wonders[].completed_turn` already means completion: `derivePlayerWonders` keeps only the `WONDER_ACTIVITY` entries whose text says "completed" (the log also carries a "has begun construction" entry per wonder, indistinguishable by `Data1–3`). The filter is on English log text, so a non-English save records no wonders and `build … by_turn` on a wonder cannot be met from it — the same limitation the Wonders tab has today. Nothing to add for v1; the language-independent form (completion = latest entry for a wonder that stands finished on the map) is a follow-up.

Because each is optional on the blob type (older blobs lack it) and the scorer would read its absence as "not under construction" / "trained", the Worker refuses a challenge map or run parsed before `CHALLENGE_MIN_PARSER_VERSION` (2.16.0, `400 STALE_PARSER`) rather than persist a verdict scored on missing fields — the case is a tab left open across a deploy.

### 3.5 Stress test: the 26 that already ran

How each community challenge writes in the vocabulary above. "Yes" means the objective and every restriction are machine-checked; "house rule" means the save cannot see it and it stays as text in the description.

| # | as posted | in v1 | notes |
|---|---|---|---|
| 26 | research six named techs | yes | six `tech` objectives |
| 25 | four unique units of strength 6 | yes | `army {count 4, min_strength 6, unique_only}` |
| 24 | a legendary city, seven laws, six 8-STR unique units | yes | `city {culture LEGENDARY}`, `metric law_count 7`, `army {6, 8, unique}` |
| 23 | start all 13 wonders | yes | `build {ANY_WONDER, started, count 13}` — needs `build_turns_left` (§3.4) |
| 22 | found 10 cities | yes | `metric cities_founded 10` |
| 21 | capital at positive happiness *and* gaining happiness; one family, positive opinion; two cities, second promptly; Debauched, age 18, governor of capital on turn 1, never removed | partly | `city {capital, min_happiness 1}`, `families {count max 1, min_opinion 1}`, `metric cities_founded 2`, `leader {required_traits [DEBAUCHED]}`. "Gaining happiness" needs the city's per-turn happiness, which the save does not store; age, governorship, "promptly" and "never removed" are house rules |
| 20 | +2000 money per turn | yes | `metric YIELD_MONEY rate 2000` |
| 19 | build a university | yes | `build IMPROVEMENT_UNIVERSITY` |
| 18 | conquer the AI's capital | yes | `capture {capital}` |
| 17 | earn the Great cognomen; found with all 3 families | yes | `cognomen COGNOMEN_GREAT`, `families {count min 3}` |
| 16.1 | found a religion and three cities; **score = sum of the two turns** | objectives yes, score no | `religion ANY` + `metric cities_founded 3` scores the later of the two; the additive score is a different score model (§3.6) |
| 16 | found Zoroastrianism | yes | `religion RELIGION_ZOROASTRIANISM` |
| 15 | university, state religion with tier-2 theology, 7 laws, twelve 8+-STR land units of ≥3 types with ≥3 each; economy positive ×5; families ≥ 0; always at war after contact | yes but one house rule | `build`, `religion {ANY, state_religion, min_theology_tier 2}`, `metric law_count 7`, `army {12, 8, land_only, min_types 3, min_per_type 3}`, `economy`, `families {min_opinion 0}`; the war clause is a house rule |
| 14 | build a university *and* win; two turns reported | objectives yes, score partly | `build` + `victory`; scored on the later (the win). The Discord version ranked both turns separately |
| 13 | Colosseum; economy ×5; all families ≥ 0; all cities undamaged | yes | `build IMPROVEMENT_COLOSSEUM`, `economy`, `families {all, 0}`, `cities {all}` |
| 12 | largest army by turn 55, **scored by a strength-weighted formula** | no | a fixed-turn, higher-is-better points score — the other score model (§3.6) |
| 11 / 9 | one city; 150 science per turn | yes | `metric YIELD_SCIENCE rate 150`, `max_cities 1` |
| 10 / 7 | ≥ 54 (56) base strength standing on a marked set of tiles; trained units only; no cities past x = 38 | not yet | the data is all there (`units[].tile_xml_id`, `UNIT_STATS.strength`, `original_tribe`) — what is missing is a way to *mark tiles* at creation. An `area` objective with a tile picker on the map is the natural v2 kind; the geometry rule is a house rule |
| 8 | two cities at Strong culture with 2 barracks, 2 ranges, 2 apprentice + 2 elder officers, a citadel; economy positive + iron ≥ UU cost | yes | `city {count 2, culture STRONG, improvements {…}, specialists {…}}`, `economy {…, YIELD_IRON 200}` |
| 5, 4, 2, 1 | win the game | yes | `victory` — the challenge upload path accepts a finished game as readily as an unfinished one |
| 3 | settle every city site **or** reach 79 points | objectives yes, "or" no | either is a `metric`; v1 objectives are AND-only (§3.6) |

Twenty-two of twenty-six are fully expressible; the four that are not fail on three things, none of which is an objective kind: two other *score models*, one *or*, and one *tile picker*.

### 3.6 Deliberately not in v1

- **Other score models.** #12 (points by formula at a fixed turn) and #16.1 (sum of two turns) are not "the turn you met everything". They would be a `score_mode` on the challenge with its own leaderboard direction, and the formula of #12 would need a scoring expression. v1 has one score model and says so on the create page; the two historical exceptions are the evidence it is the right default, not a reason to build a second one now.
- **Alternative objectives (`or`).** #3 only. Objective groups are a JSON shape change and a UI for it; not worth it for one instance — a creator with an either/or posts the one they care about, or two challenges.
- **`area` objectives.** #7 and #10 — an important genre ("get strength here"), and everything except the picker exists. Second iteration, after the map component grows a tile-selection mode.

## 4. Identity: proving a save is a run of *this* map

Every Old World save carries `GameId` (a GUID; parsed today as `match_metadata.xml_game_id`), and loading a save continues the same game rather than minting a new one. So:

- The challenge stores the map's `xml_game_id` in its setup.
- A submission is accepted only if its `xml_game_id` equals it, its roster has exactly one human, that human's `player_index` and nation equal the map's, and its `total_turns` ≥ 1.

That is the whole verification. It is the same trust level as tournament uploads — the browser parses, the Worker validates shape and consistency, and a hand-edited XML is as possible here as there. Difficulty and map size are compared too, but as consistency checks that reject with a clear message, not as security.

`GameId` is minted when the game is created, and every load of the map continues that game, so every challenger's save carries the map's id. The scorer fixtures include one real load-play-save round trip of a turn-1 map so the assumption is pinned by a test rather than by this sentence.

## 5. The scorer

### 5.1 Where it lives

`src/lib/challenges/scoring.ts` — pure, **dependency-free** (no `$lib` aliases; relative imports of `./types` and four generated tables only). The Worker runs it through a **generated mirror**: `npm run bake:challenge-mirror` writes `cloud/src/challenges/{scoring,types}.ts` from the frontend files through `scripts/challenge-mirror.ts` (header only — the relative imports resolve identically from either tree, and the transform refuses any import that wouldn't), and `cloud/src/challenges/mirror.test.ts` asserts the on-disk mirrors byte-for-byte. The tables it reads — `unit-stats`, `wonders`, `dynasty-traits`, `theology-tiers` — are dual-emitted to `cloud/src/generated/` by their bakes. This is the momentum-mirror pattern rather than a cross-tree import: no Worker runtime file imports from `src/lib/`, and the maintainer flagged that as a repo-wide decision, not a per-PR one. One function, two callers:

- the **Worker**, in `handleGameUpload`, after Valibot has parsed the blob and before any R2 put — the authoritative verdict, persisted;
- the **upload modal**, after the browser parse — a preview, so a player sees "✗ Family Sedes is Angry (−120)" before spending an upload, and so an unmet run never reaches the Worker.

Same function, same answer; the Worker's is the one that counts.

```ts
export function scoreChallenge(
	challenge: { setup: ChallengeSetup; objectives: Objective[] },
	blob: ScorableBlob,   // the FullGameData fields the scorer reads, declared structurally so the module stays dependency-free
): Verdict;

interface Verdict {
	identity: { ok: boolean; reason?: string };          // §4
	objectives: Array<{ met: boolean; met_turn: number | null; observed: string }>;
	criteria: Array<{ kind: Criterion["kind"]; met: boolean; detail: string }>;  // one per §3.3 row the challenge enables
	met: boolean;                                       // every objective and criterion
	score_turn: number | null;                          // total_turns when met, else null
	earliest_turn: number | null;                       // §5.4
}
```

### 5.2 Reading the blob

Everything is keyed by the map's `player_index`, which is the XML `Player ID` and matches `player_id` / `player_xml_id` across the blob. The parser already warns that single-player saves leave `player_name` empty for everyone — attribute by id, never by name.

### 5.3 Deadlines

`limit = min(by_turn ?? Infinity, total_turns)`. For history-backed kinds, `met_turn` is the first turn ≤ `limit` at which the target was reached; for snapshot kinds (`unit`, `army`, `city`, `cognomen`, non-wonder `build`) it is `null` and the objective is met iff the save's state satisfies it (a snapshot kind cannot carry `by_turn`; the create form and the Valibot schema both refuse it).

### 5.4 The hint

`earliest_turn = max(met_turn)` over the objectives, but only when every objective has a `met_turn`; otherwise `null`. The result card shows it when it is below the score: "Every objective was met by turn 40 — a save from turn 40 would score 40." It is a hint, not a score: the criteria are only known at the save's turn (§2).

### 5.5 Tests

Unit tests beside the module, fixture-driven, one per row of the objective table plus each criterion's pass and fail, the identity checks, and the deadline boundary (`met_turn === by_turn` passes; `+1` fails). The §3.5 table doubles as the fixture list: each expressible challenge is written as JSON in a test and evaluated against a save that meets it and one that does not. The Worker integration test uploads to a challenge through `POST /v1/games` and asserts the persisted verdict equals the pure function's — the wiring, not the arithmetic.

## 6. Data model

### 6.1 Migration `00xx_challenges.sql`

```sql
CREATE TABLE challenges (
    challenge_id  TEXT PRIMARY KEY,                       -- nanoid(21)
    number        INTEGER NOT NULL UNIQUE,                -- #27, #28, … the public identity
    title         TEXT NOT NULL,
    description   TEXT,                                   -- plain text; the creator's flavour and any house rules
    created_by    TEXT NOT NULL REFERENCES users(user_id),
    closes_at     TEXT NOT NULL,                          -- ISO; submissions are refused after this. Creator's choice, default 30 days
    setup         TEXT NOT NULL,                          -- JSON, §3.1: nation, leader, traits, map, difficulty, options, xml_game_id, player_index
    objectives    TEXT NOT NULL,                          -- JSON array, §3.2
    map_r2_key    TEXT NOT NULL,                          -- challenges/{challenge_id}/map.zip
    map_file_hash TEXT NOT NULL,                          -- SHA-256 of the ZIP, for the download ETag and duplicate detection
    map_size_bytes INTEGER NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE challenge_submissions (
    submission_id TEXT PRIMARY KEY,                       -- nanoid(21)
    challenge_id  TEXT NOT NULL REFERENCES challenges(challenge_id) ON DELETE CASCADE,
    game_id       TEXT NOT NULL UNIQUE REFERENCES games(game_id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL REFERENCES users(user_id),
    score_turn    INTEGER NOT NULL,                       -- the save's total_turns; only met runs are stored
    verdict       TEXT NOT NULL,                          -- JSON, the Verdict the Worker computed
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_challenge_submissions_board ON challenge_submissions(challenge_id, score_turn, created_at);
```

**Only met runs are stored.** An unmet upload is refused at the same gate that refuses an incomplete game today (`400 CHALLENGE_NOT_MET`, verdict in the body) and nothing is written — not the game either. The modal's preview means this is a defence, not the normal path.

**A submission is a `games` row plus a link**, the way a tournament match is. The run gets the full game page — the whole point of a save-analysis site scoring a challenge is that you can open a winning run's Economy tab — and the whole upload pipeline (dedupe by file hash, R2, D1 pivot, reindex) for free. `ON DELETE CASCADE` on `game_id`: deleting the game withdraws the run. That differs from `tournament_matches.game_id`'s `SET NULL` (migration 0013) deliberately — a match must survive its save, a leaderboard row must not.

**Numbering.** `number = MAX(number) + 1` with a floor of `27`, allocated in the insert by the same correlated-subquery idiom `admin.ts` uses for dense `match_number`s (`cloud/src/tournament/admin.ts:2717`), with the `UNIQUE` constraint as the race guard and one retry. The floor is a named constant with the Discord history in its comment — `FIRST_CHALLENGE_NUMBER = 27` — because there is no other record of #1–#26 to seed.

**Locking.** Objectives (and the map) are immutable once the first submission exists — people played against the posted rules. Title and description stay editable. This is the tournament `setup → swiss` config lock, without a status enum: the lock is `EXISTS (submission)`, which cannot drift from the truth.

**Duration.** A challenge runs for a period the creator picks at creation — `duration_days`, default `30`, stored as `closes_at` — a month gives a Discord-sized group time to find a slot. Submissions after `closes_at` are refused (`409 CHALLENGE_CLOSED`, the `TOURNAMENT_COMPLETE` sibling) and the leaderboard is final. The creator (or an admin) may move `closes_at` while the challenge is open — extending a quiet one, or closing early — but not reopen a closed one: a final leaderboard stays final. "Open" is `closes_at > now`; there is no status column to keep in step with it.

### 6.2 What changes in `games`

A challenge run is by definition **not a completed game** — you stop at the turn you met the objectives — and Per-Ankh refuses incomplete uploads in two places: `validateCompletedGame` in the parser worker (`src/lib/parser/worker.ts`) and the `game_over` gate in `handleGameUpload` (`400 NOT_COMPLETED`, `cloud/src/games.ts`). Both are bypassed **only** when the upload names a `challenge_id`, and the bypass is replaced, not removed: the identity check and the scorer stand where the completed-game gate stood, so an incomplete save still cannot enter the library on its own.

Nothing structural. A challenge upload is an ordinary game with: `user_won` NULL and `winner_*` NULL (the game is not over, as observer uploads already record), `is_public = 1` forced, and a `Challenge #27` collection created on first use — the `Tournament: {name}` collection code path (`games.ts:1080`) with a different label, extracted so there is one "force public and file under a collection" helper rather than two.

### 6.3 Corpus predicates — the parallel surfaces

Challenge runs are single-human, incomplete, and all on the same map with the **same `xml_game_id`** — the Records dedupe (`dedupePlayerGames`, keyed `xmlGameId|playerIndex`) would collapse every user's run into one and the single-player slice would fill with turn-40 partials. They must be out of the aggregate corpus and out of the vs-AI scope, and that has to be done once:

- `cloud/src/games-scope.ts` gains `CHALLENGE_GAME_IDS_SQL = "SELECT game_id FROM challenge_submissions"` and a `challenge` `UserScope` beside `tournament`.
- `vs_ai` and `mp` add `game_id NOT IN (…)` for it, exactly as they already do for tournament games.
- `globalSliceGamesSql` (`cloud/src/stats/resolve.ts:102`) appends the exclusion — it is the single base every global corpus and nation list narrows from, which is why the exclusion goes there and nowhere else.
- The user's `all` scope keeps them (it keeps tournament games); the Games tab's scope dropdown gains "Challenges".
- The home page's recent-public-games list keeps them: they are public games.

`UserScope` is typed in both `cloud/src/stats/types.ts` and `src/lib/stats/types.ts`; both change.

## 7. Worker

`cloud/src/challenges/` — `public.ts` (reads), `admin.ts` (writes), `map.ts` (the ZIP), `scoring.ts` (re-export of the shared module plus the D1 glue). Valibot schemas in `cloud/src/schemas/challenge.ts`. Hand-rolled routes in `index.ts` like everything else.

| route | auth | does |
|---|---|---|
| `GET /v1/challenges` | public | list, open challenges first (soonest to close on top), then closed newest first: number, title, creator, nation, leader, map, difficulty, closes_at, run count, best turn |
| `POST /v1/challenges` | session | multipart: `map` (ZIP ≤ `MAX_ZIP_BYTES`), `setup` (JSON), `title`, `description`, `objectives` (JSON), `duration_days` (1–365, default 30). Validates shape, `total_turns === 1`, one human and ≤ 1 AI; hashes the ZIP; allocates the number; R2 put; D1 insert. Rate-limited like `tournament_create` (5/user/hour, `events`-table budget, retention bucket added). |
| `GET /v1/challenges/:number` | public | the challenge, its setup and objectives, whether it is locked, the leaderboard (§8), and `my_runs` when a session is present |
| `PATCH /v1/challenges/:number` | creator or admin | title/description always; `closes_at` while open; objectives only while unlocked |
| `DELETE /v1/challenges/:number` | creator while unlocked; admin always | deletes the row (submissions cascade, their games stay) and the R2 object |
| `GET /v1/challenges/:number/map` | session | streams the ZIP; `download` rate bucket; `Content-Disposition: attachment; filename="Challenge 27 <title>.zip"` via `buildSaveFilename`. Shares one `streamZipFromR2` helper with the two existing game-download handlers, which duplicate the streaming today. |
| `GET /v1/games/:id/challenge-link` | public | the sibling of `tournament-link`: `{ number, title, score_turn, rank } \| null`, for the game page banner |

**Submitting is `POST /v1/games` with a `challenge_id` form field**, the sibling of `tournament_match_id`. In the handler: when present, refuse if the challenge is closed, skip the `game_over` gate, run §4 identity and §5 scoring against the validated blob, refuse with the verdict if unmet, and — after the D1 batch succeeds — insert the submission and file the game under the challenge collection. A re-import (same file, newer parser) re-scores and updates the submission in place.

None of the routes is `staleTolerant`: the detail read is what the create redirect and the run upload land on, so it must see the write it follows — the same reason no tournament read is flagged (the one flagged route, user stats, is a KV-cached aggregate).

## 8. Leaderboard

Per challenge, **best run per user**: `ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score_turn, created_at)` = 1, ordered by `score_turn, created_at`. Ties share a turn but not a rank; the earlier submission is ahead — the same rule the Records boards apply to equal values. Columns: rank, player (`ProfileLink`, as every leaderboard here), turn, submitted, runs (that user's attempt count), and the game link. All attempts are kept; the viewer's own appear under the board.

The creator may play their own challenge. They built it, so they know the map; the community version let them, and the leaderboard marks the row with the same "creator" affordance the tournament pages use for organisers rather than hiding or asterisking it.

## 9. Frontend

Routes, mirroring `tournaments/`:

- `/challenges` — browse. Open challenges, then closed. Cards: `#27 · Title · by creator · Egypt, custom leader · Small Arid Plateau · The Great · closes in 9 days · 12 runs · best T38`. Public.
- `/challenges/new` — create. Session-gated like `/upload`. Drop the turn-1 save → parse in the browser (§7.1: the parser worker takes a `mode` that skips `validateCompletedGame` and instead requires `total_turns === 1` and one human) → the setup renders as a fact card (a map with seats after the creator's gets a one-click strip, §3.1; anything else it refuses, saying why) → title, description, duration (default 30 days) → objective rows → Create → `/challenges/27`.
- `/challenges/[number]` — the challenge: header (`Challenge #27 — Title`), the fact card, **Download map** (session-gated; anonymous sees a sign-in prompt), objectives with their deadlines, the three criteria, the leaderboard, **Submit a run** (replaced by "Closed on {date}" once closed), and the creator's edit controls (a popover in the `SettingsPopover` pattern; objectives greyed with "locked — 12 runs submitted" once locked).
- Submit → `/upload?challenge_id=X&return_number=27`, the exact shape of `?tournament_match_id=X&return_slug=Y`. `BulkUploadModal` gains a challenge mode beside its tournament mode: single file, no completed-game gate, and after the parse the verdict preview (§5.1) — each objective and criterion as a ✓/✗ line with what was observed. The Upload button is disabled while unmet. On success it returns to the challenge with the new row highlighted, as a tournament upload returns to its match.

Components in `src/lib/challenges/`: `ChallengeCard`, `SetupFacts`, `ObjectiveEditor` (kind select; target picker from the baked name tables — `tech-names`, `improvement-names` + `wonders`, `unit-stats`, `YIELD_SERIES`, religion/cognomen/culture enums; the per-kind fields of §3.2; deadline where allowed), `CriteriaEditor` (the §3.3 rows, standard set pre-filled), `ObjectiveList`, `CriteriaList`, `VerdictList` (shared by the modal preview and the result), `Leaderboard`.

**Game page.** `preTabs` banner "Challenge #27 · Title — scored turn 41, rank 3", and the breadcrumb parent becomes the challenge, both exactly as `tournamentLink` does it (`src/routes/games/[id]/+page.svelte:104`).

**Navigation.** "Challenges" in the header menu beside Global Stats and a home-page panel beside Featured Tournament, so the two competition surfaces sit together.

Everything new displays enums through `formatEnum`, names through the baked tables, colours through the helpers — no literals.

## 10. Rate limits, retention, PII

- `challenge_create`: 5/user/hour via `events`, added to `retention.ts`'s 24h rate-limit bucket; `challenge_delete` and `challenge_update` to the 90d audit bucket. Unlisted types are logged nightly as `unknown_types`, so this is not optional.
- Map download: the existing `download` bucket (50/hr user, 100/hr IP).
- Challenge reads: the existing public-read budget.
- The map ZIP carries the creator's `online_id`; session-gated (§3.1). The leaderboard shows display names and slugs — both already public. `verdict` JSON names families and cities, never people. Nothing new is logged; `PII_KEYS` stays the last line.

## 11. Settled questions and follow-ups

Settled with the challenge organiser (2026-09-02):

- **`GameId` is shared by every run of a map** — it is the game's identity and loading the map continues that game. §4 relies on it; a round-trip fixture pins it.
- **Custom-leader picks land on turn 1**, so §3.3's `acquired_turn ≤ 1` window is right as written.
- **`UnitsProduced` does not count starting units.** A `unit` objective means *train*; a *have* objective would read the unit roster snapshot instead, and is not in v1.
- **Challenges close.** The creator chooses the duration, default a month (§6.1).
- **Single-player only**, preferably with no AI (§3.1).

Follow-ups, deliberately outside v1:

1. **Loading a save with its AI seat stripped** (§3.1) — the transform is in and confirmed for a second human seat; an AI seat has not been tried in game.
2. **`area` objectives** (§3.6) — units on marked tiles; needs a tile picker.
3. **A second score model** (§3.6) — only if a formula or additive challenge comes up again.
4. **Language-independent wonder completion** (§3.4) — `derivePlayerWonders` matches English log text; a non-English save records no wonders. Not a challenge defect, but it makes wonder deadlines unscoreable for those saves.

## 12. Build order

Four PRs, split by risk, each mergeable alone:

1. **Parser + bake.** The §3.4 additions (`build_turns_left`, `original_tribe`, `UNIT_STATS.nation`, `THEOLOGY_TIERS`, the wonders fix), `scripts/bake-dynasty-traits.ts` and its generated table; the parser worker's `mode`.
2. **Scorer.** `src/lib/challenges/scoring.ts` with the §3.5 fixtures and tests. Pure code, no schema, no routes — reviewable in isolation and the part most likely to draw rules questions.
3. **Worker.** Migration, `cloud/src/challenges/`, the `challenge_id` branch in `handleGameUpload`, the corpus exclusions (§6.3), `challenge-link`, retention entries, integration tests, `docs/api-reference.md`. Deploys dark: nothing in the UI reaches it yet. Worker-before-frontend ordering as always.
4. **Frontend.** Routes, components, the modal mode, the game-page banner, navigation.

Then: fold this document into a `docs/challenges.md` reference in the style of `tournament-rules.md`, with the rule text of §1 as its opening — the paste-ready version for Discord.
