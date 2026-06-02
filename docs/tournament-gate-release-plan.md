# Tournament gate release plan

Status: **planned, not started.** Captured ahead of further tournament
iteration so the access-control rework is ready to execute when the feature is
ready to open up.

## Context

Today the entire tournament feature sits behind a single `tournament_beta_users`
allowlist. `requireTournamentBeta()` (`cloud/src/tournament/authz.ts`) is called
on **every** tournament endpoint — reads, participation, admin, and create alike
— and throws **404 (not 403)** on a miss so non-members can't tell the feature
exists. The frontend mirrors this: `/tournaments` and `/tournaments/[slug]`
bounce anonymous users to login, and `is_beta` (from `/v1/auth/me`) hides the
create button and skips the per-user tournament fetches.

We want to open it into **three tiers**:

1. **Public (anonymous OK):** browse `/tournaments` and any tournament's
   detail / standings / bracket / matches.
2. **Logged-in:** sign up / withdraw, be granted tournament admin, and perform
   admin actions once granted.
3. **Allowlist (the one exception):** only users in `tournament_beta_users` may
   **create** a new tournament.

The `tournament_beta_users` table, the `is_beta` API field, the login-time pin
in `handleDiscordCallback`, and the `beta-grant`/`beta-list` CLI verbs all
**stay as-is** (decision: keep "beta" naming). The only change is *what* gates
on them — after this work, beta membership gates create and nothing else.

### Decisions locked

- **PII:** anonymous viewers see `display_name` + avatar but **not** the raw
  `discord_username` (`@handle`). Logged-in users see it. (Anon-only strip,
  consistent with the existing `stripOnlineIds`-for-anon pattern in `games.ts`.)
- **Create denial:** frontend hides the create button for non-allowlisted users;
  the worker returns a **plain 403** (not 404) if create is called directly.

## Worker changes

### Split the gate — remove `requireTournamentBeta` everywhere except create

`cloud/src/tournament/authz.ts` — keep `requireTournamentBeta` and
`isTournamentBeta` (still used by create and `/v1/auth/me`). No change to the
file itself.

- **Public reads** (`cloud/src/tournament/public.ts`): drop the
  `requireBetaOr404` call from every read handler (list, detail-by-slug,
  standings, bracket, rounds, matches, match-detail). The handlers already
  resolve the session for `is_viewer_admin`; with no gate they run for
  `session = null`. The `requireBetaOr404` helper (public.ts ~96) becomes unused
  → delete it. Keep `enforceTournamentViewRateLimit` (per-IP anon read limit —
  matters more now).
- **Participation** (`cloud/src/tournament/player.ts`): rename `authedBetaSession`
  (line 31) to a session-only helper (drop the `requireTournamentBeta` call at
  line 47, keep the anonymous path but as a genuine 401, not a 404-disguise).
  Used by my-tournaments / my-admin-tournaments / my-matches / signup / withdraw.
  Also drop the inline beta checks in `handleTournamentSignup` (line 208) and
  `handleTournamentWithdraw` (line 360).
- **Admin** (`cloud/src/tournament/admin.ts`): in `authedTournament` (line 241)
  drop the `requireTournamentBeta` call (line 258), keep `requireTournamentAdmin`.
  Same in the match-schedule participant helper (line ~1703) and in
  `handleDeleteTournament`'s non-site-admin path (line 974) — drop beta, keep the
  creator/site-admin check. (Creators are beta by construction today, so this is
  redundant-but-confusing rather than load-bearing.)
- **Export** (`cloud/src/tournament/export.ts`): drop `requireTournamentBeta`
  (line 183), keep `requireTournamentAdmin` — export stays admin-only.
- **Create** (`cloud/src/tournament/admin.ts`, `handleCreateTournament`,
  line 444): **keep** the allowlist gate (line 457) — this is the surviving gate.
  Change its failure semantics: a logged-in non-allowlisted caller should get a
  **403** with a clear code (e.g. `TOURNAMENT_CREATE_FORBIDDEN`), not the current
  404. `requireTournamentBeta` itself throws 404, so don't reuse it here —
  replace with an explicit `isTournamentBeta()` check that returns 403 on miss.
  Keep the anonymous-rejection and the per-user create rate limit.

Once `session = null` is a valid state across the read handlers, audit each for
any `session!.` / non-null assertion on the session and relax to `session?.`.

### Strip `discord_username` for anonymous viewers

In the public read handlers, compute `const includeUsernames = session !== null;`
and gate the `discord_username` field on it, mirroring the existing
`viewerIsAdmin ? s.signup_answer : null` pattern (public.ts:652). Sites:

- standings `slotIdentity` (public.ts ~645)
- detail slot serialization (public.ts ~825)
- match / match-detail username map (public.ts ~1029-1036)

**Note on unclaimed slots:** `display_name` is `COALESCE(u.display_name,
s.discord_username)` (public.ts:309) — for a slot added by username with no
linked account, the only identity *is* the discord username, surfaced as
`display_name`. We strip the dedicated `discord_username` field but keep
`display_name`; for unclaimed slots that means the username still shows *as the
display name*. This is the intended reading of "display name only" — the
alternative (masking unclaimed names) would make brackets unreadable.

## Frontend changes

- `src/routes/+layout.ts:49` — change `if (user?.is_beta)` to `if (user)`:
  `getMyTournaments` / `getMyAdminTournaments` are per-user membership lists, now
  relevant to *any* logged-in user. Update the comment (no longer beta-gated).
- `src/routes/tournaments/+page.ts` — remove the anonymous→login bounce; allow
  the page to load for anon. Keep the genuine 404→SvelteKit-404 mapping.
- `src/routes/tournaments/[slug]/+layout.ts` — same: remove the login bounce so
  shared tournament URLs render for anonymous visitors. Keep real 404 handling.
- `src/routes/tournaments/+page.svelte:57` — change the create-button gate from
  `{#if data.user}` to gate on `data.user?.is_beta` (only allowlisted users see
  the create UI).
- `src/lib/tournament/TournamentAdminManager.svelte:63-65` — remove the "added,
  but isn't in the tournament beta yet — they can't open the tournament" warning.
  A granted admin now works regardless of beta, so the warning is obsolete; the
  success toast collapses to the plain "is now an admin" case.
- `src/lib/api-cloud.ts:53-57` — update the `is_beta` doc comment to reflect its
  new meaning ("user may create tournaments"). The `is_beta` field on
  `grantTournamentAdmin`'s response (used only by the removed warning) becomes
  vestigial — drop it from the response type and the worker payload
  (admin.ts:867-872, 887).
- **No change needed** for the home-page rail: `src/routes/+page.ts:32-36`
  already calls `listTournaments()` with a `.catch(() => empty)` fallback, so it
  populates for anonymous users automatically once the worker gate drops.

## Tests

`cloud/test/integration/` has existing beta-gate coverage (search for
`beta-gate`, signup, rate-limit specs). Update/extend:

- Public reads (list, detail, standings, bracket, matches) return **200 for an
  anonymous request** (no session) and for a logged-in non-beta user.
- `discord_username` is **absent/null** in an anonymous read but **present** for
  a logged-in viewer.
- Signup / withdraw succeed for a logged-in non-beta user.
- Granting admin to a non-beta user lets them hit an admin endpoint (200), where
  previously they'd 404.
- `POST /v1/tournaments` returns **403** (not 404) for a logged-in non-beta user
  and still succeeds for a beta user.

## Verification

1. `cd cloud && npm test` — both projects green.
2. `npm run lint && npm run check` at repo root.
3. Seed a local fixture: `./per-ankh admin --local tournament seed demo`.
4. Confirm the seed shape with the read-only local D1 queries (see CLAUDE.md),
   then view in the dev server (`./per-ankh dev`): anonymous browse of
   `/tournaments` and `/tournaments/demo`, a logged-in non-beta account signing
   up and being granted admin, and the create button appearing only for an
   allowlisted account.
