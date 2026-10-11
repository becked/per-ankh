# Cloud Worker (`cloud/src/`)

The Cloudflare Worker API. Handlers here, validation via Valibot in `cloud/src/schemas/`. Routing is hand-rolled (URL pattern matching) — **no router library**; follow the existing dispatch, don't add one.

## Fit before you write (worker-side)

The friction on past contributions was consistency, not correctness. Before adding code here:

- **Reuse the existing idiom.** Grep for a handler, validation schema, or SQL helper that already does what you need. Don't introduce a second way to route, validate, or serialize.
- **DRY the SQL.** Repeated fragments drift. A `MAX(match_number)+1`-style subquery copy-pasted into several insert sites will silently diverge (one site drops a guard the others have). Extract it once.
- **Guards apply to every writer/reader of a shared field.** If a CAS/`_rev` conditional-write guard protects a field, *every* path that writes it must participate — a new admin/participant endpoint is the one unguarded writer that erases concurrent edits. Likewise, if a rate-limit budget exists, every reader that consumes it must also *record* to it, or the limit is a no-op on that path.
- **Typed return contracts must match what's actually serialized.** Don't declare a handler returns `TournamentMatch` while it returns an un-serialized DB row — return `serializeMatch(...)` output or narrow the declared type.
- **Wire new things into every registration point a sibling uses** — the seed planner/CLI, all call sites, not just the primary path.

## Generated files

`cloud/src/generated/*` and `cloud/src/momentum.ts` are written by `scripts/bake-*.ts` — never edit them by hand. `momentum.ts` mirrors the frontend scorer `src/lib/game-detail/momentum.ts`; edit that file and regenerate with `npm run bake:momentum -- --mirror-only` (a regeneration test fails on drift).

## Worker tests

Two-project Vitest setup (`cloud/vitest.config.mts`):

- **unit** — pure-function `*.test.ts` beside source, on the default Node pool (~ms per test).
- **integration** — handler tests inside a Miniflare Worker isolate with real D1/KV/R2 bindings (`@cloudflare/vitest-pool-workers`). Migrations are applied per-file in `beforeAll`. Lives under `cloud/test/integration/` (mostly tournament: flow, round generation, championship transition, signup, beta-gate, rate-limit, audit-log). Request helpers in `cloud/test/helpers/` (`requests.ts` wraps `SELF.fetch` with auth conventions; `builders.ts` seeds users/tournaments).

Run from `cloud/`: `npm test` (both projects), or filter with `--project unit` / `--project integration`. `npm run test:watch` for watch mode.

## D1 migrations

- `cloud/migrations/` is numbered (`0001_*.sql`, `0002_*.sql`, …) and **forward-only. There is no `down`.**
- Apply locally: `(cd cloud && npm run migrate:local)`.
- Applying to staging/remote is a deploy step — see the `deploy` skill (rehearse on staging before prod). Never run `migrate:remote`/`migrate:staging` unprompted.
- A **second** D1 (`SECURITY_DB`, the Skiff security-events drain) has its own migrations dir `cloud/migrations-security/`, applied out-of-band via `npm run migrate:security:{local,remote,staging}`. It is **deliberately not** wired into `./per-ankh prod deploy` (which targets `SHARE_DB` only) — apply it by hand. See `docs/security-events.md`.

## Bumping `PARSER_VERSION`

When you bump `PARSER_VERSION` in `src/lib/parser/types.ts`, also add the new string to `KNOWN_PARSER_VERSIONS` in `cloud/src/schemas/game.ts` with a one-line changelog entry above the set. The Worker rejects unknown versions with `INVALID_BLOB: Unknown parser_version`, so a frontend that ships ahead of the Worker breaks all uploads. **Deploy ordering: Worker first, frontend second.**

## Bumping `BUNDLE_SCHEMA_VERSION`

The stats bundle's cache-flush lever (`cloud/src/stats/cache.ts`). **Don't edit the constant** — it's derived as the highest key of the `BUNDLE_SCHEMA_CHANGELOG` table right above it, so you bump it by adding an entry saying what changed. Bump whenever the `ChartBundle` gains or loses a field: entries live 24h and consumers dereference every field directly, so a frontend deployed behind the Worker would read a pre-field bundle and blow up on it. A chart drawn from fields the bundle already carries needs no bump. The value is deliberately **not** restated in `docs/aggregate-statistics.md` — it sat four versions stale there across four stats PRs, so don't reintroduce it.

## Events retention

A nightly cron (03:47 UTC, `[triggers]` in `cloud/wrangler.toml`) prunes the `events` table per the policy in `cloud/src/retention.ts`: 24h for rate-limit counters, 90d for general audit, never for tournament audit. Three rules when touching events:

- **Adding a new `event_type`:** give it a home in `retention.ts` (a bucket or `KEEP_FOREVER`). Unlisted types are never deleted and are logged nightly as `unknown_types` until a policy decision is made.
- **Adding a reader of `events`:** its query window must fit inside the type's retention bucket — the floors are pinned in `cloud/src/retention.test.ts` (rate-limit reads 1h, admin stats 30d); raise them there if a longer window is needed.
- **Query `events` through `env.EVENTS_DB`, never `env.SHARE_DB`.** `EVENTS_DB` is always the primary binding; `SHARE_DB` may be a D1 read-replication session on routes flagged `staleTolerant`. A replica read only sees what the session's bookmark covers, so a rate-limit `COUNT(*)` misses whatever a concurrent request just committed — an under-count, so limits fail **open** — and an audit INSERT on the session would anchor its bookmark forward and drag the rest of the handler's reads back to the primary. Helpers that count events take a real `D1Database` so a session handle won't compile; keep it that way. The rationale is in `cloud/src/d1.ts`, and the one documented exception is pinned by the guard, `cloud/src/stale-tolerant-routes.test.ts`.

## Game / user identity & PII

- Each game records the uploader's nation (`user_nation`) and win flag (`user_won`) at upload time. Re-uploads from a different perspective produce a new game record.
- Upload supports an "observer" mode (`uploaderIndex === null`) for tournament admins archiving matches or users uploading a friend's save. Server records nation and won as NULL, no `is_uploader=TRUE` rows, no `online_id` captured.
- Multiplayer games store `online_id` (Steam/GOG/Epic) per human player in the `player_roster` blob. For anonymous share viewers, `online_id` is the **only** blob field stripped — via a deep walk (`stripOnlineIds`/`stripOnlineIdsDeep` in `cloud/src/games.ts`) before the blob is returned; owners keep it. `discord_id`/`username` live only in D1 metadata, never in the share blob. **Never put PII in a log field** — the `PII_KEYS` deny-list in `cloud/src/log.ts` is the last line of defense, not the first.

## Screenshots (`cloud/src/screenshots/`)

User-uploaded game screenshots, screened by a Clef classifier before anything is stored (issue #289). Four rules that aren't visible from the code that enforces them:

- **The request is the thresholds.** `clef.ts` holds the state string, the five questions and the conjunctive gate, and the eval (`npm run eval:screenshots`) imports them rather than restating them. The numbers in `BANDS` were fitted against that exact text on that exact model variant over `test-data/screenshots/` — so editing a question, or swapping `clef` for `clef-flash`, invalidates every band and means re-running the eval. They are code constants, not wrangler vars, because only a deploy can move the question and its band together.
- **A screenshot requires its game to be public,** which is what lets the objects be served from a cacheable public host with no per-request gate. Both writers enforce it: the upload endpoint refuses on a private game, and `handleGamePatch` refuses to unpublish a game that still has screenshots. Readers therefore filter on `hidden_at` only — don't add an `is_public` join.
- **The gate fails closed.** A classifier error, or an answer `readClefAnswers` can't narrow, refuses the upload. Clef returns a probability for anything rather than declining, so failing open would be a gate only while the model was up.
- **The test isolate has no `AI` binding.** Workers AI has no local simulator, so a declared `[ai]` binding makes the vitest pool open a remote proxy session against the account — fatal on a checkout that never ran `wrangler login`, and account-touching on one that did. `vitest.config.mts` strips the section from the config it builds the isolate from, and the tests replace `env.AI` with a stub; the long version is in that file. `wrangler dev` keeps the binding, so driving an upload locally spends real inference.

## Tournament engine

The tournament Worker code lives in `cloud/src/tournament/` — `admin.ts` (mutations), `public.ts` (reads), `player.ts`, and the engine: `seed.ts`, `pairing.ts`, `standings.ts`, `bracket.ts`, `export.ts`, `authz.ts`. Data model: `tournaments` (1) → `tournament_rounds` → `tournament_matches`; matches reference `tournament_slots` by id; `map_pool` is JSON on the tournament. For how tournaments actually *behave* (pairing, byes, divisions, advancement, tiebreakers, maps, reporting), the source of truth is `docs/tournament-rules.md` + the `tournament-rules` skill — keep the doc in sync with this engine; **code wins on conflict.**
