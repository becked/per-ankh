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

**Status as of 2026-05-15:**

- **Authz + data-integrity bundle closed** in `56923f4` — items #1, #2,
  #3, #4, #5, #7, #8, #10. All 5 Critical items resolved.
- **Integration test harness landed** in `f6e4ecc` — 39 tests under
  `cloud/test/integration/tournament/` exercise the closed items and
  pin them load-bearing. Closes the "handler-level integration coverage
  is absent" gap.
- **All remaining items closed** across seven follow-up commits:
  - `#22` swiss_seed NOT NULL trigger migration
  - `#6, #9, #14, #21, #23, #24, #25, #26` worker invariants + error
    shape, with 9 new integration tests
  - `#13, #14 UI, #15, #16, #18, #19, #31, #32` UI bug bundle
  - `#17` bulk upload observer mode for 3+ humans
  - `#11, #12, #30` client type narrowing + cloud typecheck script
  - `#27, #28, #29` admin CLI polish
  - `#20` real rematch-swap pairing test (verified load-bearing —
    reverting the swap loop in `pairing.ts:170-189` fails the new test)
  - Full cloud test suite: 100 tests passing.

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

**Status:** Fixed in `2303253`. `handleTournamentDetail` calls
`isTournamentAdmin()` from `./authz` directly (the helper already
handles null sessions). Pure refactor — no test added.

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

**Status:** Fixed in `2303253`. Bound is `<= min(divA, divB)`, not the
reviewer's `floor(.../2)` — eliminations don't shrink the ranked pool
because `computeStandings` ranks every slot regardless of
active/eliminated status, so the cap is just the per-division size.
Test: `flow.test.ts` › "rejects start-swiss when swiss_advance_count
exceeds the smaller division's size (#9)".

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

**Status:** Fixed in `5c73729`. New `PatchTournamentBody` interface
mirrors `PatchTournamentSchema` field-for-field. Type-hygiene only —
Valibot's `v.object` strips unknown keys server-side, so this is not a
security boundary. No runtime test (pure type change).

`src/lib/api-cloud.ts:486-499`. TypeScript happily lets callers pass
`is_viewer_admin`, `slot_counts`, `tournament_id`, `slug`, `created_at`,
`updated_at` — none of which the PATCH endpoint accepts. Define a
dedicated `PatchTournamentBody` shape.

### 12. `getTournamentMatches` client type omits `slot_id` param

**Status:** Fixed in `5c73729`. `slot_id?: string` added to the params
type.

`src/lib/api-cloud.ts:420-436`. The worker
(`cloud/src/tournament/public.ts:328`) reads it. Either add to the type
or document the omission.

### 13. `pairingMapInput || undefined` can't clear an existing pairing's map

**Status:** Closed as intentional in `dab2251`. `PatchPairingSchema`
comment now documents the rationale: match generation always assigns
a map for non-bye matches (`assignMap` throws on empty input), so
admins can replace but not null. Byes carry `map_script=null` because
the row is INSERTed with null at round generation; there's no post-hoc
clear path. No code change.

`src/routes/tournaments/[slug]/admin/+page.svelte:316`. Empty input
sends `{}` (field omitted); the worker treats that as "no change".
`PatchPairingSchema` (`cloud/src/schemas/tournament.ts:97`) is
`v.optional(MapScriptSchema)`, not nullable — so even an explicit null
would be rejected. Admin has no way to clear a stuck map. Fix needs
both schema (accept null) and the frontend payload.

### 14. Retro-edit winner picker has no null option

**Status:** Fixed in `2303253` (server invariant) + `dab2251` (UI
coupling). Server: status='pending' rejects an explicit non-null winner
and force-clears `winner_slot_id` on the row; status='reported'/
'forfeit' require a non-null winner against the post-patch state. UI:
selecting status='pending' auto-clears `retroWinnerSlotId` and
disables the `<select>`, so the body always matches the invariant.
Tests: `retro-edit.test.ts` › "rejects status='pending' with an
explicit non-null winner_slot_id", "forces winner_slot_id to null when
patching status to 'pending' without an explicit winner", "rejects
status='reported' with an explicit null winner_slot_id".

`src/lib/tournament/RoundMatches.svelte:165-179`. The `<select>` only
offers slot_a and slot_b. Setting `status='pending'` should send
`winner_slot_id=null`, but the picker has no way to express that —
`saveRetroEdit` (`src/routes/tournaments/[slug]/admin/+page.svelte:334-344`)
ships whichever slot was last selected.

### 15. `MatchCard` winner highlight is a no-op

**Status:** Fixed in `dab2251`. Dead `class:bg-opacity-100` toggles
deleted from both cells. The "Winner" text label + bold name remain
the visual cue (sufficient for the use case).

`src/lib/tournament/MatchCard.svelte:45,55`. `class:bg-opacity-100={...}`
toggles a Tailwind utility that requires a Tailwind bg class, but the
cell's background is set via inline `style="background-color: #35302B;"`.
The intended highlight doesn't render. (The text "Winner" still does,
so the visual still works.)

### 16. `saveSettings` lets you submit an empty name

**Status:** Fixed in `dab2251`. Save button now disabled when any of
`editName.trim()`, `editDivAName.trim()`, `editDivBName.trim()` is
empty.

`src/routes/tournaments/[slug]/admin/+page.svelte:148-167`. No
client-side validation; relies on worker rejection. Trivial fix:
`disabled={busy || !editName.trim() || !editDivAName.trim() ||
!editDivBName.trim()}` on the Save button.

### 17. BulkUploadModal observer mode silently auto-picks slot B on 3+-human saves

**Status:** Fixed in `cf3d8c1`. `selectSlotAPlayer` only auto-fills
`slotBPlayerIndex` when `humans.length === 2`; any other count leaves
it null, so `rowReadyToUpload` returns false and the Upload button
stays disabled. The observer-mode error banner now renders
unconditionally on `humans.length !== 2`, so 3+-human saves surface
the warning instead of silently picking a stranger. No integration
test (UI-only); server-side `WRONG_HUMAN_COUNT` is the safety net.

`src/lib/BulkUploadModal.svelte:234-238` uses `find()` for "the other
human" — for 3+ humans it grabs the first one. The error banner at
lines 555-560 only renders when `slotBPlayerIndex` is null (1-human
case). Server-side `WRONG_HUMAN_COUNT` check
(`cloud/src/games.ts`, tournament block) catches it, but the UI lets
you waste an upload.

### 18. `slotInfo` in admin/+page.svelte builds 4 unused fields per slot

**Status:** Fixed in `dab2251`. Trimmed to
`Record<string, string | null>` mapping slot_id → username. Verified
the W-L column reads from `data.standings` directly via
`swissSlotRows`, not from slotInfo.

`src/routes/tournaments/[slug]/admin/+page.svelte:21-53`. Only
`username` is consumed (via `slotLabel`). `swiss_seed` is hardcoded to
`null` and never read. Either trim to a `Record<string, string>` or
actually populate `swiss_seed`.

### 19. `SlotUsernameCell` UX rough edges

**Status:** Fixed in `dab2251`. Autofocus via new
`$lib/actions/autofocus.ts` action (selects existing value too);
Enter saves; Esc cancels; empty input shows an inline red error
"Username cannot be empty" instead of silently exiting edit mode.

`src/lib/tournament/SlotUsernameCell.svelte`:

- No autofocus on edit toggle (lines 30-37).
- No Enter-to-save / Esc-to-cancel keyboard handling.
- Empty input silently exits edit mode with no feedback (lines 20-27).

## Nice-to-have

### 20. Pairing test claims to exercise rematch swap but doesn't

**Status:** Fixed in `400a603`. Replaced with an 8-slot, 2-round
scenario that forces A, B, C, D into the same (1-1) bucket in round 3
with both default-pair candidates (A-C, B-D) being prior matches.
The swap branch produces A-D and B-C. Verified load-bearing:
temporarily commenting out the swap loop at `pairing.ts:170-189` fails
the new test with `expected ['A|C', 'B|D'] to not include 'A|C'`.

`cloud/src/tournament/pairing.test.ts:92-126`. After round 1
A=(1,0) B=(0,1) end up in different buckets, so the assertion
`not.toContain(unorderedPair("A", "B"))` is trivially true regardless
of `pairBucket`'s swap branch
(`cloud/src/tournament/pairing.ts:175-189`). The swap branch is
uncovered — needs a test where all four slots share a bucket and a
forced rematch is avoidable via swap.

### 21. `parseAllowedMaps` returns `[]` on parse failure; downstream throws a 500

**Status:** Fixed in `2303253`. `parseAllowedMaps` now throws
`MapConfigError` on bad JSON, wrong shape, or empty array. The three
admin call sites (generateSwissRound, generateChampionshipFollowup,
handleTransitionChampionship) wrap via a `parseAllowedMapsOrError`
helper and surface a 500 `MAP_CONFIG_INVALID` with a clear message.
The public read path (`handleTournamentDetail`) stays lenient — catches
and returns `[]` so a corrupted-tournament public view still loads.
Reachable only via direct-DB tampering; no runtime test.

`cloud/src/tournament/data.ts:222-232` swallows JSON errors and returns
`[]`. Three callers (`admin.ts:557,684,1061`) hand the result to
`assignMap`, which throws `"allowedMaps must be non-empty"`
(`cloud/src/tournament/maps.ts:50-52`). Result: corrupted-JSON cell →
500 with misleading message instead of a 4xx. Either tighten
`parseAllowedMaps` to throw, or add a check at each call site.

### 22. `compareForPairing` null `swiss_seed` fallback to 0

**Status:** Fixed in `aeaea48`. Migration 0009 adds two triggers
(BEFORE INSERT and BEFORE UPDATE OF swiss_seed,phase) on
`tournament_slots` that fail with `swiss_seed required for swiss-phase
slots` if any swiss-phase row tries to set NULL. Triggers chosen over
the create-new-table-copy-drop-rename pattern to avoid PRAGMA
foreign_keys juggling around the four `tournament_matches` FK
references back into `tournament_slots`. No code path writes NULL
today, so the migration formalises an existing invariant; the
`?? 0` fallback in `compareForPairing` is now provably dead for
swiss-phase slots (kept for type-shape uniformity since championship
slots still have NULL swiss_seed).

`cloud/src/tournament/pairing.ts:121`. Schema allows null for
swiss-phase slots (`cloud/migrations/0006_tournaments.sql:93`); tests
always set sequential seeds. Untested branch. Consider making
`swiss_seed NOT NULL` for swiss-phase slots.

### 23. `handleMyMatches` JOIN with `OR` can duplicate rows

**Status:** Fixed in `2303253`. `SELECT DISTINCT` added. Test:
`my-matches.test.ts` › "deduplicates when the caller owns both slots
of a single match (#23)" — constructs the edge case via direct UPDATE
of both slot rows to the same user_id and asserts a single response
row.

`cloud/src/tournament/player.ts:66`. If a user owns both slots in a
match (edge case but not schema-prevented), the row appears twice.
`SELECT DISTINCT` or a `UNION` would fix it cheaply.

### 24. `handleDismissBanner` returns 200 on unknown tournament

**Status:** Fixed in `2303253`. Pre-check returns 404
`NO_SLOT_IN_TOURNAMENT` when the caller has no slot in the named
tournament; once a slot exists, the UPDATE-then-return-changes flow
is preserved (200/dismissed=0 on second call is still idempotent).
Tests in new `dismiss-banner.test.ts`: "returns 401 to an
unauthenticated request", "returns 404 when the caller has no slot
in the tournament", "dismisses on first call (dismissed=1) and is
idempotent on second (dismissed=0)".

`cloud/src/tournament/player.ts:76-93`. Returns `{dismissed: 0}` with
200 instead of 404. Inconsistent with the rest of the API.

### 25. `transition-championship` cascade-tie returns non-standard error shape

**Status:** Fixed in `2303253`. `errorResponse` grows an optional
`extra: Record<string, unknown>` parameter (backward-compatible —
existing 4-arg callers keep working); cascade-tie 409 now flows
through it. Frontend reads the same field names (division,
tied_slot_ids, ranked). Test: `transition-championship.test.ts` ›
"returns 409 with division, tied_slot_ids, ranked alongside the
standard error/code".

`cloud/src/tournament/admin.ts:986-1003` uses `jsonResponse` (with
extra `division`, `tied_slot_ids`, `ranked` fields) instead of
`errorResponse`. Frontend depends on the payload, but it diverges from
every other 409. Consider extending `errorResponse` to allow extra
payload fields, or document the convention break.

### 26. Empty `if` block at `admin.ts:272-274`

**Status:** Fixed in `2303253`. Dead stub deleted. The
`UNIQUE (tournament_id, phase, division, swiss_seed)` constraint
already covers the underlying concern; no behavior change.

Just a comment, no code. Cleanup pass. The intent (advance
`nextSeedByDiv` past explicit-seed entries to avoid collision in a
mixed batch) isn't implemented, but the
`UNIQUE (tournament_id, phase, division, swiss_seed)` constraint
would catch it anyway.

### 27. CLI `delete` confirms with "nuke"

**Status:** Fixed in `150b6eb`. New
`confirmTyping(prompt, expected)` helper in `scripts/lib/confirm.ts`;
`tournament delete` now prompts for "delete". `confirmNuke` survives
for the actual `nuke-*` subcommands so muscle memory still matches
those. Help text updated.

`scripts/admin/commands/tournament.ts:386` uses `confirmNuke` for a
`delete` subcommand. Operators will type the wrong verb. Either rename
the helper or add a tournament-specific confirm.

### 28. `grant-admin`/`revoke-admin`/`delete` ignore `--json`

**Status:** Fixed in `150b6eb`. All three now emit JSON on success:
`{tournament_id, user_id, display_name, granted}`,
`{tournament_id, user_id, revoked}`,
`{tournament_id, name, deleted}`.

`scripts/admin/commands/tournament.ts:320,350,369`. `create`/`list`/
`show` honor it. `scripts/admin/index.ts:59` advertises `--json` as
global.

### 29. `runList` silently drops invalid `--status`

**Status:** Fixed in `150b6eb`. Throws `unknown --status value: X
(expected one of: setup, swiss, championship, complete)` instead of
silently dropping the filter. Exit code 1. Matches the pattern in
`scripts/admin/commands/users.ts`.

`scripts/admin/commands/tournament.ts:182-186`. Compare to
`scripts/admin/commands/users.ts:88-92` which throws on invalid sort.

### 30. No `typecheck` script for the cloud package

**Status:** Fixed in `5c73729`. `cloud/package.json` exposes
`npm run typecheck` (`tsc --noEmit`). The prod preflight at
`scripts/prod/checks/typescript.ts` already shells out to the same
command in the `cloud/` dir, so the preflight gate predated this
commit; the new script gives operators a discoverable invocation.

`cloud/package.json` runs vitest but not `tsc --noEmit`. Vitest doesn't
typecheck by default. Would catch #4. Add `"typecheck": "tsc --noEmit"`
and wire it into the preflight check.

### 31. `TournamentBanner` optimistic dismiss doesn't rollback on POST failure

**Status:** Closed as comment-only in `dab2251`. Updated to
"next navigation (invalidateAll refetches and repopulates)" — accurate
description of current behavior. Swallow-on-failure stays: the
operation is cosmetic and there's no useful retry surface for the user.

`src/lib/tournament/TournamentBanner.svelte:20-31`. The banner stays
dismissed in the store but the next `invalidateAll` repopulates from
server state, so it reappears. The in-file comment claims this is OK
"until next hard reload" but it's actually next nav. Either accept and
update the comment, or restore on failure.

### 32. Dashboard tournament fetches swallow `UnauthorizedError`

**Status:** Fixed in `dab2251`. Both `.catch()` blocks go through a
`swallowExceptAuth(fallback)` helper that re-throws
`UnauthorizedError` (so the outer redirect still fires) while keeping
the fallback behavior for everything else.

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

All bundles closed. Order of landing for reference:

1. ~~**Authz + data integrity bundle**: 1, 2, 3, 7, 8, 10.~~ **Done in
   `56923f4`** (expanded to include #4 and #5 since they were Critical
   and the diff was already touching the same files).
2. ~~**Type-safety bundle**: 4, 5, 11, 12, 30.~~ **Done** — #4 and #5
   landed with bundle 1 (`56923f4`); #11, #12, #30 landed in
   `5c73729`.
3. ~~**UX-blocking bundle**: 9, 13, 14, 16.~~ **Done** — #9 landed
   server-side in `2303253`; #14 split across `2303253` (server) +
   `dab2251` (UI); #13 closed as intentional in `dab2251`; #16 landed
   in `dab2251`.
4. ~~**Polish bundle**: everything else.~~ **Done** across
   `aeaea48` (#22), `2303253` (#6, #21, #23, #24, #25, #26),
   `dab2251` (#15, #18, #19, #31, #32), `cf3d8c1` (#17),
   `150b6eb` (#27, #28, #29), `400a603` (#20).

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
