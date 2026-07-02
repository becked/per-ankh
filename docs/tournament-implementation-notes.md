# Per-Ankh Tournament Implementation Notes

> **⚠️ Partially stale (as of 2026-06-30).** The **Status**, **Open Work**, and **Operational checklist** sections are pre-launch and superseded — the feature is live and there are 28 migrations (not the 8 local-only this doc describes). The “What landed” and “Workflow shape” content is still accurate. See `docs/doc-audit-2026-06-30.md`.

Companion to [`tournament-feature-spec.md`](./archive/tournament-feature-spec.md). The
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
`901276e`. Post-hardening UX work: auto-advance rounds (`ad25f08`), SVG
bracket + W-L flow viz (`336c5af`, `a242f8a`), admin/match routes
collapsed into modal-driven public page (`5972110`), admin result entry
on pending matches (`c1d9baf`), match status rename `reported → complete`
(`0ec0c75` + migration `0010`), admin-configurable per-script map options
(`535cf38` + migration `0011`), the private-beta allowlist that originally
gated every tournament surface (`457e406` + migration `0012`, since opened
to the public in `5e19cb4` — now gates creation only), and the matching
`LINKED_TO_ACTIVE_TOURNAMENT` lockout + post-completion SET NULL trigger
on `handleGameDelete` (migration `0013`). Remaining open items below are
operational deploy steps, not code.

## What landed this session

A two-day push from "spec exists" to "feature works end-to-end on local
D1." Functional but with known gaps (next section).

### Schema (D1)

Eight migrations applied locally; not yet remote.

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
- `0010_match_status_complete.sql` — rename match status `'reported'` →
  `'complete'`. The original name described the trigger (`/report`
  endpoint) and stopped fitting once admins could record results without
  a save and the `/report` endpoint was removed. `'complete'` also
  aligns with `tournament_rounds` and `tournaments` terminal status.
- `0011_tournament_map_script_options.sql` — adds
  `tournaments.map_script_options` (JSON, defaults to `'{}'`). Holds
  admin-configured per-script overrides for `MAP_OPTIONS_*` values; the
  auto-map-assignment block reads these instead of the XML `<Default>`
  when present. Backwards compatible: an empty object means "use XML
  defaults," which is what every existing tournament does.
- `0012_tournament_beta_users.sql` — adds `tournament_beta_users` (PK
  `discord_id`, optional `user_id` filled in at login). Originally backed
  the `requireTournamentBeta` gate that hid the entire tournament product
  from non-beta callers (404, not 403); since `5e19cb4` the feature is
  public and this allowlist gates tournament *creation* only
  (`isTournamentBeta` → 403 `TOURNAMENT_CREATE_FORBIDDEN`).
  Operator-managed only via
  `./per-ankh admin tournament beta-{grant,revoke,list}`. Claim flow
  mirrors `tournament_slots`: operator pre-inserts by `discord_id`, login
  pins `user_id` so later checks use the fast PK lookup.
- `0013_tournament_match_game_set_null.sql` — BEFORE DELETE trigger on
  `games` that nulls `tournament_matches.game_id`. Pairs with the new
  `LINKED_TO_ACTIVE_TOURNAMENT` 409 on `handleGameDelete`: during an
  active tournament the worker refuses the delete; after the tournament
  marks complete the trigger lets the delete proceed cleanly, dropping
  the match→game link but preserving `winner_slot_id` and `status`.
  Triggers were chosen over the ALTER-via-create-new-table dance for the
  same reason as `0009` (low write rate, less failure-prone than
  toggling `PRAGMA foreign_keys`).

### Worker (cloud/)

- `cloud/src/tournament/` package (algorithms + handlers):
  - `types.ts` — in-memory shapes for the pure-function algorithms
  - `rng.ts` — seeded mulberry32 PRNG + shuffle for deterministic
    map-assignment seeds
  - `standings.ts` — wins/losses derived on read from `tournament_matches`
    (no stored W/L on slots); Median-Buchholz + Solkoff computation; rank
    cascade with stable secondary sort by `swiss_seed`
  - `pairing.ts` — Swiss pairing algorithm: round 1 fold-paired by
    swiss_seed, round 2+
    bucketed by (wins, losses) with top-half-vs-bottom-half pairing,
    rematch avoidance via in-bucket swap, bucket spillover (odd bucket
    floats one slot down), bye assignment for odd active counts
  - `maps.ts` — auto-map-assignment per match with anti-repeat preference
    (unplayed > min-combined-play-count with alphabetical tiebreak)
  - `bracket.ts` — `largestPowerOfTwoAtLeast`, `standardBracketPairs`
    (recursive 1-vs-N seeding), `buildChampionshipRound1` (variable
    qualifier counts with byes for top seeds), `buildChampionshipFollowupRound`
    (adjacent-winner pairing for R2+)
  - `data.ts` — D1 row types + shared queries + row → ref adapters
  - `authz.ts` — `requireTournamentAdmin`, `requireMatchParticipantOrAdmin`
    `isTournamentAdmin`, `AuthzError`
  - `public.ts` — 7 anonymous-read handlers (list, detail-by-slug,
    standings, bracket, rounds, matches, match detail) + a new
    `handleGameTournamentLink` for the game-detail page banner
  - `player.ts` — `handleMyTournaments`, `handleMyAdminTournaments`,
    `handleMyMatches`, `handleDismissBanner` (the `/report` endpoint
    and its handler were dropped — upload is now the report; see
    "Design notes" below)
  - `admin.ts` — 8 admin handlers + the lifecycle state machine
    (`handlePatchTournament`, `handleBulkCreateSlots`, `handlePatchSlot`,
    `handleDeleteSlot`, `handleStartTournament`, `handlePatchMatchMap`,
    `handleRetroEditMatch`, `handleTransitionChampionship`). All
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

- `src/routes/tournaments/` — public list (`+page.svelte`) and tournament
  home (`[slug]/+page.svelte`). Match detail and admin surfaces were
  initially separate routes; commit `5972110` collapsed them into the
  public page driven by `MatchModal` and `TournamentSettingsModal`. No
  nested `/admin/` or `/matches/[match_id]/` routes.
- `src/lib/tournament/` — `TournamentCard`, `SwissStandings`,
  `SwissFlowBracket` (per-division W-L bracket SVG, replacing the old
  cards-by-round list), `ChampionshipBracketTree` (single-elim SVG with
  elbow connectors), `MatchModal` (per-match view + admin-gated
  retro-edit and pairing-edit affordances), `TournamentSettingsModal`
  (admin tournament/slot management), `TournamentBanner` (global
  enrollment / pending-match nag), `SlotUsernameCell` (inline
  substitution editor), `map-scripts.ts` (shared map-script labels)
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
  flips to `'complete'` with `winner_slot_id` derived from the save.
  Participant uploads to an already-completed match → save lands in
  their library but match link is unchanged. Admin observer upload is
  the only override path. Admins can also record a result on a pending
  match from `MatchModal` without any save upload (forfeit or
  played-but-no-save) — commit `c1d9baf`.
- **Auto-advance on match report.** Only two admin gates remain:
  `POST /v1/tournaments/:id/start` (setup → swiss + Round 1 for both
  divisions in one batch, all rounds created `status='in_progress'`)
  and `/transition-championship` (still admin-gated because cascade
  ties at the cutoff may need `override_ranks`, and the admin signals
  end-of-Swiss). Everything else happens through
  `maybeAdvanceAfterMatchReport` in `cloud/src/tournament/admin.ts`,
  invoked from the upload flow (`games.ts` after the match UPDATE)
  and from `handleRetroEditMatch` on pending → non-pending transitions:
  when the round's last pending match flips to a terminal status
  (`complete` / `forfeit` / `bye`), the helper closes the round and
  either spawns the next round in-place (Swiss in the
  same division if `round_number < swiss_max_rounds`, championship if
  the prior round had > 1 match) or auto-completes the tournament
  (championship 1-match final). The `pending` round status dropped
  out of the application flow; rounds go straight to `in_progress`.
  System-triggered audit entries (auto-generation, auto-completion)
  land under `event_type='tournament_system'` with `user_id=NULL`,
  keeping them out of the per-admin rate-limit count.
- **Transition validates before mutating (#50).** `handleTransitionChampionship` parses the request body (`TransitionChampionshipSchema`) before it auto-closes any in-progress Swiss rounds via `autoCloseRoundIfReady`, so a malformed body is rejected (400) before any round state is written. Authz runs before both; valid requests (`{}` or `{override_ranks:[...]}` — all the UI sends) are unaffected, since a successful parse has no side effects.
- **User deletion must clear tournament FKs.** `tournament_admins`, `tournament_slots.user_id`, `tournament_matches.reported_by_user_id`, and `tournament_beta_users.user_id`/`granted_by_user_id` reference `users(user_id)` with **no `ON DELETE CASCADE`**, so a bare `DELETE FROM users` hits an FK error for anyone who ever touched a tournament. `nuke-user` (`scripts/admin/commands/security.ts`) clears these first — deleting the NOT NULL / own-row references and nulling the nullable ones. The `slot_a/b_user_id` and `caster_user_id` snapshot columns (migrations 0024/0025) are plain TEXT with no FK and are left intact.
- **Known retro-edit edge.** `downstreamBlocked` still only blocks on
  _non-pending_ downstream matches, so a retro-edit on a complete
  round is permitted even after auto-advance has spawned the next
  round (all its matches start pending). If the edit flips a winner
  that the next round's pairings were computed from, those pairings
  go stale and admin must fix them via `PATCH /matches/:id/pairing`
  (UI already exposes this). Acceptable for MVP — a regenerate-round
  endpoint is the proper fix if it shows up in practice.

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

Eight tournament migrations are applied locally only:
`0006_tournaments.sql`, `0007_tournament_match_player_indexes.sql`,
`0008_tournament_match_index.sql`, `0009_swiss_seed_not_null.sql`,
`0010_match_status_complete.sql`,
`0011_tournament_map_script_options.sql`,
`0012_tournament_beta_users.sql`,
`0013_tournament_match_game_set_null.sql`. Run
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
   Mitigation: admin uses the inline slot list on the tournament home
   page (`SlotUsernameCell`) to substitute the new handle.
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
already `'complete'`). That's correct behavior — sanity-test before live
tournament.

## Deferred decisions

### 1. ~~Championship bracket visualization (cards vs SVG)~~ — shipped

Closed: `ChampionshipBracketTree.svelte` is a left-to-right SVG tree
with elbow connectors (commit `336c5af`). Swiss phase got
`SwissFlowBracket.svelte` instead of standings tables at the same time.
Power-of-2 advance count means no bye geometry to worry about.
Subsequent polish in `a242f8a` tightened the round-column min-width.

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

The admin controls inside `MatchModal` are the manual override path —
admin sets `status='forfeit'` (or `'complete'`) and `winner_slot_id`
without an upload, on either a pending or already-completed match. No
formal dispute workflow; admin's call.

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
- **Component boundaries on the frontend**: the modal-driven refactor
  (`5972110`) moved per-match pairing/retro-edit state into
  `MatchModal.svelte`, which owns its own edit state. The earlier
  `RoundMatches.svelte` prop-threading smell is gone. Worth re-auditing
  whether `[slug]/+page.svelte` is now doing too much top-level
  orchestration that should push into the bracket components.

### Cybersecurity review

The pre-existing cloud-rewrite security review (since removed from the public
repo; open findings now tracked in private security advisories) covered the core
app. New surfaces in this branch warrant a fresh pass:

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
4. **Upload abuse**: sign-up is open — anyone who completes Discord OAuth
   gets an account (the `INVITE_CODE` passphrase that once gated sign-up was
   removed at release). Account creation is bounded only by Discord's own
   anti-abuse; the real backstop is the per-user/per-IP/global upload rate
   limits, which apply regardless of how the account was created. Spam vector:
   confirm the per-IP upload limit holds against many fresh accounts from one
   source.
5. **Admin retro-edit downstream guard**: for championship matches,
   the guard refuses if _any_ later-round championship match has
   non-pending status. This is the coarser-but-safe variant
   (vs. the bracket-reachability check the plan mentioned). Confirm
   that's still the right call.
6. **The `is_public` and delete lockouts**: tournament-linked games
   force-publish. The patch-side lockout means owner can't take them
   private while the tournament is active. The delete-side lockout
   (`LINKED_TO_ACTIVE_TOURNAMENT` on `handleGameDelete`, plus migration
   `0013`'s BEFORE DELETE trigger on `games`) means owner also can't
   delete the save mid-tournament; after `t.status='complete'` the
   trigger nulls the match's `game_id` and the delete proceeds.
   Verify both behave symmetrically and that there's no race where the
   tournament transitions to `'complete'` mid-upload/-delete and either
   lockout misfires.
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

1. [ ] Apply migrations 0006–0010 to remote D1
       (`(cd cloud && npm run migrate:remote)`) — Open Work §2
2. [ ] Delete `ALLOWED_DISCORD_USERNAMES` prod secret — Open Work §1
3. [ ] Deploy worker + frontend (`./per-ankh prod deploy`)
4. [ ] Land timezone-capture issue #48 (helpful for admin's division
       assignments but not blocking)
5. [ ] Land issue #43 (account deletion + data export) — separate from
       tournament work
6. [ ] Walk a 4-slot mock tournament end-to-end on prod before opening
       signups (use throwaway Discord accounts)
7. [ ] Create the tournament via CLI:
       `./per-ankh admin tournament create <slug> "<name>" --maps "..."`
8. [ ] Grant admin to 4 operators
9. [ ] Admin pre-fills slots via `TournamentSettingsModal` on the
       tournament home page
10. [ ] Announce to players; they sign in to claim
11. [ ] Click **Start Tournament** from the settings modal; players
        upload saves to complete matches; Swiss rounds spawn
        automatically as prior rounds fill in. When the final round of
        every division is complete, the settings modal exposes
        **Transition to Championship**. Championship rounds also
        auto-spawn; the tournament auto-completes when the final match
        completes.
