# Per-Ankh Cloud Productionization Plan

> **Update (post-Tauri removal):** Phase F (Tauri sweep) and Phase G (desktop preservation) below were superseded by [`tauri-removal-plan.md`](./tauri-removal-plan.md), which we ran without waiting for the bake window. v0.2.0 is the desktop-final GitHub Release. The bake-related phases (B–E) and observability follow-ups (§13) are still the active runbook for cutover. Read sections F and G as historical context only.

Sequencing plan for taking the cloud rewrite (PR #35, branch `cloud-rewrite`)
from "merged but unreleased" through production cutover, bake-in, Tauri
removal, and end-user preservation of the legacy desktop build.

Companion to [`cloud-rewrite-spec.md`](./cloud-rewrite-spec.md). The spec says
_what_ we built; this doc says _how we ship it without breaking anyone_.

## Table of Contents

1. [Status Snapshot](#1-status-snapshot)
2. [Guiding Principles](#2-guiding-principles)
3. [Sequencing Overview](#3-sequencing-overview)
4. [Phase A — Merge to `main`](#4-phase-a--merge-to-main)
5. [Phase B — Pre-cutover hardening](#5-phase-b--pre-cutover-hardening)
6. [Phase C — Atlas migration to R2](#6-phase-c--atlas-migration-to-r2)
7. [Phase D — Production cutover](#7-phase-d--production-cutover)
8. [Phase E — Bake](#8-phase-e--bake)
9. [Phase F — Tauri sweep](#9-phase-f--tauri-sweep)
10. [Phase G — Desktop preservation for end users](#10-phase-g--desktop-preservation-for-end-users)
11. [Rollback story](#11-rollback-story)
12. [Smaller follow-ups](#12-smaller-follow-ups)
13. [Observability fast-follow](#13-observability-fast-follow)

---

## 1. Status Snapshot

### Done (in PR #35)

- Parser TS port (46/46 entities, share-parity harness green)
- Browser parser MVP page + map turn slider parity
- D1 schema with numbered migrations (users, games, player_summaries,
  game_player_turn, tech/law events, online_ids)
- Discord OAuth (PKCE, KV sessions, `/v1/auth/{start,callback,me,logout}`)
- Upload pipeline (multipart, Valibot, SHA-256 dedup, R2 puts, batched D1
  inserts respecting the 100-param cap)
- Games library + detail (chronological list, full `GameDetailView`, map turn
  slider, delete)
- `/v1/stats` + `/dashboard` mirroring desktop overview
- `player_summaries` backfill — 16 milestone columns populated on every upload
- Public sharing UX — `is_public` toggle, anonymous viewing, OG-card
  unfurling, online_id PII strip, Cache-Control split (`s-maxage=60` on
  public reads so Make Private toggles propagate within ~1min) +
  `Vary: Cookie, Origin`
- adapter-cloudflare SSR — `BUILD_TARGET` env switch, per-route `ssr=false`
  for `/upload` + `/auth/callback`, hooks.server.ts security headers,
  `kit.csp` hash mode
- Anonymous read rate limit (200/hr per-IP via D1 `events` table, global
  rather than per-POP) with social-unfurler UA bypass; PATCH visibility
  limit (60/hr per-user via D1)
- `safeNext` open-redirect sanitizer (client + server)
- 429 surfaces as a proper 429 page on the SSR'd game route
- Raw save download — `GET /v1/games/:id/download`, auth-gated,
  50/hr per-user + 100/hr per-IP, RFC 6266 filename, audit logged
- Re-import on parser version bump — banner, ZIP round-trip, semver-gated
  in-place overwrite preserving `created_at` + `is_public`
- Owner `Cache-Control: no-store` so `invalidateAll()` re-hits the worker
- Persistent `CloudHeader` on cloud routes
- `/account` page — Discord identity, linked OnlineIDs (optimistic remove),
  sign-out

### Remaining (this doc plans the order)

- Atlas migration to R2 (`assets.per-ankh.app/v/atlases/...`)
- Production cutover — KV/D1/secret setup, custom domain wiring,
  `wrangler-frontend.toml`, rate-limit tuning
- Bake under real traffic
- Tauri sweep — drop `src-tauri/`, Tauri-only routes/components, parity
  harness, doc trim
- End-user preservation — tag + GitHub Release of last desktop build

### Smaller follow-ups (deferred, see §12)

Dynamic OG image, `_routes.json` tuning, cross-subdomain cookie verification,
real unfurler tests, mobile header layout, account-deletion path, unlink-Discord.

---

## 2. Guiding Principles

- **Dual-build is the safety net, not a liability.** As long as the Tauri
  build still works, every change to `main` is reversible by users staying on
  the desktop app. We only burn that net in Phase F.
- **Reversibility before convenience.** Big destructive steps get split into
  smaller commits even when a single commit would be cleaner — bisect matters
  more than aesthetic diffs once we're in production.
- **Define success before measuring it.** "Bake for a few days" is a feeling.
  §8 commits to concrete signals up front so we don't either pull the Tauri
  trigger too early or leave it open forever.
- **D1 migrations are forward-only.** No prod migration runs without a dry
  run on a throwaway D1 first.
- **Public surface area widens once.** Once Discord OAuth is live on the real
  domain, every fix is a production fix. The pre-cutover hardening phase (§5)
  exists to land cheap defenses before that boundary is crossed.

---

## 3. Sequencing Overview

```
Phase A   Resolve all PR #35 review findings, then merge
   │
Phase B   Pre-cutover operational verification     (no code changes)
   │      ├─ D1 migration rehearsal on throwaway DB
   │      ├─ PII audit script on cached blobs (verifies §A fix)
   │      └─ Cross-subdomain cookie test on staging
   │
Phase C   Atlas migration to R2                    (deploy assets bucket)
   │
Phase D   Production cutover                       (DNS + Worker + secrets)
   │      conservative rate limits
   │
Phase E   Bake                                     (two stages)
   │      ├─ E1: solo bake (gate on, single ID allowlisted)
   │      ├─ Allowlist expand (single ID → cohort)
   │      └─ E2: cohort bake (≥ 5 invitees, full criteria)
   │      ship deferred follow-ups during either stage
   │
Phase F   Tauri sweep                              (split into 2 PRs)
   │      ├─ F1: drop src-tauri/ + Tauri-only frontend
   │      └─ F2: drop parity harness + dump_parsed.rs + doc trim
   │
Phase G   Desktop preservation                     (tag + GitHub Release)
          done before F1 lands
```

Phase G's tag is cut **before** Phase F1 merges, but the GitHub Release with
prebuilt binaries can be assembled any time after — see §10.

---

## 4. Phase A — Resolve review findings, then merge

**Action:** address every finding from the PR #35 code review (High, Medium,
Low) on the `cloud-rewrite` branch, then merge to `main`.

### Why fold the fixes into #35 rather than merge-now-fix-later

- The High items (`safeNext` tightening, `CF-Connecting-IP` assertion, CSRF
  stance) are small, scoped, and have obvious diffs. There is no review
  burden worth deferring.
- Git history reads cleaner — the cloud rewrite lands as one reviewed unit,
  not "cloud rewrite + three security follow-ups." A year from now, someone
  bisecting an auth bug shouldn't have to discover that #35 merged with a
  known open-redirect gap.
- Post-merge attention reliably drifts to new work. Deferred cleanup is
  likeliest to actually land if it rides the same review pass that surfaced it.
- Dual-build means there's no production pressure forcing an early merge —
  nothing is exposed until Phase D regardless.

This doesn't conflict with "merge before atlas migration" (Phase C). The
review fixes are days, not weeks; the branch isn't held open through cutover
or bake, just through the small follow-up commits closing out the review.

### Findings to resolve

Full text in the GitHub review on PR #35. Summary:

| Severity | Finding                                                                                                         | Where                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| High     | `safeNext` reject `?`, `#`, `%3d` post-decode                                                                   | `cloud/src/auth.ts:62`, `src/lib/utils/safe-next.ts`  |
| High     | `CF-Connecting-IP` trust — assert `CF-RAY` presence                                                             | `cloud/src/index.ts:248`, `games.ts:595,969`          |
| High     | CSRF stance on PATCH/DELETE — token check or documented SameSite=Lax assumption                                 | `cloud/src/games.ts`                                  |
| Medium   | `stripOnlineIds` deep-walk or schema tightening so PII can't appear outside `player_roster`                     | `cloud/src/games.ts:159`, `cloud/src/schemas/game.ts` |
| Medium   | OAuth callback read-then-delete — comment the dependency on Discord as the gate                                 | `cloud/src/auth.ts:248`                               |
| Medium   | Verify owner endpoints actually emit `Cache-Control: no-store` (commit `466e062` claims it; grep before deploy) | `cloud/src/games.ts`                                  |
| Medium   | Server-side `parser_version` validation on re-import (currently client-side only)                               | `cloud/src/games.ts` re-import branch                 |
| Low      | Inline doc on `stripOnlineIds` locking in the assumption                                                        | `cloud/src/games.ts:159`                              |
| Low      | Compound D1 index `games(user_id, is_public)`                                                                   | `cloud/migrations/0002_cloud_schema.sql`              |
| Low      | Verify fast-xml-parser entity decoding matches Rust                                                             | parser test or harness assertion                      |
| Low      | Confirm `dump_index` field is emitted by both Rust `dump_parsed` and TS `dump.ts`                               | parity harness                                        |

If any finding is intentionally deferred (e.g. the Low-severity compound
index isn't worth the migration), leave a comment in the relevant file
explaining why — so reviewers and future-us see the decision rather than
guessing it was missed.

### Additional pre-merge work

Beyond the review findings, fold these in while #35 is open. They're cheap
in this PR, expensive as scattered follow-ups.

**Documentation hygiene.** README and `CLAUDE.md` still describe Per-Ankh
as a Tauri-first desktop app. Once the cloud rewrite is on `main`, that's
misleading for new readers and for future Claude Code sessions (which read
`CLAUDE.md` as authoritative context). Add a short top-of-file note in each
pointing at [`cloud-rewrite-spec.md`](./cloud-rewrite-spec.md) and this
plan, and acknowledge the Tauri build is being kept around through the bake
window only.

**Final scan for dev artifacts.** 17K lines is a lot of room for stray
`console.log`, `TODO`, debug branches, commented-out code. Run before merge
and triage each hit (fix, document, or accept):

```bash
git diff main..cloud-rewrite -- src/ cloud/ | \
  grep -E '^\+.*(console\.(log|debug)|TODO|FIXME|XXX|@ts-ignore|@ts-expect-error)'
```

**Pick the merge strategy now, not at the merge button.** The branch has
~35 commits with meaningful per-feature granularity (per-entity parser
ports, individual cloud features). Squash-merge collapses all of that into
one entry on `main`; a merge-commit or rebase-and-merge preserves it. The
per-entity commits are useful for future bisects (especially around the TS
parser port if a parity-style bug surfaces post-Tauri-removal), so
**preserve the history** — merge-commit or rebase-and-merge, not squash.

### Verify before merging — fold in if missing

**Worker observability — must land in #35.** The bake exit criteria in §8
need data, and structured logging is the one observability primitive that
is genuinely painful to retrofit (touches every handler). Cloudflare-side
wiring (alerts, Logpush destination) is Phase D — see §7. Land in this PR:

- **Structured JSON logs across every handler.** Fields: `request_id`,
  `route`, `user_id` (when authed), `status`, `duration_ms`, error class
  on failures. Emitted via `console.log` so Logpush can pick them up
  unchanged once a destination is wired in Phase D.
- **PII rule for logs.** Same logic that drives `stripOnlineIds` for blobs
  applies to logs. Never log request bodies on upload/reimport routes;
  Discord IDs and OnlineIDs are PII and don't belong in log fields beyond
  the opaque internal `user_id`. One line in the logging conventions
  before the first handler emits anything — retroactive scrubbing of
  Logpush sinks is painful.
- **Audit log completeness check.** `audit_events` already exists; verify
  every state-mutating endpoint (upload, reimport, visibility PATCH,
  delete, online_id remove, download) writes to it. Easy to gap; hard to
  backfill once a security review needs the trail.
- **CSP `report-uri` (or `report-to`) endpoint.** A trivial
  `POST /v1/csp-report` handler that structured-logs the violation. CSP
  is configured today; without a reporting endpoint, week-one violations
  are silently lost.

**Worker test coverage.** `cd cloud && npm test` is in the PR's test plan.
If it's smoke tests on one or two endpoints, the auth flow + upload
pipeline + rate-limit logic could use direct tests before going live. Not a
hard blocker, but Phase E's "no P1 bugs" exit criterion is easier to hit
when the obvious failure modes are covered by tests rather than discovered
by users.

**Run `npm run tauri:build` early in Phase A.** It's an exit criterion, but
do it once near the top of Phase A — not at the very end. If the dual-build
assumption is broken on the branch right now, find out before stacking the
review fixes on top of it.

### Exit criteria (before merge)

- All review findings resolved or explicitly deferred with a comment
- README + `CLAUDE.md` updated to point at the cloud rewrite docs
- Dev-artifact grep clean (or each hit triaged with a note)
- Merge strategy decided (preserve history; not squash)
- Worker observability hooks present, or follow-up scoped if intentionally deferred
- `npm run check` and `npm run lint` clean
- `cd cloud && npm test` passes
- Parity harness green against the smoke corpus
- `npm run tauri:build` still produces a working desktop binary on at least
  one platform (smoke test that the dual-build assumption holds)

---

## 5. Phase B — Pre-cutover operational verification

Code changes have all landed in #35 (Phase A). What remains is verification
that runs against infrastructure, not the codebase. None of these are PRs;
they're operational checks that protect cutover.

### B1. D1 prod migration rehearsal

Forward-only migrations + production data is a one-shot. Rehearse:

1. Create a throwaway D1 in the same Cloudflare account.
2. Run `wrangler d1 migrations apply <throwaway>` against it from a clean
   checkout of `main`.
3. Confirm all four numbered migrations land cleanly (`0001_baseline.sql`
   through `0004_drop_pick_order.sql`).
4. Drop the throwaway.

If a migration fails on prod, there is no `down`. The rehearsal is the
insurance.

### B2. PII audit on cached blobs

The code-level fix for the `stripOnlineIds` Medium finding lands in Phase A
(deep-walk strip and/or schema tightening). This step is the _verification_:
run a one-off script over the existing cached blobs that recursively scans
for keys named `online_id`, `discord_id`, or `username` outside
`player_roster`. Confirm zero hits before opening signups.

If the audit turns up hits the Phase A fix didn't catch, that's a regression
in the fix — patch and re-run before cutover. The script itself is dev-only
and doesn't ship.

### B3. Cross-subdomain cookie test (staging)

Spin up a staging deploy on temporary subdomains (e.g.
`staging.per-ankh.app` SSR + `api-staging.per-ankh.app` API). Sign in, then
load `/games/[id]` for an owned game. If `event.fetch` doesn't auto-forward
the session cookie cross-subdomain, the SSR'd page silently falls back to
public-view rendering — easy to miss because anonymous reads still work.

The explicit-cookie fallback is wired in `api-cloud.ts`, but we want to know
which path actually fires in practice before users do.

---

## 6. Phase C — Atlas migration to R2

Move atlases out of the SvelteKit static bundle to versioned R2 paths
(`assets.per-ankh.app/v/<version>/atlases/...`). Done **before** cutover so
the production SvelteKit build references R2 from day one rather than serving
~MB of binary atlases through the SSR Worker.

**Side benefit:** clarifies the static-vs-dynamic boundary, which makes the
deferred `_routes.json` tuning straightforward.

**Steps (sketch):**

1. Add an R2 upload step to `scripts/bake-*.ts` (atlases are baked locally
   today; output the same files plus push to R2 under the version key).
2. Add a build-time atlas base URL constant — defaults to `/atlases/` for
   Tauri build, switches to `https://assets.per-ankh.app/v/<version>/atlases/`
   for cloud build.
3. CSP `img-src` already needs to allow this domain — check
   `svelte.config.js` CSP config.
4. Verify atlas references in `SpriteMap.svelte` use the constant, not
   hardcoded paths.
5. Versioning: bump the path version when atlases change. Old paths stay in
   R2 indefinitely (cheap; supports cached page loads from old SSR responses).

Tauri build keeps loading atlases from local `static/atlases/` — no change
needed for desktop.

---

## 7. Phase D — Production cutover

**Cloudflare provisioning** (one-time):

- D1 database created, migrations applied (already rehearsed in B2)
- KV namespace for sessions
- R2 buckets: parsed-game blobs, raw save ZIPs, atlases (from C)
- Secrets via `wrangler secret put`: `DISCORD_CLIENT_SECRET`,
  `ALLOWED_DISCORD_ID` (single-ID login allowlist for initial release —
  fail-closed if unset, so don't skip), anything else `cloud/src/auth.ts`
  reads from `env`
- `wrangler-frontend.toml` for the SSR Worker (separate from `cloud/wrangler.toml`)
- Custom domains: `per-ankh.app` → SSR Worker, `api.per-ankh.app` → API Worker,
  `assets.per-ankh.app` → R2 bucket
- Set production `VITE_API_URL=https://api.per-ankh.app/v1` and
  `VITE_PUBLIC_ORIGIN=https://per-ankh.app` at build time
- Cloudflare alerts configured: Worker 5xx rate, CPU-exceeded, D1 errors.
  Free, dashboard-driven; the floor for a public surface
- **Logpush destination — DECISION REQUIRED.** Logpush needs a sink (R2,
  S3, Datadog, Baselime, etc.). Pick before cutover so the structured logs
  landed in Phase A actually go somewhere queryable. Default if nothing
  else is decided: R2 bucket, query later with DuckDB — cheap and
  Cloudflare-native
- CSP report endpoint deployed and routed to logs (handler landed in
  Phase A)

**Conservative rate limits at launch:**

Lower the limits described in the spec by ~2x for the first week. Easier to
loosen than to tighten after abuse:

| Limit            | Spec value                     | Launch value                  |
| ---------------- | ------------------------------ | ----------------------------- |
| Anonymous read   | 200/hr per-IP                  | 100/hr per-IP                 |
| PATCH visibility | 60/hr per-user                 | 30/hr per-user                |
| Download         | 50/hr per-user + 100/hr per-IP | 25/hr per-user + 50/hr per-IP |

Tune up during bake based on real usage.

**Smoke checklist (do in this order, against prod, before announcing):**

1. Anonymous load of static `/` — 200, no errors
2. `/login` → Discord OAuth → callback → `/dashboard` round-trip (verifies
   the allowlisted Discord ID logs in successfully — see §7 secrets)
3. Upload one save — appears in `/games`
4. Toggle public on that game; load `/games/[id]` in a logged-out browser
5. Download the raw save back via the download endpoint
6. Re-import (simulated by bumping `parser_version` locally if needed)
7. Delete the test game

If any step fails, do not announce. Roll DNS back to the marketing-only
landing if one exists, or keep DNS unannounced until fixed.

---

## 8. Phase E — Bake

The bake exists to surface bugs before we burn the rollback path (Tauri
removal). It is **not** open-ended, and it splits into **two stages** because
the initial release ships behind the `ALLOWED_DISCORD_ID` allowlist (§7). A
solo user can't exercise the failure modes that diverse save shapes,
concurrent activity, and varied network conditions surface — so we bake
gated, expand the allowlist, then bake again with a small cohort before the
Tauri sweep.

### Stage 1: solo bake (gate on)

Only the allowlisted Discord ID can log in or upload. Anonymous reads on
public games still work (no session check), but the authenticated surface is
exercised by one person. Goal: catch obvious bugs and validate stability
under real personal use before inviting anyone else.

**Stage 1 exit criteria — all must hold:**

- **≥ 14 calendar days** of continuous availability
- **Real personal-use corpus uploaded** — every save the owner actually wants
  on the cloud has been imported successfully (the personal-use proxy for
  "I've kicked the tires on the flows I care about")
- **Zero P0 incidents.** P0 = data loss, auth bypass, PII leak, sustained
  5xx > 1% of requests, or any incident requiring a worker rollback
- **No unresolved P1 bugs.** P1 = breaks a user flow but has a workaround

A parser-version bump during stage 1 is **fine** — bug-fixing the parser is
expected here, and the share-blob shape doesn't need to be frozen until
stage 2 begins. Use stage 1 to settle the shape.

### Allowlist expand

Between stages: convert `ALLOWED_DISCORD_ID` from a single ID to a
comma-separated list of cohort members (5–10 invitees recommended). This
requires the small code-shape change in §12 (single equality → `Set<string>`
membership) and a `wrangler secret put` with the new value.

### Stage 2: cohort bake (allowlist expanded)

The cohort joins. Stage 2 catches what solo can't: diverse save shapes,
unusual Discord profile data, concurrent uploads, network conditions in
different regions.

**Stage 2 exit criteria — all must hold before Phase F1 ships:**

- **≥ 7 calendar days** of cohort bake (clock starts at allowlist expand)
- **≥ 50 successful uploads** from **≥ 5 distinct Discord users** (scaled
  down from the original ≥ 10 since the cohort itself is small; raise if
  you invite more)
- **≥ 200 public-share views** (any combination of authed + anonymous reads
  on `/games/[id]` — can accumulate during stage 1 too, but in practice
  stage 2 is when public games multiply)
- **Zero P0 incidents** during the stage 2 window
- **No unresolved P1 bugs**
- **Parser version unchanged** across stage 2 specifically — stage 2 is the
  cohort-validation pass on the share-blob shape that ships, so a parser
  bump resets the stage 2 clock (not the stage 1 one)

### What to do during either stage

Ship the §12 deferred follow-ups. They don't touch the rollback surface
(still no destructive removals), and they're easier to land while the Tauri
build is around as a sanity check.

If stage 1 surfaces a parser or share-blob bug, fix it during stage 1 —
re-baking the parser is cheap before the cohort joins. Don't let parser
churn leak into stage 2.

### What to monitor

- D1 query duration (especially `/v1/stats` and the `/games` library list)
- R2 read/write counts (cost watch)
- Worker CPU time (limits matter once free tier is exhausted)
- Rate-limit hit counts (informs the launch-vs-spec tuning in §7)
- Error rate split by route

---

## 9. Phase F — Tauri sweep

Split into **two PRs**, landed back-to-back. The single-commit approach is
cleaner for the diff but bad for bisect once it's in production.

### F1 — Drop Tauri runtime

Removes:

- `src-tauri/` (entire directory)
- `src/routes/game/[id]/` (Tauri-only route — note: `/games/[id]/` is the
  cloud route, different folder)
- `src/lib/Header.svelte`, `src/lib/GameSidebar.svelte`, `src/lib/ShareControl.svelte`
- Tauri-bound paths in `src/lib/api.ts` (or the whole file if it's all
  Tauri-bound — `api-cloud.ts` is the cloud one)
- Root-layout cloud-route gate in `src/routes/+layout.svelte` — every route
  is now a cloud route
- `__BUILD_TARGET__` constant + Vite `define` (no longer needed)
- `tauri.conf.json`, `Cargo.toml` at root if any, GitHub Actions workflows
  that build Tauri artifacts
- `npm run tauri:*` scripts from `package.json`

This is the load-bearing change. If anything regresses (a stale Tauri import
nobody noticed, a CSS rule that depended on Tauri-only chrome, a desktop
asset path that bled into the cloud build), we want a small, focused revert.

**Pre-merge check:** `git grep -i tauri src/ static/ cloud/` — should return
zero hits other than this PR's own removal commits.

### F2 — Drop parity harness + Rust dump binary

Removes:

- `scripts/parity/` (harness no longer has a Rust counterpart to compare to)
- `src-tauri/src/bin/dump_parsed.rs` (lives in `src-tauri/` which F1 already
  killed — this entry is for if we kept anything around for parity)
- `src-tauri/src/bin/dump_shared.rs` likewise
- Trim `docs/cloud-rewrite-spec.md` §2 "Parity Test Harness" to a one-paragraph
  historical note, or drop it

Lands ~1 week after F1. The delay is cheap insurance: if a desktop user (on
the Phase G build) reports a save that looks wrong on the cloud version, the
harness is the only thing that can re-prove parity. After a week of
uneventful production, it stops paying rent.

---

## 10. Phase G — Desktop preservation for end users

End users who prefer a local app, or who can't/won't use a hosted version,
need a runnable artifact. A git tag alone isn't a download; a download
without a tag isn't reproducible. We need both, and we need them **before
Phase F1 merges** so the tag points at a tree that still contains Tauri.

### G1. Tag the last desktop-capable commit

```bash
# from main, immediately before F1 merges:
git tag -a desktop-final -m "Last release with bundled Tauri desktop app.
The cloud app at https://per-ankh.app is the active project going forward."
git push origin desktop-final
```

Do **not** keep a long-lived `desktop-legacy` branch unless we commit to
backporting fixes. Unmaintained branches rot and confuse contributors. A tag
is immutable, free, and shows up in GitHub's UI under Tags.

### G2. Build the binaries

From a clean checkout of `desktop-final`:

```bash
git checkout desktop-final
npm ci
npm run tauri:build   # produces .dmg, .msi, .AppImage as configured
```

Repeat per platform if cross-builds aren't set up.

### G3. Disable the auto-updater first

Before the binaries are built, **disable Tauri's updater** in
`tauri.conf.json` for this build. If the updater stays enabled it will phone
home to update endpoints we'll later tear down, and the binary appears
broken to users. The desktop-final build needs to be self-contained.

### G4. Cut a GitHub Release

```bash
gh release create desktop-final \
  --title "Per-Ankh Desktop (final release)" \
  --notes-file docs/desktop-final-release-notes.md \
  src-tauri/target/release/bundle/dmg/*.dmg \
  src-tauri/target/release/bundle/msi/*.msi \
  src-tauri/target/release/bundle/appimage/*.AppImage
```

Release notes should say:

- This is the final bundled desktop release
- No future updates, including no security patches
- Cloud app lives at https://per-ankh.app
- Local DuckDB data stays local — no migration path, but users can re-upload
  save files via the web upload flow if they want their games on the cloud
- Link to the `desktop-final` tag for anyone who wants to fork

### G5. README link

Add a short section to the project README pointing at the latest release for
desktop users, plus the `https://per-ankh.app` link for the hosted app.

---

## 11. Rollback story

| Phase             | What's reversible | How                                                                                                                                                                                                            |
| ----------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A (merge)         | Fully             | Tauri build still works; cloud Worker not deployed                                                                                                                                                             |
| B (verification)  | N/A               | No code changes — operational checks against staging/throwaway infra                                                                                                                                           |
| C (atlases)       | Fully             | Tauri loads from local; cloud build URL is a constant                                                                                                                                                          |
| D (cutover)       | Mostly            | `ALLOWED_DISCORD_ID` gate keeps the surface area to one user, so a botched cutover doesn't expose anything; DNS-level rollback to landing page if catastrophic; D1 schema migrations are forward-only and stay |
| E (bake)          | Partially         | Same as D; users on desktop can still ignore cloud                                                                                                                                                             |
| F1 (Tauri drop)   | Code-reversible   | Revert PR; but users lose desktop binaries (G covers this)                                                                                                                                                     |
| F2 (harness drop) | Code-reversible   | Revert PR; harness is dev-only                                                                                                                                                                                 |
| G (release)       | Tag is permanent  | Cannot un-publish a release that's been downloaded                                                                                                                                                             |

The cliff is at Phase F1. Everything before it has a clean back-out;
everything after relies on Phase G having already cut a real download for
users who want desktop.

---

## 12. Smaller follow-ups

Tracked here so they don't clutter the sequencing above. All can ship during
Phase E (bake) since none touch the rollback surface.

| Item                                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dynamic per-game OG image                    | Per-nation crest + winner; satori + resvg-wasm Worker route. Replaces the static `og-default.png`                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `_routes.json` tuning                        | adapter-cloudflare warns about 292 dropped exclude rules; static asset paths invoke the SSR Worker unnecessarily. Easier after Phase C since the static boundary is clearer                                                                                                                                                                                                                                                                                                                                            |
| Real Discord/Slack/Twitter unfurl test       | Needs a deployed public URL — runs after Phase D                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Mobile-width header layout                   | `/games/[id]` header has 4 owner buttons + the new top `CloudHeader`; narrow screens may need a collapse menu                                                                                                                                                                                                                                                                                                                                                                                                          |
| Account-deletion path                        | Privacy compliance. Currently no UI to delete the user record + cascade to games + R2 blobs                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Unlink-Discord                               | Intentionally not offered today — Discord is the only auth provider, no recovery path. Add once a second provider exists                                                                                                                                                                                                                                                                                                                                                                                               |
| Retire/expand `ALLOWED_DISCORD_ID` allowlist | Single-ID gate added in `feat(cloud): gate login to a single Discord ID for initial release`. To open up: delete the gate in `handleDiscordCallback` + `handleMe` (both in `cloud/src/auth.ts`), drop `ALLOWED_DISCORD_ID` from `AuthEnv` + `Env` (auth.ts, index.ts), `wrangler secret delete ALLOWED_DISCORD_ID`. To expand to a beta cohort, swap to a comma-separated list + `Set<string>` membership instead                                                                                                      |
| Prune `anon_read` rows from `events`         | Anon-read rate limit writes one row per public-game view (D1 store, not Cache API). The hourly-window query only needs the last hour, so older rows are dead weight. Add a scheduled Worker (Cron Trigger) that runs `DELETE FROM events WHERE event_type = 'anon_read' AND created_at < datetime('now', '-2 hours')` daily, or shorter if D1 row count starts to matter during bake. Other event types (upload, delete, visibility_change, download) stay forever — they're audit log, not just rate-limit accounting |

---

## 13. Observability fast-follow

The cutover-blocking observability work in §4 (structured logs, PII rule,
audit completeness, CSP reporting) and §7 (Cloudflare alerts, Logpush sink)
is the floor — enough to know _when_ something is broken in production. The
items below are the polish that makes problems debuggable rather than just
detectable. Target: shipping within 2 weeks of cutover, during the bake
window or immediately after.

| Item                   | Notes                                                                                                                                                                               | Target |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Error tracking         | Sentry's Cloudflare SDK or Baselime (Cloudflare-acquired, native integration). Free tier covers a single-dev launch                                                                 | Week 1 |
| Synthetic uptime check | Cloudflare Health Checks or external pinger on `/v1/stats` every 1–5 min, page on failure. Catches DNS / certificate / whole-site-down failure modes that handler-level alerts miss | Week 1 |
| Real dashboard         | Cloudflare's built-in Worker Analytics, or Logpush → Grafana / Honeycomb / Baselime. Decide once the queries you actually want are clear                                            | Week 2 |
| 2–3 SLOs               | Recommend: `p95 anonymous read < 500ms`, `p95 upload < 10s`, `error rate < 0.5%`. Documents the bar so "is this a P1?" has a non-vibes answer. Don't pick five                      | Week 2 |

### Security follow (track but not blocking)

| Item                         | Notes                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependabot                   | Ten minutes; GitHub-native; covers npm + worker deps                                                                                                                                            |
| Audit-log review cadence     | Quarterly grep through `audit_events` for unusual patterns (mass deletes, high-frequency reimports, PATCHes from unexpected IPs)                                                                |
| Documented incident response | One paragraph naming P0/P1, the rollback levers (DNS revert, worker rollback, KV session bust), and a brief checklist. Solo-dev value is mostly future-you at 11pm in the middle of an incident |

---

## Appendix: Decisions parked here so we don't relitigate them

- **Resolve all #35 review findings before merge, not in follow-up PRs.**
  The Highs are 30-minute fixes; deferring them buys nothing and risks
  drift. Cleaner git history, and the same reviewer is doing all the work
  anyway, so there's no coordination cost to keeping them in #35.
- **Preserve commit history when merging #35 (no squash).** ~35 commits
  with per-feature granularity — useful for future bisects, especially
  around the TS parser port. Merge-commit or rebase-and-merge, not squash.
- **Merge before atlas migration, not after.** Atlas migration is a
  Cloudflare-side change with no impact on `main`'s buildability. Merging
  first means atlas work is small PRs, not a continually-rebasing branch.
- **Conservative launch rate limits, tuned up during bake.** Loosening is
  safe; tightening after abuse means kicking real users.
- **Tauri sweep as two PRs, not one.** Bisect cost > diff cleanliness once we
  have real users.
- **Tag + Release for desktop preservation, not a branch.** Branches imply
  active maintenance we aren't committing to.
- **Disable the auto-updater in `desktop-final` before building binaries.**
  Otherwise the final desktop build looks broken once the update endpoints
  are torn down.
- **Initial release ships with a single-user Discord ID allowlist
  (`ALLOWED_DISCORD_ID`, set out-of-band).** Lets us deploy publicly while
  limiting blast radius before bake. Legacy `/v1/share/*` is unaffected
  (no session check). The gate is fail-closed if the secret is missing,
  so prod must have it set before deploy. See §12 for retirement steps.
