# Per-Ankh Tournament Implementation Notes

Companion to [`tournament-feature-spec.md`](./tournament-feature-spec.md). The
spec describes _what_ the tournament feature does at the goal level; this
file records _what was built_, _what we deferred_, and _what still needs to
happen_ before the feature is production-ready.

## Status

Tournament feature is shipped on the `tournament` branch (commit `8de96ff`
and follow-ups). First-pass code review punch list (32 items) is fully
closed. Second-pass hardening — per-user admin rate limits, anonymous-read
rate limits, Content-Type strictness on JSON endpoints, per-mutation audit
log, plus `requireMatchParticipantOrAdmin` dead-code removal and the
`games.ts → tournament/authz` SQL-dedup refactor — landed in commit
`901276e`. Cloud suite: 136 passing across 17 test files (12 tournament
integration files). Remaining open items below are operational deploy
steps, not code.

## What landed this session

A two-day push from "spec exists" to "feature works end-to-end on local
D1." Functional but with known gaps (next section).

### Schema (D1)

Four migrations applied locally; not yet remote.

- `0006_tournaments.sql` — 5 new tables:
  - `tournaments` — metadata + lifecycle status (`setup`/`swiss`/
    `championship`/`complete`) + admin-configurable swiss/map config
  - `tournament_admins` — per-tournament admin grants (CLI-only writes)
  - `tournament_slots` — stable bracket positions; admin pre-fills with
    Discord usernames, user_id populated on first OAuth login
  - `tournament_rounds` — per-phase, per-division round state machine
  - `tournament_matches` — slot vs slot, with `winner_slot_id`, `game_id`,
    map_script, pick-order winner
- `0007_tournament_match_player_indexes.sql` — adds `slot_a_player_index`
  and `slot_b_player_index` columns to `tournament_matches`. Records which
  roster position in the linked save corresponds to each slot. Enables
  future cross-match analytics that join slot → player_summaries.
- `0008_tournament_match_index.sql` — stable 1-based `match_index` column
  for deterministic championship follow-up pairing. Closed code-review
  item #3 (matches in a round shared `datetime('now')` timestamps to the
  second, so `ORDER BY created_at` was undefined within a round).
- `0009_swiss_seed_not_null.sql` — BEFORE INSERT / BEFORE UPDATE triggers
  on `tournament_slots` enforcing `swiss_seed NOT NULL` for swiss-phase
  rows. Closed code-review item #22 (`compareForPairing` null fallback
  was an untested branch).

### Worker (cloud/)

- `cloud/src/tournament/` package (algorithms + handlers):
  - `types.ts` — in-memory shapes for the pure-function algorithms
  - `rng.ts` — seeded mulberry32 PRNG + shuffle for deterministic
    Swiss-pairing and map-assignment seeds
  - `standings.ts` — wins/losses derived on read from `tournament_matches`
    (no stored W/L on slots); Median-Buchholz + Solkoff computation; rank
    cascade with stable secondary sort by `swiss_seed`
  - `pairing.ts` — Swiss pairing algorithm: round 1 random, round 2+
    bucketed by (wins, losses) with top-half-vs-bottom-half pairing,
    rematch avoidance via in-bucket swap, bucket spillover (odd bucket
    floats one slot down), bye assignment for odd active counts
  - `maps.ts` — auto-map-assignment per match with anti-repeat preference
    (unplayed > min-combined-play-count with alphabetical tiebreak)
  - `bracket.ts` — `largestPowerOfTwoAtMost`, `advanceCountSuggestion`,
    cross-division `buildChampionshipSeeds`, round-1 + follow-up
    `ChampionshipMatchTemplate` builders
  - `data.ts` — D1 row types + shared queries + row → ref adapters
  - `authz.ts` — `requireTournamentAdmin`, `requireMatchParticipantOrAdmin`
    `isTournamentAdmin`, `AuthzError`
  - `public.ts` — 7 anonymous-read handlers (list, detail-by-slug,
    standings, bracket, rounds, matches, match detail) + a new
    `handleGameTournamentLink` for the game-detail page banner
  - `player.ts` — `handleMyTournaments`, `handleMyMatches`,
    `handleDismissBanner` (the `/report` endpoint and its handler were
    dropped — upload is now the report; see "Design notes" below)
  - `admin.ts` — ~12 admin endpoints + the lifecycle state machine. All
    `requireTournamentAdmin`-gated.
- `cloud/src/schemas/tournament.ts` — Valibot validators for every admin
  body
- `cloud/src/games.ts` — extended `handleGameUpload` to accept optional
  `tournament_match_id` + observer-mode slot mappings. The upload itself
  derives the winner from the save data (auto-report), force-publics the
  game, drops it into the user's "Tournament: {name}" collection, and
  links it to the match (first-upload-wins for participants; admin observer
  uploads override).
- `cloud/src/games.ts:handleGamePatch` — `is_public` lockout: refuses
  is_public=false on games linked to an active tournament match
- `cloud/src/auth.ts:handleDiscordCallback` — slot-claim splice between
  user upsert and `createSession`. Two-step lookup: pinned `discord_id`
  first (handles Discord renames), then `discord_username` fallback for
  first-time claims. Closed-beta `ALLOWED_DISCORD_USERNAMES` allowlist
  removed.
- `cloud/src/index.ts` — ~22 new routes, threaded ExecutionContext through
  RouteHandler (was needed for the now-removed Cache API memoization on
  /standings + /bracket; cache removed when it caused stale standings via
  `Cache-Control: max-age=30` leaking to the browser)
- Test runner added: `vitest` + 52 unit tests across the pure-function
  algorithm modules (`*.test.ts` colocated). All pass.

### Frontend (src/)

- `src/routes/tournaments/` — public list, tournament home, match detail,
  admin panel
- `src/lib/tournament/` — TournamentCard, SwissStandings, MatchCard,
  BracketView (cards-by-round; no SVG — see "Deferred decisions" below),
  TournamentBanner, RoundMatches (per-round inline match list with
  pairing/retro-edit affordances), SlotUsernameCell (inline substitution
  editor)
- `src/lib/stores/tournamentNotice.ts` — module-scoped writable store for
  the global enrollment banner
- `src/lib/api-cloud.ts` — added 20+ tournament client methods + types
- `src/lib/BulkUploadModal.svelte` — extended with `tournamentMatchId`,
  `observerMode`, `slotALabel`/`slotBLabel`, and `doneRedirect` props.
  Observer mode swaps the "which player are you?" picker for a single
  slot-A picker; slot B is inferred from the other human in the roster
  (tournament matches require exactly 2 humans).
- `src/routes/upload/+page.svelte` — reads `tournament_match_id`,
  `return_slug`, `observer` query params; resolves slot labels via
  `getTournament` + `getTournamentStandings` for the observer picker;
  passes the match URL as `doneRedirect` so the Done button returns to the
  match page.
- `src/routes/games/[id]/+page.{ts,svelte}` — fetches
  `getGameTournamentLink` (anonymous, cheap) and renders a "Linked to
  match in X" banner via the `preTabs` snippet
- `src/routes/dashboard/+page.{ts,svelte}` — added "My Tournaments"
  section with pending-match counts
- `src/routes/+layout.{ts,svelte}` — fetches `getMyTournaments` after
  `getMe` for signed-in users; mounts `<TournamentBanner />` above
  `<main>` to surface enrollment hits

### CLI

- `scripts/admin/commands/tournament.ts` — `create`, `list`, `show`,
  `grant-admin`, `revoke-admin`, `delete` subcommands. Nested under
  `./per-ankh admin tournament <sub>`.
- `scripts/admin/wrangler.ts` — added `--local` global flag so admin
  subcommands can target `.wrangler/state` D1/R2 during dev.
- `scripts/admin/index.ts` — wired the new subcommand group + the
  `--local` flag.

### Workflow shape (settled during the session)

The biggest design-shape decisions, in case anyone needs to remember why:

- **Upload is the report.** Players upload their save and the worker
  derives `winner_slot_id` from `match_metadata.winner.winner_player_xml_id`
  matched against the slot↔player-index mapping. There's no separate
  "report match" action. The old `ReportMatchModal` was deleted; the
  `POST /matches/:match_id/report` endpoint was deleted.
- **First-upload-wins.** Participant uploads to a pending match → match
  reports. Participant uploads to an already-reported match → save lands
  in their library but match link is unchanged. Admin observer upload is
  the only override path.
- **Auto-advance on match report.** Only two admin gates remain:
  `POST /v1/tournaments/:id/start` (setup → swiss + Round 1 for both
  divisions in one batch, all rounds created `status='in_progress'`)
  and `/transition-championship` (still admin-gated because cascade
  ties at the cutoff may need `override_ranks`, and the admin signals
  end-of-Swiss). Everything else happens through
  `maybeAdvanceAfterMatchReport` in `cloud/src/tournament/admin.ts`,
  invoked from the upload flow (`games.ts` after the match UPDATE)
  and from `handleRetroEditMatch` on pending → non-pending transitions:
  when the round's last pending match is reported, the helper closes
  the round and either spawns the next round in-place (Swiss in the
  same division if `round_number < swiss_max_rounds`, championship if
  the prior round had > 1 match) or auto-completes the tournament
  (championship 1-match final). The `pending` round status dropped
  out of the application flow; rounds go straight to `in_progress`.
  System-triggered audit entries (auto-generation, auto-completion)
  land under `event_type='tournament_system'` with `user_id=NULL`,
  keeping them out of the per-admin rate-limit count.
- **Known retro-edit edge.** `downstreamBlocked` still only blocks on
  _non-pending_ downstream matches, so a retro-edit on a complete
  round is permitted even after auto-advance has spawned the next
  round (all its matches start pending). If the edit flips a winner
  that the next round's pairings were computed from, those pairings
  go stale and admin must fix them via `PATCH /matches/:id/pairing`
  (UI already exposes this). Acceptable for MVP — a regenerate-round
  endpoint is the proper fix if it shows up in practice.
- **Cards, not SVG bracket.** See Deferred Decisions §1.

## Open work

Operational deploy steps only — all code-level open items closed in
`901276e`.

### 1. Remove the `ALLOWED_DISCORD_USERNAMES` prod secret

**Status:** code closed (no grep hits in `cloud/`), operational cleanup
pending. Run after next deploy:

```
cd cloud && npx wrangler secret delete ALLOWED_DISCORD_USERNAMES
```

Not security-load-bearing — just removes confusing dead state from the
prod config.

### 2. Apply migrations to remote D1

Four tournament migrations are applied locally only:
`0006_tournaments.sql`, `0007_tournament_match_player_indexes.sql`,
`0008_tournament_match_index.sql`, `0009_swiss_seed_not_null.sql`. Run
`(cd cloud && npm run migrate:remote)` or `./per-ankh prod migrate` when
ready to deploy. Rehearse on a throwaway D1 first per `CLAUDE.md` policy.

### Historical note: Cache strategy on /standings + /bracket

We previously had Cache API memoization on `/standings` and `/bracket`
(30s TTL) but removed it because the `Cache-Control: max-age` header
was caching client-side and breaking `invalidateAll`. With the
anonymous-read rate limit now in place (`TOURNAMENT_VIEW_PER_HOUR` in
`cloud/src/tournament/limits.ts`), a Worker-side-only cache layer (no
client cache header) is the better long-term shape if read latency
becomes a concern.

## Verified — left as-is

These were originally tracked as "open work" but are audit/verification
items, not pending code. Recorded here as design history; spot-check
before the live tournament.

### Discord ID-based identity flow

When a Discord user renames their handle:

1. Pre-claim: admin set `slot.discord_username = "olduser"`. User changes
   handle to "newuser" before claiming. The username-based claim never
   fires — admin must manually update the slot's `discord_username` field.
   Mitigation: admin can edit slots from the admin panel.
2. Post-claim: `slot.discord_id` is pinned at first claim. Subsequent
   logins match on `discord_id` regardless of username changes. ✓
3. Two users with handles `becked` and `Becked` (Discord disallows case
   collisions globally; but worth not assuming). Our code lowercases
   everywhere. ✓

### Re-import edge case for tournament-linked games

When a player re-uploads the same save (newer parser_version), the
existing re-import path preserves `is_public`, `collection_id`, and
`created_at` on the games row. But the worker's tournament-link block
runs again, which would re-derive winner + re-link the match. With
first-upload-wins, the second attempt's UPDATE would be a no-op (status
already 'reported'). That's correct behavior — sanity-test before live
tournament.

## Deferred decisions

### 1. Championship bracket visualization (cards vs SVG)

**Current**: cards-by-round list (`BracketView.svelte`), no connecting
lines. Each round is its own section; each match is a `MatchCard`.

**Decision history**: we explicitly chose cards for v1 because handling
byes / non-power-of-2 advance counts cleanly in SVG was extra complexity.
Subsequent decision: `advanceCountSuggestion` returns the largest power
of 2 ≤ `floor(min(div_a, div_b) / 2)`, so the championship bracket is
_always_ a clean power of 2. Byes never happen at the championship phase.

**This makes SVG much more tractable than originally feared.** Standard
left-to-right tree, fixed match-card width, vertical spacing per round,
elbow lines between adjacent matches.

**Effort estimate**: 1–2 hours. The main work is geometry + responsive
behavior (mobile probably needs horizontal scroll or a compact fallback).

**Recommendation**: take this on during the polish phase before launch.
Spectators look at the bracket; the cards-only view ships information
but lacks the at-a-glance "where is the final?" affordance.

### 2. Cross-match analytics pages

Spec §13 puts this out of scope. Data is there (slot_a/b_player_index,
linked games, player_summaries) — surface is what's missing. Separate
doc when we get to it.

### 3. Tags evolution of collections

Many-collection-per-game. Schema change is straightforward but defers
to its own pass.

### 4. Notifications

Email or Discord pushes on match pairing / round close / etc. Pull-only
for the first tournament.

### 5. Forfeit / disputes workflow

Admin "Edit" button on the match in the admin panel is the manual
override path — sets `status='forfeit'` and `winner_slot_id` without an
upload. No formal dispute workflow; admin's call.

## Reviews to schedule

We have time. Two passes worth doing before launch:

### Architecture / design review

Things worth a fresh look:

- **Authz centralization**: the `games.ts → tournament/authz` dedup is
  done (`isTournamentAdmin` is now the single source of truth). Bigger
  pattern: are there other places where authz logic is duplicated rather
  than going through `authz.ts`?
- **Cache strategy on read endpoints**: we removed the Cache API
  memoization on standings/bracket. Is per-Worker LRU + no client cache
  header the right shape? Or just keep the simple recompute-every-read
  pattern given tournament scale?
- **The match upload winner-derivation flow**: it's a meaningful
  branching point in `handleGameUpload`. Worth extracting into a
  named helper (`deriveMatchLinkage(blob, tournamentContext, ...)`)
  rather than inlining ~150 lines of branching logic.
- **Schema decisions**: any of the "we decided X, persist it for future
  use" calls worth revisiting? `slot_a/b_player_index` columns vs a
  separate join table for cross-match analytics is one.
- **Component boundaries on the frontend**: `RoundMatches.svelte`
  threads ~15 props through to support pairing-edit + retro-edit state
  in the parent. That's a smell. Could refactor to a per-match
  component that owns its own edit state.

### Cybersecurity review

The Pre-existing [security-review.html](./security-review.html) covered
the cloud rewrite. New surfaces in this branch warrant a fresh pass:

**New attack surface**:

- ~22 new endpoints under `/v1/tournaments/*` and `/v1/users/me/*`
- `POST /v1/games` extended with tournament fields
- `/v1/games/:id/tournament-link` (new anonymous read)
- OAuth callback path got a new D1 write (slot claim) — potential
  injection vector if discord_username isn't properly sanitized at
  insert (we use parameterised queries; should be safe but worth
  re-verifying)

**Specific things to look at**:

1. **Authz bypass paths**: is there _any_ code path that mutates
   `tournament_admins` without going through the CLI? Greppable answer.
   What about `tournament_slots.user_id` — only the slot-claim
   batch in `handleDiscordCallback` writes it; verify no admin endpoint
   can flip another user's slot.
2. **Race in slot claim**: two simultaneous OAuth callbacks from the
   same user (rapid clicks) both run the slot-claim UPDATE. The
   `WHERE user_id IS NULL` guard means only one wins. Verify no
   degenerate case where both succeed and one slot ends up double-claimed.
3. **Cross-tournament leakage**: standings response includes
   `discord_username` per slot. Confirm no PII leak through other
   public endpoints (the existing PII scrubber in `cloud/src/log.ts`
   was audited; the new endpoints inherit it). Discord usernames are
   public-by-design; OK to expose. Verify Discord IDs are NOT exposed
   on any public endpoint (they aren't — only stored internally).
4. **Upload abuse**: signup is gated by the invite-code passphrase
   (commit `a12d6cd`; `cloud/src/auth.ts` validates at OAuth callback,
   per-IP throttle on `invite_code_failed` events). Per-user/per-IP/global
   upload rate limits still apply on top. Account creation is bounded
   by invite-code knowledge + Discord's own anti-abuse. Spam vector
   narrowed; worth confirming the invite-code per-IP throttle is tight
   enough and the per-IP upload limit holds if a code leaks publicly.
5. **Admin retro-edit downstream guard**: for championship matches,
   the guard refuses if _any_ later-round championship match has
   non-pending status. This is the coarser-but-safe variant
   (vs. the bracket-reachability check the plan mentioned). Confirm
   that's still the right call.
6. **The `is_public` lockout window**: tournament-linked games
   force-publish. The lockout means owner can't take them private
   while the tournament is active. After tournament marks 'complete',
   owner can. Make sure there's no race where the tournament transitions
   to 'complete' mid-upload and the lockout misfires.
7. **Slot↔player_index trust**: in admin observer uploads, the admin
   maps slot→player*index. Nothing validates the mapping is \_correct*
   (just that the indexes reference humans). Trust model: admin trusted.
   Same trust as first-report-wins — acceptable per user.
8. **CSP `connect-src`**: we updated the dev detection in
   svelte.config.js (`argv.includes("dev")` vs `argv[2] === "dev"`) to
   make it more robust. Verify prod CSP doesn't include localhost.
9. **The `is_viewer_admin` field on GET /tournaments/:slug**: exposes
   admin status to the requester only (not third parties). Cookie-gated
   via `sessionFromRequest`. Verify the field doesn't leak to
   anonymous readers (it shouldn't — `is_viewer_admin = false` for them).

## Operational checklist for first tournament

In rough order. Most are documented in [`cloud-deploy-plan.md`](./cloud-deploy-plan.md);
this is the tournament-specific addendum.

1. [ ] Apply migrations 0006–0009 to remote D1
       (`(cd cloud && npm run migrate:remote)`) — Open Work §2
2. [ ] Delete `ALLOWED_DISCORD_USERNAMES` prod secret — Open Work §1
3. [ ] Deploy worker + frontend (`./per-ankh prod deploy`)
4. [ ] Land timezone-capture issue #48 (helpful for admin's division
       assignments but not blocking)
5. [ ] Land issue #43 (account deletion + data export) — separate from
       tournament work; less urgent now that invite-code gating bounds
       account creation
6. [ ] Walk a 4-slot mock tournament end-to-end on prod before opening
       signups (use throwaway Discord accounts)
7. [ ] Decide on the bracket viz (Deferred §1)
8. [ ] Create the tournament via CLI:
       `./per-ankh admin tournament create <slug> "<name>" --maps "..."`
9. [ ] Grant admin to 4 operators
10. [ ] Admin pre-fills slots via the web admin panel
11. [ ] Announce to players; they sign in to claim
12. [ ] Click **Start Tournament** in the admin panel; players upload
        saves to report results; Swiss rounds spawn automatically as
        prior rounds fill in. When the final round of every division
        is reported, the admin panel exposes **Transition to
        Championship**. Championship rounds also auto-spawn; the
        tournament auto-completes when the final match reports.
