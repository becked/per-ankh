# Tournament Branch Code Review

Companion to [`tournament-feature-spec.md`](./tournament-feature-spec.md) and
[`tournament-implementation-notes.md`](./tournament-implementation-notes.md).
Review of the first-pass tournament implementation on the `tournament`
branch (commit `8de96ff`). Conducted 2026-05-13.

This is a working punch list — check items off as they land. Findings the
implementation notes' §Open work already tracks are NOT repeated here.
Items below are organized by severity and reference `file:line` for direct
navigation.

Methodology: 5 parallel subagents each scoped to one area (algorithms +
schema, worker handlers, frontend routes, frontend components, CLI +
config). Every reported finding was then re-verified against the actual
code by hand — false positives were dropped, agent claims were corrected
where wrong, and items already in §Open work were removed to avoid noise.

**Status as of 2026-05-14:**

- **Authz + data-integrity bundle closed** in `56923f4` — items #1, #2,
  #3, #4, #5, #7, #8, #10. All 5 Critical items are now resolved.
- **Integration test harness landed** in `f6e4ecc` — 39 tests under
  `cloud/test/integration/tournament/` exercise the closed items and
  pin them load-bearing. Closes the "handler-level integration coverage
  is absent" gap.
- **Remaining open:** items #6, #9, #11–#19 (Important), #20–#32
  (Nice-to-have). Per-item Status lines below mark what's closed.

## Critical

Real bugs that should land before the first live tournament.

### 1. `handlePatchPairing` doesn't verify the match belongs to the URL tournament

**Status:** Fixed in `56923f4`. Test: `patch-pairing.test.ts` › "rejects a
patch when the match belongs to a different tournament". Cross-tournament
check placed before the status check so `MATCH_NOT_PENDING` doesn't leak
existence.

`cloud/src/tournament/admin.ts:732-735` calls `loadMatch(env, matchId)` and
proceeds without checking that the match's round belongs to `tournamentId`.
Compare to `handleRetroEditMatch` at `cloud/src/tournament/admin.ts:826-829`,
which does this correctly. An admin of tournament A who knows a match_id
from tournament B can `PATCH /v1/tournaments/<A>/matches/<B_match>/pairing`
and mutate B's match — the admin gate at line 78 only verifies admin-of-A.

### 2. `handlePatchPairing` writes slot IDs without validating they belong to the tournament/division

**Status:** Fixed in `56923f4`. Tests: `patch-pairing.test.ts` › "rejects
{slot_a_id,slot_b_id,pick_order_winner_slot_id} when the slot belongs to a
different tournament" (parameterized), "rejects slot_a_id from the wrong
division (same tournament)", "rejects pick_order_winner_slot_id that isn't
slot_a or slot_b after the patch". New `loadSlotInTournament` helper in
`data.ts` is reused by #8 and #10.

`cloud/src/tournament/admin.ts:744-761` + `cloud/src/schemas/tournament.ts:94-101`.
The Valibot schema only enforces nanoid21 format. Combined with #1, an admin
can splice a slot from any tournament into any pending match. The schema
also allows `slot_b_id: null`, which writes a non-bye match with a null
opponent (status stays `pending`, winner stays NULL) — see #7 below.

### 3. Championship follow-up pairings are non-deterministic

**Status:** Fixed in `56923f4`. Migration `0008_tournament_match_index.sql`
adds a 1-based `match_index` column, set at all three INSERT sites (swiss,
championship round 1, championship follow-up). `loadMatches` and
`loadMatchesWithRound` ORDER BY include `m.match_index`; redundant
`created_at.localeCompare` re-sort removed. Tests:
`generate-round.test.ts` › "populates match_index 1..N" (×3),
"…returns matches in match_index order…", "produces identical match
ordering across two reads".

`cloud/src/tournament/admin.ts:631-633` sorts prior matches by
`created_at.localeCompare`, but every match in a round is inserted in a
single D1 `batch` with `datetime('now')` (seconds resolution) — all rows
share an identical timestamp. SQLite `ORDER BY` with equal keys returns
rows in undefined order; even with V8's stable sort, the input order from
`loadMatches` (`cloud/src/tournament/data.ts:128-135`) inherits the same
SQLite ambiguity.

`buildChampionshipFollowupRound` then pairs `priorMatches[0]` vs `[1]`,
`[2]` vs `[3]`, so a different order on a different read produces
different semifinal/final brackets. Needs a `match_index` column or an
ordering derived from championship_seed.

### 4. `MatchRow` type is missing the columns added by migration 0007

**Status:** Fixed in `56923f4`. `MatchRow` declares both columns;
`loadMatchesWithRound`'s explicit projection includes them so the type
stays honest. No runtime test (pure type fix) — caught by `tsc --noEmit`.

`cloud/src/tournament/data.ts:60-74` doesn't declare `slot_a_player_index`
or `slot_b_player_index`, but `loadMatches`/`loadMatch` do `SELECT m.*` so
the columns are present at runtime. `cloud/src/games.ts:1316-1370` writes
them via UPDATE. TypeScript can't catch a reader that misuses these
fields. A `cloud` package typecheck script (see #30) would have caught it.

### 5. `MyMatchEntry extends TournamentMatch` overpromises

**Status:** Fixed in `56923f4`. `MyMatchEntry` is now hand-rolled to match
the `handleMyMatches` SELECT exactly. Test: `my-matches.test.ts` › "exposes
exactly the fields handleMyMatches selects (no more, no less)" — strict
key-set comparison fails loudly if the SELECT ever drifts.

`src/lib/api-cloud.ts:799-804` makes every `TournamentMatch` field
non-optional, but the worker at `cloud/src/tournament/player.ts:57-69`
only SELECTs `match_id, round_id, slot_a_id, slot_b_id, map_script,
status, winner_slot_id, game_id, reported_at`. Fields
`pick_order_winner_slot_id`, `reported_by_user_id`, `notes` will be
`undefined` at runtime under a non-optional type.

## Important

### 6. Inline `tournament_admins` SQL in a third site

The implementation notes call out `cloud/src/games.ts:894-901`. A third
copy lives at `cloud/src/tournament/public.ts:108-113` (the
`is_viewer_admin` check). Should funnel through `isTournamentAdmin()`
from `cloud/src/tournament/authz.ts`.

### 7. `PatchPairingSchema` allows nulling `slot_b_id` without status/winner updates

**Status:** Fixed in `56923f4`. `v.nullable` dropped from `slot_b_id`.
Rationale (also in the schema comment): byes are an artifact of pairing
generation, not a post-hoc admin edit — nulling here would bypass the
"no slot gets two byes" invariant *and* drop the displaced slot from the
round. Test: `patch-pairing.test.ts` › "rejects null slot_b_id at schema
validation".

`cloud/src/schemas/tournament.ts:96`. The handler at
`cloud/src/tournament/admin.ts:744-761` just writes the patch fields
verbatim — no companion `status='bye'` + `winner_slot_id=slot_a_id`
update. Result: an inconsistent match (pending status, no opponent, no
winner) that breaks downstream pairing/standings.

### 8. `PatchMatchSchema` doesn't validate `winner_slot_id ∈ {slot_a_id, slot_b_id}`

**Status:** Fixed in `56923f4`. Schema unchanged (still allows null for
clearing); handler-level check added in `handleRetroEditMatch` with
defense-in-depth slot load via `loadSlotInTournament`. Tests:
`retro-edit.test.ts` › "rejects a winner_slot_id outside the match's two
slots", "rejects a winner_slot_id from a different tournament".

`cloud/src/schemas/tournament.ts:110-117`. Admin can mark a match as won
by an arbitrary nanoid; the worker writes it. Standings then compute
against a stranger.

### 9. `handleStartSwiss` doesn't bound `swiss_advance_count` by division size

`cloud/src/tournament/admin.ts:441-450` only checks `advanceCount < 1`.
An admin who sets `swiss_advance_count=8` in setup with `divA=4`/`divB=4`
will start swiss, play 3 rounds, then hit `INSUFFICIENT_ADVANCERS` at
line 976-983. Fail-fast belongs in start-swiss with
`advanceCount <= floor(min(divA, divB) / 2)`.

### 10. `transition-championship` override branch doesn't validate slot IDs

**Status:** Fixed in `56923f4`. Override branch now validates each
advancer in-memory against the already-loaded `slots` array (no extra DB
roundtrips): in-tournament, swiss-phase, correct division. Specific 4xx
codes replace the eventual 500 `SOURCE_SLOT_MISSING`. Tests:
`transition-championship.test.ts` › "rejects an override slot from a
different tournament", "…from the wrong division (same tournament)",
"…that's not swiss-phase" (uses direct SQL to construct the unreachable
defensive state).

`cloud/src/tournament/admin.ts:952-963`. `ids.slice(0, advance_count)`
is taken on faith. The eventual catch is `slots.find(...)` at line 1025
→ 500 `SOURCE_SLOT_MISSING`, but that fires partway through batch
construction. Validate up-front that every override id exists, belongs
to this tournament, and matches the named division.

### 11. `patchTournament` body type is `Partial<TournamentDetail>`

`src/lib/api-cloud.ts:486-499`. TypeScript happily lets callers pass
`is_viewer_admin`, `slot_counts`, `tournament_id`, `slug`, `created_at`,
`updated_at` — none of which the PATCH endpoint accepts. Define a
dedicated `PatchTournamentBody` shape.

### 12. `getTournamentMatches` client type omits `slot_id` param

`src/lib/api-cloud.ts:420-436`. The worker
(`cloud/src/tournament/public.ts:328`) reads it. Either add to the type
or document the omission.

### 13. `pairingMapInput || undefined` can't clear an existing pairing's map

`src/routes/tournaments/[slug]/admin/+page.svelte:316`. Empty input
sends `{}` (field omitted); the worker treats that as "no change".
`PatchPairingSchema` (`cloud/src/schemas/tournament.ts:97`) is
`v.optional(MapScriptSchema)`, not nullable — so even an explicit null
would be rejected. Admin has no way to clear a stuck map. Fix needs
both schema (accept null) and the frontend payload.

### 14. Retro-edit winner picker has no null option

`src/lib/tournament/RoundMatches.svelte:165-179`. The `<select>` only
offers slot_a and slot_b. Setting `status='pending'` should send
`winner_slot_id=null`, but the picker has no way to express that —
`saveRetroEdit` (`src/routes/tournaments/[slug]/admin/+page.svelte:334-344`)
ships whichever slot was last selected.

### 15. `MatchCard` winner highlight is a no-op

`src/lib/tournament/MatchCard.svelte:45,55`. `class:bg-opacity-100={...}`
toggles a Tailwind utility that requires a Tailwind bg class, but the
cell's background is set via inline `style="background-color: #35302B;"`.
The intended highlight doesn't render. (The text "Winner" still does,
so the visual still works.)

### 16. `saveSettings` lets you submit an empty name

`src/routes/tournaments/[slug]/admin/+page.svelte:148-167`. No
client-side validation; relies on worker rejection. Trivial fix:
`disabled={busy || !editName.trim() || !editDivAName.trim() ||
!editDivBName.trim()}` on the Save button.

### 17. BulkUploadModal observer mode silently auto-picks slot B on 3+-human saves

`src/lib/BulkUploadModal.svelte:234-238` uses `find()` for "the other
human" — for 3+ humans it grabs the first one. The error banner at
lines 555-560 only renders when `slotBPlayerIndex` is null (1-human
case). Server-side `WRONG_HUMAN_COUNT` check
(`cloud/src/games.ts`, tournament block) catches it, but the UI lets
you waste an upload.

### 18. `slotInfo` in admin/+page.svelte builds 4 unused fields per slot

`src/routes/tournaments/[slug]/admin/+page.svelte:21-53`. Only
`username` is consumed (via `slotLabel`). `swiss_seed` is hardcoded to
`null` and never read. Either trim to a `Record<string, string>` or
actually populate `swiss_seed`.

### 19. `SlotUsernameCell` UX rough edges

`src/lib/tournament/SlotUsernameCell.svelte`:

- No autofocus on edit toggle (lines 30-37).
- No Enter-to-save / Esc-to-cancel keyboard handling.
- Empty input silently exits edit mode with no feedback (lines 20-27).

## Nice-to-have

### 20. Pairing test claims to exercise rematch swap but doesn't

`cloud/src/tournament/pairing.test.ts:92-126`. After round 1
A=(1,0) B=(0,1) end up in different buckets, so the assertion
`not.toContain(unorderedPair("A", "B"))` is trivially true regardless
of `pairBucket`'s swap branch
(`cloud/src/tournament/pairing.ts:175-189`). The swap branch is
uncovered — needs a test where all four slots share a bucket and a
forced rematch is avoidable via swap.

### 21. `parseAllowedMaps` returns `[]` on parse failure; downstream throws a 500

`cloud/src/tournament/data.ts:222-232` swallows JSON errors and returns
`[]`. Three callers (`admin.ts:557,684,1061`) hand the result to
`assignMap`, which throws `"allowedMaps must be non-empty"`
(`cloud/src/tournament/maps.ts:50-52`). Result: corrupted-JSON cell →
500 with misleading message instead of a 4xx. Either tighten
`parseAllowedMaps` to throw, or add a check at each call site.

### 22. `compareForPairing` null `swiss_seed` fallback to 0

`cloud/src/tournament/pairing.ts:121`. Schema allows null for
swiss-phase slots (`cloud/migrations/0006_tournaments.sql:93`); tests
always set sequential seeds. Untested branch. Consider making
`swiss_seed NOT NULL` for swiss-phase slots.

### 23. `handleMyMatches` JOIN with `OR` can duplicate rows

`cloud/src/tournament/player.ts:66`. If a user owns both slots in a
match (edge case but not schema-prevented), the row appears twice.
`SELECT DISTINCT` or a `UNION` would fix it cheaply.

### 24. `handleDismissBanner` returns 200 on unknown tournament

`cloud/src/tournament/player.ts:76-93`. Returns `{dismissed: 0}` with
200 instead of 404. Inconsistent with the rest of the API.

### 25. `transition-championship` cascade-tie returns non-standard error shape

`cloud/src/tournament/admin.ts:986-1003` uses `jsonResponse` (with
extra `division`, `tied_slot_ids`, `ranked` fields) instead of
`errorResponse`. Frontend depends on the payload, but it diverges from
every other 409. Consider extending `errorResponse` to allow extra
payload fields, or document the convention break.

### 26. Empty `if` block at `admin.ts:272-274`

Just a comment, no code. Cleanup pass. The intent (advance
`nextSeedByDiv` past explicit-seed entries to avoid collision in a
mixed batch) isn't implemented, but the
`UNIQUE (tournament_id, phase, division, swiss_seed)` constraint
would catch it anyway.

### 27. CLI `delete` confirms with "nuke"

`scripts/admin/commands/tournament.ts:386` uses `confirmNuke` for a
`delete` subcommand. Operators will type the wrong verb. Either rename
the helper or add a tournament-specific confirm.

### 28. `grant-admin`/`revoke-admin`/`delete` ignore `--json`

`scripts/admin/commands/tournament.ts:320,350,369`. `create`/`list`/
`show` honor it. `scripts/admin/index.ts:59` advertises `--json` as
global.

### 29. `runList` silently drops invalid `--status`

`scripts/admin/commands/tournament.ts:182-186`. Compare to
`scripts/admin/commands/users.ts:88-92` which throws on invalid sort.

### 30. No `typecheck` script for the cloud package

`cloud/package.json` runs vitest but not `tsc --noEmit`. Vitest doesn't
typecheck by default. Would catch #4. Add `"typecheck": "tsc --noEmit"`
and wire it into the preflight check.

### 31. `TournamentBanner` optimistic dismiss doesn't rollback on POST failure

`src/lib/tournament/TournamentBanner.svelte:20-31`. The banner stays
dismissed in the store but the next `invalidateAll` repopulates from
server state, so it reappears. The in-file comment claims this is OK
"until next hard reload" but it's actually next nav. Either accept and
update the comment, or restore on failure.

### 32. Dashboard tournament fetches swallow `UnauthorizedError`

`src/routes/dashboard/+page.ts:18-19`. Other parallel fetches handle
it, so the redirect still fires today — but masks a real auth failure
if those other fetches ever change. Filter the swallow to non-401 only.

## False positives caught during verification

Worth recording so they don't get re-raised:

- **`svelte.config.js:36` "substring matching" of `"dev"`** — agent
  claimed `argv.includes("dev")` matches by substring. False:
  `Array.includes` is element equality. The new code is strictly more
  robust than the old `argv[2] === "dev"`, exactly as the in-file
  comment explains. The agent appears to have misread the comment.

- **`admin/+page.svelte:583` `{#each ["A","B"] as Division[] as div}`
  parsing** — parses correctly as `{#each (["A","B"] as Division[]) as
  div}` via Svelte's expression parser. Compiles cleanly. Style nit
  at most.

- **Cross-tournament check in `handleStartRound`/`handleGenerateRound`
  championship branch** — agent flagged then struck themselves; both
  paths correctly scope via `round.tournament_id !== tournamentId` or
  `loadRounds(env, tournament.tournament_id)`.

## Already in implementation notes — not re-raised

§Open work in `tournament-implementation-notes.md` already tracks:

- Rate limits on tournament admin and read endpoints
- Audit log gaps (substitution events exist; most other admin actions
  don't log)
- `ALLOWED_DISCORD_USERNAMES` prod secret cleanup
- Remote migration apply (0006 + 0007)
- CSRF / Content-Type hardening on new endpoints
- Dead `requireMatchParticipantOrAdmin`
- The original inline-SQL note for `games.ts` (items #6 + #18 here
  extend that finding)
- The `RoundMatches` prop-count smell (item #14 here is a different
  concrete bug in the same component)
- The bracket-viz cards-vs-SVG decision
- The cache strategy revisit on standings/bracket
- Re-import edge case for tournament-linked games

## Suggested order of fixes

1. ~~**Authz + data integrity bundle**: 1, 2, 3, 7, 8, 10.~~ **Done in
   `56923f4`** (expanded to include #4 and #5 since they were Critical
   and the diff was already touching the same files).
2. **Type-safety bundle**: ~~4, 5~~, 11, 12, 30. Cheap, mechanical fixes.
   Add the typecheck script first so the rest get checked. (Items #4
   and #5 already landed with bundle 1.)
3. **UX-blocking bundle**: 9, 13, 14, 16. Things that make the admin
   panel functional during a live tournament.
4. **Polish bundle**: everything else, prioritized as time permits
   before launch.

## Operational note

This review is point-in-time. Re-run on substantive code changes —
especially before the migration to remote D1 and the first live
tournament. The verification step (item-by-item reading of cited
file:line against current code) caught two false positives in the
subagent reports, so don't skip it.

The integration test harness added in `f6e4ecc`
(`cloud/test/integration/tournament/`) now covers the closed items.
Each fix was verified load-bearing — reverted, the matching test fails
with the expected error. Future reviews should run `npm test` first;
any new finding that lacks a test claiming to catch it is a candidate
for the harness rather than (just) the punch list.
