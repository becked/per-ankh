# Per-Ankh Tournaments: Technical Specification

This document specifies the architecture for layering tournament functionality on top of the cloud rewrite described in [`cloud-rewrite-spec.md`](./cloud-rewrite-spec.md). It assumes the cloud rewrite has shipped: Discord OAuth auth, D1 `users`/`games`/`player_summaries`/`events` tables, R2 blobs at `games/{id}.json.gz` and `saves/{id}.zip`, KV-backed sessions, and the Worker patterns established in `cloud/src/`.

The MVP target is a single live tournament — Old World's first Swiss + championship event — with per-tournament admins, replaceable players, public tournament pages, and minimal verification (we trust uploaders).

## Table of Contents

1. [Overview & Scope](#1-overview--scope)
2. [Tournament Rules Summary](#2-tournament-rules-summary)
3. [Domain Model](#3-domain-model)
4. [Collections Port](#4-collections-port)
5. [Lifecycle Flows](#5-lifecycle-flows)
6. [Tiebreaker Cascade](#6-tiebreaker-cascade)
7. [Authorization Model](#7-authorization-model)
8. [API Design](#8-api-design)
9. [Frontend Surfaces](#9-frontend-surfaces)
10. [R2 / Storage](#10-r2--storage)
11. [Rate Limits](#11-rate-limits)
12. [Schema Migrations](#12-schema-migrations)
13. [Open Questions & Future Work](#13-open-questions--future-work)

---

## 1. Overview & Scope

A tournament in Per-Ankh is a static placeholder that references uploaded saves, plus the math to compute standings and the workflow to advance rounds. The reference point is Challonge — bracket + standings + match list, with admin overrides — not a full game-hosting system.

### In scope (MVP)

- Two-phase tournament: Swiss qualifier (split into Western and Eastern divisions) → single-elimination championship.
- Per-tournament admin role.
- Replaceable players via stable bracket "slots" — the slot inherits W-L history when a player is substituted.
- Match results submitted by either player (first-report-wins, no opponent confirmation, no save verification) or by an admin on behalf.
- Saves uploaded into the existing `POST /v1/games` flow with an optional tournament-match link; the upload lives in the uploader's library and is forced public.
- Cascading tiebreaker (Median-Buchholz → Solkoff → head-to-head → admin choice) for selecting top-N-per-division advancement to championship.
- Public tournament pages (no login required to view).
- Admin retro-edit of any match.

### Out of scope (deferred)

- Cross-match tournament analytics pages — separate doc.
- Ad-hoc tournament creation by regular users (MVP creates tournaments via CLI/admin script).
- Notifications (email/Discord/in-app).
- Save verification beyond "completed game with a winner" (already enforced by the upload flow).
- Map-script enforcement.
- Dispute workflows beyond admin retro-edit.
- Team / multi-occupancy slots.
- Tags evolution of Collections (see §4).

### Feature inventory by user role

A product-level view of what the tournament layer adds on top of the cloud rewrite.

**For any visitor (no account):**
- Tournament list page — all tournaments with status badges
- Tournament home page — description, signup info, current standings, bracket, recent matches
- Match detail pages — view the linked save (forced public) for any tournament match
- Swiss standings table — rank, current player, W-L, Median-Buchholz, Solkoff
- Championship bracket visualization — single-elimination viz

**For logged-in users:**
- Register for a tournament with a division preference (Western / Eastern)
- Withdraw before the signup deadline
- View your matches across active and past tournaments
- Report match results (first-report-wins; pick winner, attach an uploaded save)
- Saves uploaded for a tournament auto-group into a `Tournament: <name>` collection in your library

**For tournament admins (per-tournament role):**
- Assign players to divisions in batch
- Set Round 1 pairings manually (slot vs. slot, with map script and pick-order winner)
- Auto-generate Swiss pairings for rounds 2–5 (algorithm proposes; admin reviews/confirms)
- Advance rounds (closes the round, updates slot W-L, marks advancements/eliminations)
- Substitute players mid-tournament — the slot keeps its W-L history; only the occupant changes
- Transition Swiss → championship (auto-builds the cross-division-seeded single-elim bracket)
- Resolve cascade ties manually when wins → Median-Buchholz → Solkoff → head-to-head all leave a tie at the cutoff
- Retro-edit any match (winner, status, attached save, notes)
- Mark tournament complete
- Upload saves on behalf of players (lands in admin's library, force-public, auto-grouped)

**For super-admins (CLI only, MVP):**
- Create tournaments via `cloud/admin.sh tournament create`
- Grant the per-tournament admin role to a user
- Audit tournament-related events via the existing events table

---

## 2. Tournament Rules Summary

### Swiss Qualifier

- Open registration until a stated deadline.
- Two divisions, **Western** and **Eastern**, roughly aligned to North American and European time zones. Division preference at signup; admin makes final assignments.
- Within each division: round 1 is paired by admin choice (typically random or seeded by something external like rating). Subsequent rounds bucket players by W-L record and pair within bucket, avoiding rematches.
- Each player plays until they reach **3 wins** (advance to championship) or **3 losses** (eliminated). Hard cap of **5 rounds**.
- Player counts are assumed even within each division (no byes). The schema permits byes, but the MVP UX assumes none.
- When more 3-W players exist than championship slots can hold, a **tiebreaker cascade** (see §6) decides advancement.

### Championship Bracket

- Single-elimination, ~4–5 rounds depending on advancement count.
- No divisions. Initial seeding cross-pairs divisions: top-rated from one against bottom-rated from the other, where "rated" means the cascade rank from §6.
- Advancement counts per division are assumed even (e.g., top 4 from each → 8-player bracket).
- A single loss eliminates a player. The Grand Finals produces the champion.

---

## 3. Domain Model

### Slot-based bracket model

The single most important design decision: **matches reference slots, not users**. A slot is a stable bracket position that holds W-L history. When a player drops mid-tournament and an admin finds a replacement, only the slot's `current_user_id` changes — the slot's match record and standing persist. The replacement walks into whatever situation the slot has accumulated.

Slot consequences:
- A slot eliminated at 3 Swiss losses stays eliminated; admins do not replace eliminated slots.
- A slot's history of occupants is recorded in `tournament_slot_history` for audit purposes.
- The same `user_id` cannot be assigned to two active slots in the same tournament (enforced at substitution time).

### D1 Schema

```sql
-- Tournament metadata
CREATE TABLE tournaments (
  tournament_id TEXT PRIMARY KEY,             -- nanoid(21)
  slug TEXT NOT NULL UNIQUE,                  -- URL slug, e.g. "ow-open-2026"
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,                       -- 'signups' | 'swiss' | 'championship' | 'complete'
  signup_deadline TEXT,                       -- ISO 8601, NULL until set
  swiss_advance_count INTEGER NOT NULL DEFAULT 4,  -- top-N per division → championship
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tournaments_status ON tournaments(status);

-- Per-tournament admin role
CREATE TABLE tournament_admins (
  tournament_id TEXT NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tournament_id, user_id)
);

CREATE INDEX idx_tournament_admins_user ON tournament_admins(user_id);

-- Player registrations
CREATE TABLE tournament_registrations (
  tournament_id TEXT NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  division_pref TEXT,                         -- 'WEST' | 'EAST' | NULL
  assigned_division TEXT,                     -- 'WEST' | 'EAST', set by admin pre-Swiss
  status TEXT NOT NULL,                       -- 'registered' | 'active' | 'eliminated' | 'withdrawn' | 'replaced'
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tournament_id, user_id)
);

CREATE INDEX idx_registrations_user ON tournament_registrations(user_id);
CREATE INDEX idx_registrations_division ON tournament_registrations(tournament_id, assigned_division);

-- Bracket slots — the stable identity behind replacements
CREATE TABLE tournament_slots (
  slot_id TEXT PRIMARY KEY,                   -- nanoid(21)
  tournament_id TEXT NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
  phase TEXT NOT NULL,                        -- 'swiss' | 'championship'
  division TEXT,                              -- 'WEST' | 'EAST' | NULL (championship)
  current_user_id TEXT REFERENCES users(user_id),  -- nullable during replacement gap
  swiss_wins INTEGER NOT NULL DEFAULT 0,
  swiss_losses INTEGER NOT NULL DEFAULT 0,
  swiss_status TEXT NOT NULL DEFAULT 'active',     -- 'active' | 'advanced' | 'eliminated'
  championship_seed INTEGER,                  -- 1-based seed in championship bracket
  championship_status TEXT,                   -- 'active' | 'advanced' | 'eliminated' | NULL
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_slots_tournament ON tournament_slots(tournament_id);
CREATE INDEX idx_slots_user ON tournament_slots(current_user_id);

-- Slot occupancy history (audit trail)
CREATE TABLE tournament_slot_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id TEXT NOT NULL REFERENCES tournament_slots(slot_id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(user_id),     -- NULL = vacancy entry
  occupied_from TEXT NOT NULL DEFAULT (datetime('now')),
  occupied_to TEXT,                           -- NULL = current
  reason TEXT NOT NULL                        -- 'initial' | 'substitution' | 'withdrawal'
);

CREATE INDEX idx_slot_history_slot ON tournament_slot_history(slot_id);

-- Rounds
CREATE TABLE tournament_rounds (
  round_id TEXT PRIMARY KEY,                  -- nanoid(21)
  tournament_id TEXT NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
  phase TEXT NOT NULL,                        -- 'swiss' | 'championship'
  division TEXT,                              -- 'WEST' | 'EAST' | NULL (championship)
  round_number INTEGER NOT NULL,
  status TEXT NOT NULL,                       -- 'pending' | 'in_progress' | 'complete'
  generated_at TEXT,
  completed_at TEXT,
  UNIQUE (tournament_id, phase, division, round_number)
);

-- Matches
CREATE TABLE tournament_matches (
  match_id TEXT PRIMARY KEY,                  -- nanoid(21)
  round_id TEXT NOT NULL REFERENCES tournament_rounds(round_id) ON DELETE CASCADE,
  slot_a_id TEXT NOT NULL REFERENCES tournament_slots(slot_id),
  slot_b_id TEXT REFERENCES tournament_slots(slot_id),  -- NULL = bye
  map_script TEXT,                            -- e.g. 'MAPCLASS_CONTINENT'; free-text fallback
  pick_order_winner_slot_id TEXT REFERENCES tournament_slots(slot_id),
  status TEXT NOT NULL,                       -- 'pending' | 'reported' | 'forfeit' | 'bye' | 'admin_recorded'
  winner_slot_id TEXT REFERENCES tournament_slots(slot_id),
  game_id TEXT REFERENCES games(game_id),     -- the linked save (NULL for forfeit/bye)
  reported_by_user_id TEXT REFERENCES users(user_id),
  reported_at TEXT,
  notes TEXT
);

CREATE INDEX idx_matches_round ON tournament_matches(round_id);
CREATE INDEX idx_matches_game ON tournament_matches(game_id);
CREATE INDEX idx_matches_slot_a ON tournament_matches(slot_a_id);
CREATE INDEX idx_matches_slot_b ON tournament_matches(slot_b_id);
```

### Notes on the schema

- All IDs are 21-char nanoids, matching the cloud-rewrite-spec convention. `tournament_slot_history.id` is an autoincrement integer because it's only an internal audit log.
- `tournament_slots.phase` distinguishes Swiss slots from championship slots. Championship slots are created fresh during the Swiss → championship transition; the Swiss slot's standing is what gets seeded, not the slot itself. This avoids cross-phase status field confusion and keeps championship bracket math clean.
- `tournament_matches.slot_b_id` is nullable to support byes; the MVP UX assumes no byes but the schema does not block them.
- `tournament_matches.game_id` is nullable for forfeit / bye / admin-recorded results without a save.
- `UNIQUE (tournament_id, phase, division, round_number)` on rounds prevents duplicate round generation. `division` participates in the unique key because Swiss rounds are per-division.

---

## 4. Collections Port

The desktop has a Collections feature (`src-tauri/src/db/collections.rs`, `src/lib/CollectionsModal.svelte`, `src/lib/GameSidebar.svelte`) that groups matches into named buckets. The cloud rewrite spec does not mention it; this section ports it to D1 as a **per-user** concept, and tournaments use it to auto-group uploaded saves in admins' libraries.

### Schema

```sql
CREATE TABLE collections (
  collection_id TEXT PRIMARY KEY,             -- nanoid(21)
  user_id TEXT NOT NULL REFERENCES users(user_id),
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);

CREATE INDEX idx_collections_user ON collections(user_id);

-- Add to games (created in cloud-rewrite-spec.md §3)
ALTER TABLE games ADD COLUMN collection_id TEXT REFERENCES collections(collection_id);
CREATE INDEX idx_games_collection ON games(collection_id);
```

### Behavior

- On first user login, a default collection named `Personal` is auto-created with `is_default = TRUE`. Every uploaded game without an explicit collection lands in the user's default.
- All collection queries scope by `user_id`. There is no global collection.
- The desktop's 7 functions map to REST endpoints (see §8).
- **Tournament integration**: when an upload includes `tournament_match_id`, the Worker:
  1. Looks up the tournament name.
  2. Finds-or-creates a collection named `Tournament: <name>` in the uploader's library.
  3. Sets the new game's `collection_id` to that collection.
  4. Sets `games.is_public = TRUE`.
- Personal-stats endpoints (`/v1/stats`) make no automatic exclusion based on collection. If a user wants to exclude their tournament games from personal stats, they apply a collection filter like any other.

### Forward compatibility

The user has signaled future intent to evolve collections into many-to-many tags (a game in multiple collections). The cloud schema above keeps `games.collection_id` as a single FK for MVP simplicity. The migration to a join table later is straightforward (`game_collections (game_id, collection_id)` with the existing `collection_id` column dropped after a backfill).

---

## 5. Lifecycle Flows

Each flow lists the actor, the API endpoint(s), and the state changes.

### 5.1 Tournament creation (CLI/script only)

```
Admin operator (out-of-band)
  │
  ▼
cloud/admin.sh tournament create --name "OW Open 2026" --slug ow-open-2026
  │
  ▼
INSERT INTO tournaments (tournament_id, slug, name, status='signups', ...)
  │
  ▼
cloud/admin.sh tournament admin add <tournament_id> <user_id>
  │
  ▼
INSERT INTO tournament_admins (tournament_id, user_id)
```

No frontend UI in MVP. The script wraps `wrangler d1 execute --remote` like the existing share admin commands.

### 5.2 Player registration

```
Logged-in user → POST /v1/tournaments/:id/register { division_pref }
  │
  ▼
Validate tournament.status = 'signups' AND signup_deadline > now
  │
  ▼
INSERT INTO tournament_registrations (... status='registered')
```

### 5.3 Division assignment

```
Admin → POST /v1/tournaments/:id/divisions/assign
  body: [{ user_id, division: 'WEST' | 'EAST' }, ...]
  │
  ▼
For each: UPDATE tournament_registrations SET assigned_division = ?, status = 'active'
  │
  ▼
Create one slot per active registration:
  INSERT INTO tournament_slots (slot_id, phase='swiss', division, current_user_id, ...)
  INSERT INTO tournament_slot_history (slot_id, user_id, reason='initial')
```

After this completes, the admin transitions the tournament to `swiss` status.

### 5.4 Swiss Round 1 pairing (admin-set)

```
Admin → POST /v1/tournaments/:id/rounds/:round_id/pairings
  body: [{ slot_a_id, slot_b_id, map_script, pick_order_winner_slot_id }, ...]
  │
  ▼
Round 1 must be created first (one row per division):
  INSERT INTO tournament_rounds (..., phase='swiss', division='WEST', round_number=1, status='pending')
  │
  ▼
For each pairing: INSERT INTO tournament_matches (..., status='pending')
  │
  ▼
UPDATE tournament_rounds SET status = 'in_progress', generated_at = now
```

### 5.5 Swiss Round N pairing (N > 1, auto-generated)

```
Admin → POST /v1/tournaments/:id/rounds/:round_id/generate-pairings
  │
  ▼
Backend Swiss algorithm:
  1. Bucket active slots by W-L record (e.g. (1,0), (0,1))
  2. Within each bucket, pair avoiding rematches
  3. Handle bucket spillover via float-up/float-down
  4. Return proposed pairings (NOT persisted yet)
  │
  ▼
Admin reviews, optionally edits, then →
POST /v1/tournaments/:id/rounds/:round_id/pairings (same as Round 1)
```

The generate endpoint is a pure computation that returns proposed pairings; the confirmation step is a separate POST so an admin can override.

### 5.6 Match reporting (first-report-wins)

```
Either participant OR admin → POST /v1/tournaments/:id/matches/:match_id/report
  body: { winner_slot_id, game_id?, status: 'reported' | 'forfeit' | 'admin_recorded' }
  │
  ▼
Authz: caller is admin OR (caller's user_id = current_user_id of slot_a or slot_b)
  │
  ▼
UPDATE tournament_matches SET status = ?, winner_slot_id = ?, game_id = ?,
                                reported_by_user_id = ?, reported_at = now
```

If the report includes a `game_id`, the upload must already exist (created via `POST /v1/games`). The save linkage is decoupled from the result — a match can be reported without a save (e.g. forfeit), and a save can be uploaded before the result is reported.

### 5.7 Round advancement

```
Admin → POST /v1/tournaments/:id/rounds/:round_id/advance
  │
  ▼
Validate every match in round has status != 'pending'
  │
  ▼
For each match: increment slot_wins / slot_losses on the appropriate slot
  │
  ▼
Mark slots that reached 3 wins → swiss_status = 'advanced'
Mark slots that reached 3 losses → swiss_status = 'eliminated'
  │
  ▼
UPDATE tournament_rounds SET status = 'complete', completed_at = now
```

The round advance is the only place slot W-L is mutated. Match retro-edits roll back and replay the affected slot's record (see §5.10).

### 5.8 Player drop / replacement

```
Admin → POST /v1/tournaments/:id/slots/:slot_id/substitute
  body: { replacement_user_id, reason: 'withdrawal' }
  │
  ▼
Validate replacement_user_id is not already in an active slot in this tournament
  │
  ▼
UPDATE tournament_slot_history SET occupied_to = now WHERE slot_id = ? AND occupied_to IS NULL
UPDATE tournament_slots SET current_user_id = replacement_user_id
INSERT INTO tournament_slot_history (slot_id, user_id, reason='substitution')
UPDATE tournament_registrations:
  - dropped player → status = 'replaced'
  - replacement → INSERT or UPDATE to status = 'active', assigned_division = slot's division
```

The replacement inherits the slot's W-L record and any prior matches. They start playing in the next round.

### 5.9 Swiss → Championship transition

```
Admin → POST /v1/tournaments/:id/transition-championship
  │
  ▼
Validate every Swiss round in every division is complete
  │
  ▼
For each division:
  - Collect all slots with 3 wins (swiss_status = 'advanced')
  - If count > tournaments.swiss_advance_count, apply the §6 cascade to break the cutoff tie
  - Take top tournaments.swiss_advance_count by cascade rank
  │
  ▼
Build championship bracket via cross-division seeding:
  - Sort each division's advancers by rank
  - Pair: (West rank 1) vs (East rank N), (West rank 2) vs (East rank N-1), ...
  - Create new tournament_slots (phase='championship', division=NULL, championship_seed=1..2N)
  - Create championship round 1 with these matches
  │
  ▼
UPDATE tournaments SET status = 'championship'
```

The Swiss slots are not reused. Championship slots are fresh, so a player who advanced is now in a new slot. This keeps phase-specific status fields clean and avoids cross-phase invariants.

### 5.10 Championship rounds

Rounds 2..N are auto-generated from prior round results: winner of match (i, i+1) faces winner of match (i+2, i+3) in the next round. Same match-reporting flow as Swiss.

### 5.11 Admin retro-edit

```
Admin → PATCH /v1/tournaments/:id/matches/:match_id
  body: { winner_slot_id?, status?, game_id?, notes? }
  │
  ▼
If round is already 'complete' AND winner_slot_id is changing:
  - Reverse the W-L deltas the prior result contributed
  - Apply the new result's deltas
  - Re-evaluate slot statuses (advanced / eliminated thresholds)
  - For championship matches: cascading rebuild of subsequent rounds may be required
    (MVP: refuse the edit if a downstream championship round has already started;
     admin must manually unwind via separate edits)
```

### 5.12 Tournament completion

```
Admin → POST /v1/tournaments/:id/complete
  │
  ▼
Validate championship final has a winner
  │
  ▼
UPDATE tournaments SET status = 'complete'
```

After completion, all admin-mutating endpoints return 409 Conflict. Read endpoints continue to work indefinitely.

---

## 6. Tiebreaker Cascade

The Old World tournament's "advance at 3 wins" stop creates uneven game counts among advancers (a 3-0 player has 3 opponents; a 3-2 player has 5). Median-Buchholz alone is too thin a signal in that regime, so this spec uses a cascading tiebreaker matching [Challonge's Swiss defaults](https://kb.challonge.com/en/article/learn-about-challonge-competition-formats-1f8j1cf/) (with their game-points layers omitted, since OW matches are single games rather than best-of-three).

### Cascade order

1. **Wins** — `swiss_wins`, descending. Already the cut criterion; included in the comparator for completeness.
2. **Median-Buchholz** — sum of opponents' wins, dropping the highest and lowest opponent score. Standard short-tournament strength-of-schedule.
3. **Solkoff** — sum of opponents' wins with no drops (full Buchholz). Catches cases where Median-Buchholz drops too aggressively.
4. **Head-to-head** — when comparing exactly two tied slots that played each other, the winner of that match ranks higher. Undefined (skip to next level) if they didn't play or if the comparison involves >2 still-tied slots in a cycle.
5. **Admin choice** — final fallback. The standings endpoint surfaces still-tied slots; the admin makes the call. Recorded as a row in `tournament_admins`-attributable audit (via the `events` table) when invoked.

All values are computed on demand from `tournament_matches` + `tournament_slots`. None are stored.

### Pairwise comparator

```ts
function compareSlots(
  a: TournamentSlot,
  b: TournamentSlot,
  ctx: { matches: TournamentMatch[]; slots: Map<string, TournamentSlot> },
): number {
  // 1. Wins (descending)
  if (a.swiss_wins !== b.swiss_wins) return b.swiss_wins - a.swiss_wins;

  // 2. Median-Buchholz (descending)
  const mbA = computeMedianBuchholz(a.slot_id, ctx);
  const mbB = computeMedianBuchholz(b.slot_id, ctx);
  if (mbA !== mbB) return mbB - mbA;

  // 3. Solkoff / Full Buchholz (descending)
  const sA = computeSolkoff(a.slot_id, ctx);
  const sB = computeSolkoff(b.slot_id, ctx);
  if (sA !== sB) return sB - sA;

  // 4. Head-to-head: winner ranks first
  const h2h = headToHead(a.slot_id, b.slot_id, ctx.matches);
  if (h2h !== 0) return h2h;

  // 5. Comparator returns 0 (still tied); caller resolves manually
  return 0;
}
```

### Component computations

```ts
function computeMedianBuchholz(slotId: string, ctx: Ctx): number {
  const opponentWins = collectOpponentWins(slotId, ctx).sort((a, b) => a - b);
  if (opponentWins.length <= 2) return opponentWins.reduce((a, b) => a + b, 0);
  return opponentWins.slice(1, -1).reduce((a, b) => a + b, 0);
}

function computeSolkoff(slotId: string, ctx: Ctx): number {
  return collectOpponentWins(slotId, ctx).reduce((a, b) => a + b, 0);
}

function collectOpponentWins(slotId: string, ctx: Ctx): number[] {
  const opponentIds: string[] = [];
  for (const m of ctx.matches) {
    if (m.slot_a_id === slotId && m.slot_b_id) opponentIds.push(m.slot_b_id);
    else if (m.slot_b_id === slotId) opponentIds.push(m.slot_a_id);
  }
  return opponentIds.map(id => ctx.slots.get(id)?.swiss_wins ?? 0);
}

function headToHead(slotA: string, slotB: string, matches: TournamentMatch[]): number {
  for (const m of matches) {
    const isAB = m.slot_a_id === slotA && m.slot_b_id === slotB;
    const isBA = m.slot_a_id === slotB && m.slot_b_id === slotA;
    if (!isAB && !isBA) continue;
    if (m.winner_slot_id === slotA) return -1;  // a ranks first
    if (m.winner_slot_id === slotB) return 1;
  }
  return 0;  // didn't play, or no winner recorded
}
```

### Application

Used during the Swiss → championship transition (§5.9) only when more slots reached 3 wins than `tournaments.swiss_advance_count` allows. The transition endpoint sorts all 3-W slots in a division using `compareSlots` and takes the top N. If the comparator returns 0 between a slot inside the cutoff and a slot outside it (i.e. fully tied through every level except admin choice), the endpoint returns 409 Conflict with the tied slot IDs in the response; the admin must call a separate `POST /v1/tournaments/:id/resolve-tie` endpoint specifying the resolution before re-running the transition.

### Standings endpoint

`GET /v1/tournaments/:id/standings` returns per-slot:

```ts
{
  slot_id: string;
  current_user_id: string | null;
  swiss_wins: number;
  swiss_losses: number;
  median_buchholz: number;
  solkoff: number;
  swiss_status: 'active' | 'advanced' | 'eliminated';
}
```

Head-to-head is not returned (it's pairwise, not a per-slot scalar) but the matches list is already available via `GET /v1/tournaments/:id/matches` for clients that want to surface head-to-head context.

---

## 7. Authorization Model

| Action | Anonymous | Logged-in user | Tournament admin (this tournament) | Tournament admin (other tournament) |
|---|---|---|---|---|
| View tournament page | ✓ | ✓ | ✓ | ✓ |
| View match save (game blob) | ✓ (forced public) | ✓ | ✓ | ✓ |
| Register | ✗ | ✓ (during signups) | ✓ | ✓ |
| Report own match result | ✗ | ✓ (if in match) | ✓ | ✗ (but ✓ if in match as a participant) |
| Report any match result | ✗ | ✗ | ✓ | ✗ |
| Substitute player | ✗ | ✗ | ✓ | ✗ |
| Set Round 1 pairings | ✗ | ✗ | ✓ | ✗ |
| Generate pairings | ✗ | ✗ | ✓ | ✗ |
| Advance round | ✗ | ✗ | ✓ | ✗ |
| Retro-edit match | ✗ | ✗ | ✓ | ✗ |
| Transition to championship | ✗ | ✗ | ✓ | ✗ |
| Mark complete | ✗ | ✗ | ✓ | ✗ |
| Create tournament | ✗ | ✗ | ✗ | ✗ (CLI/script only) |

### Implementation

A middleware function resolves `tournament_id` (from path slug or `:id` parameter) and looks up the caller's session. Two helpers:

```ts
async function requireTournamentAdmin(
  env: Env,
  session: Session,
  tournamentId: string,
): Promise<void> {
  const row = await env.DB.prepare(
    "SELECT 1 FROM tournament_admins WHERE tournament_id = ? AND user_id = ?"
  ).bind(tournamentId, session.user_id).first();
  if (!row) throw new HttpError(403, "Not a tournament admin");
}

async function requireMatchParticipantOrAdmin(
  env: Env,
  session: Session,
  matchId: string,
): Promise<{ tournamentId: string; isAdmin: boolean }> {
  // Resolves tournament + slot occupancy in one query; throws 403 if neither.
}
```

These follow the manual-validation, prepared-statement style of `cloud/src/index.ts` and `cloud/src/validation.ts` — no external auth library.

---

## 8. API Design

Base URL: `https://api.per-ankh.app/v1` (same as cloud-rewrite-spec.md §4). All admin endpoints require the session cookie set during Discord OAuth login plus a `tournament_admins` row for the target tournament.

### Public reads

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/tournaments` | None | List tournaments (filters: `status`, `limit`, `offset`) |
| `GET` | `/tournaments/:slug` | None | Tournament detail (metadata, standings summary, participating users) |
| `GET` | `/tournaments/:id/standings` | None | Per-slot W-L + Median-Buchholz + Solkoff, grouped by division/phase |
| `GET` | `/tournaments/:id/bracket` | None | Championship bracket structure |
| `GET` | `/tournaments/:id/matches` | None | All matches; query params: `round_id`, `phase`, `division`, `slot_id` |
| `GET` | `/tournaments/:id/matches/:match_id` | None | Match detail, including linked `game_id` |

### Player actions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/tournaments/:id/register` | Session | Body: `{ division_pref?: 'WEST' \| 'EAST' }` |
| `DELETE` | `/tournaments/:id/register` | Session | Withdraw before signup deadline |
| `POST` | `/tournaments/:id/matches/:match_id/report` | Session | Body: `{ winner_slot_id, game_id?, status }`. Caller must be participant or admin. |

### Admin actions (require `tournament_admins` membership)

| Method | Path | Description |
|--------|------|-------------|
| `PATCH` | `/tournaments/:id` | Edit tournament metadata (name, description, deadlines, status) |
| `POST` | `/tournaments/:id/divisions/assign` | Body: `[{ user_id, division }, ...]`. Creates Swiss slots. |
| `POST` | `/tournaments/:id/rounds` | Body: `{ phase, division?, round_number }`. Creates an empty round. |
| `POST` | `/tournaments/:id/rounds/:round_id/generate-pairings` | Returns proposed pairings (no DB writes). |
| `POST` | `/tournaments/:id/rounds/:round_id/pairings` | Body: `[{ slot_a_id, slot_b_id?, map_script, pick_order_winner_slot_id }, ...]`. Persists matches. |
| `POST` | `/tournaments/:id/rounds/:round_id/advance` | Closes the round; updates slot W-L. |
| `POST` | `/tournaments/:id/slots/:slot_id/substitute` | Body: `{ replacement_user_id, reason }`. |
| `POST` | `/tournaments/:id/transition-championship` | Builds championship bracket from Swiss results. Returns 409 if the cascade leaves slots tied at the cutoff. |
| `POST` | `/tournaments/:id/resolve-tie` | Body: `{ slot_ids: string[], ranked_order: string[] }`. Records admin-chosen ordering for slots the cascade couldn't separate. |
| `PATCH` | `/tournaments/:id/matches/:match_id` | Retro-edit. Body: any subset of `{ winner_slot_id, status, game_id, notes }`. |
| `POST` | `/tournaments/:id/complete` | Finalizes tournament. |

### Collections

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/collections` | Session | List the caller's collections with game counts |
| `POST` | `/collections` | Session | Body: `{ name }`. Create a collection. |
| `PATCH` | `/collections/:id` | Session | Body: `{ name?, is_default? }`. |
| `DELETE` | `/collections/:id` | Session | Delete; games move to user's default collection. |
| `POST` | `/collections/:id/move-games` | Session | Body: `{ game_ids: string[] }`. Bulk reassign. |

### Upload integration

Extend `POST /v1/games` (defined in cloud-rewrite-spec.md §4) to accept an optional `tournament_match_id` form-data field. When present:

1. Validate the caller is a participant in the match (occupies `slot_a_id` or `slot_b_id`'s `current_user_id`) **or** a tournament admin.
2. After creating the `games` row, set its `collection_id` to the user's `Tournament: <name>` collection (find-or-create).
3. Force `games.is_public = TRUE`.
4. The Worker does **not** auto-link `tournament_matches.game_id` — that link happens via the separate match-report endpoint, so the uploader can choose whether to attach the save now or later.

### Error shape

Reuse the existing `errorResponse(message, status, env)` pattern from `cloud/src/index.ts`.

### Validation

Follow the manual type-guard pattern of `cloud/src/validation.ts`. Each endpoint has a small validator function returning `ValidationResult { valid: boolean; error?: string }`. No Zod / Yup.

---

## 9. Frontend Surfaces

SvelteKit routes added on top of the cloud rewrite's route tree (cloud-rewrite-spec.md §6).

```
src/routes/
  tournaments/
    +page.svelte                         — Public list of tournaments
    [slug]/
      +page.svelte                       — Tournament home: standings, bracket, recent matches
      register/+page.svelte              — Registration form (signup phase only)
      matches/[match_id]/+page.svelte    — Match detail; links to GameDetailView
      admin/+page.svelte                 — Admin panel (gated)
```

### Components

| Component | Purpose |
|-----------|---------|
| `TournamentCard.svelte` | List item with name, status, player count |
| `SwissStandings.svelte` | Per-division table: rank, slot label (current player name), W-L, Median-Buchholz |
| `BracketView.svelte` | Championship single-elimination viz |
| `MatchCard.svelte` | Slot vs. slot, status, save link, report button |
| `ReportMatchModal.svelte` | Pick winner, attach uploaded save (dropdown of caller's recent uploads or upload-and-link in one flow) |
| `AdminPanel.svelte` | Pairing generator, substitution form, retro-edit form, round advance, transition button |
| `RegistrationForm.svelte` | Division preference selector + submit |

`MatchCard` and the match detail page link to the existing `GameDetailView.svelte` (`src/lib/game-detail/`) for the uploaded save's content — no new game-detail surface.

### Public visibility

Tournament pages render server-side without an auth check. The match detail page renders the full `GameDetailView` for any tournament-linked save (since `is_public = TRUE` is forced on upload).

---

## 10. R2 / Storage

No new R2 patterns. Tournament-linked saves use the same `games/{game_id}.json.gz` and `saves/{game_id}.zip` keys defined in cloud-rewrite-spec.md §3. The only differences:

- `games.is_public` is forced TRUE for tournament-linked saves.
- `tournament_matches.game_id` is the canonical link from a match to a save. There is no reverse pointer on `games` — finding "which tournament match is this save attached to?" is a query, not a column.

The single-save-per-match decision means the same save uploaded by both players results in two `games` rows (per the existing `UNIQUE (user_id, xml_game_id, total_turns)` constraint), and a tournament match references whichever was reported first. Both rows continue to exist in their respective uploaders' libraries.

---

## 11. Rate Limits

Reuse the events-table pattern from `cloud/src/index.ts`. Add the following event types and limits to the existing `RATE_LIMIT_PER_HOUR` family:

| Event type | Scope | Limit | Notes |
|-----------|-------|-------|-------|
| `match_report` | Per user | 60/hour | Lenient: players may re-report after typos |
| `tournament_admin` | Per tournament | 30/hour | Admin actions cap per tournament; pairing generation is the bottleneck |
| `tournament_register` | Per IP | 10/hour | Anti-spam during open signups |

Limits are advisory and can be tuned via `wrangler.toml` env vars following the existing pattern (e.g. `MATCH_REPORT_LIMIT_PER_HOUR`).

---

## 12. Schema Migrations

Numbered SQL files under `cloud/migrations/` applied via `wrangler d1 migrations apply`:

```
cloud/migrations/
  0001_initial.sql          — From cloud-rewrite-spec.md §3 (users, games, player_summaries, events, blocked_ips)
  0002_collections.sql      — collections table + games.collection_id (this doc §4)
  0003_tournaments.sql      — All tournament tables (this doc §3)
```

`0002` and `0003` are independent and can ship in either order, but `0002` should land first because the upload-flow integration (auto-assign tournament collection) depends on it.

---

## 13. Open Questions & Future Work

These are intentionally not in the MVP. Listed so they don't get accidentally pulled into the initial implementation.

- **Cross-match tournament analytics** — separate tournament-pages-for-cross-match-analysis doc. The data is there (every match links a `game_id`, every game has `player_summaries` and full R2 blob); the surface is what's deferred.
- **Tags** — evolving Collections from one-collection-per-game to many-collections-per-game. Schema evolution is straightforward; UI implications are larger.
- **Notifications** — email or Discord pushes when a player has a new match, when a round advances, when their match has been reported by their opponent. Pull-only for MVP.
- **Ad-hoc tournament creation by users** — any logged-in user creates a tournament and becomes its first admin. Schema already supports this; the gating decision is product/policy.
- **Multi-occupancy slots / team tournaments** — the slot model assumes a single `current_user_id`; team tournaments would need a slot-membership table.
- **Map-script enforcement** — verifying the uploaded save's `map_class` matches the assigned `map_script`. The data is in the save XML; we're choosing not to enforce in MVP.
- **Disputes** — currently subsumed by admin retro-edit. A formal dispute workflow (player flags a result, opponent responds, admin adjudicates) is future work.
- **Championship retro-edit cascade** — MVP refuses retro-edits to championship matches whose downstream rounds have already started; admin manually unwinds. A safe cascading edit is non-trivial and out of scope.
- **Sonneborn-Berger / cumulative tiebreakers** — the §6 cascade (wins → Median-Buchholz → Solkoff → head-to-head → admin) is sufficient for MVP and matches Challonge's defaults. Additional layers (Sonneborn-Berger, cumulative score, opponents' Solkoff) can be added later if real tournaments expose gaps.

---
