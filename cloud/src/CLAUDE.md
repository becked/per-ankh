# Cloud Worker (`cloud/src/`)

The Cloudflare Worker API. Handlers here, validation via Valibot in `cloud/src/schemas/` and `cloud/src/validation.ts`. Routing is hand-rolled (URL pattern matching) — **no router library**; follow the existing dispatch, don't add one.

## Fit before you write (worker-side)

The friction on past contributions was consistency, not correctness. Before adding code here:

- **Reuse the existing idiom.** Grep for a handler, validation schema, or SQL helper that already does what you need. Don't introduce a second way to route, validate, or serialize.
- **DRY the SQL.** Repeated fragments drift. A `MAX(match_number)+1`-style subquery copy-pasted into several insert sites will silently diverge (one site drops a guard the others have). Extract it once.
- **Guards apply to every writer/reader of a shared field.** If a CAS/`_rev` conditional-write guard protects a field, *every* path that writes it must participate — a new admin/participant endpoint is the one unguarded writer that erases concurrent edits. Likewise, if a rate-limit budget exists, every reader that consumes it must also *record* to it, or the limit is a no-op on that path.
- **Typed return contracts must match what's actually serialized.** Don't declare a handler returns `TournamentMatch` while it returns an un-serialized DB row — return `serializeMatch(...)` output or narrow the declared type.
- **Wire new things into every registration point a sibling uses** — the seed planner/CLI, all call sites, not just the primary path.

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

## Events retention

A nightly cron (03:47 UTC, `[triggers]` in `cloud/wrangler.toml`) prunes the `events` table per the policy in `cloud/src/retention.ts`: 24h for rate-limit counters, 90d for general audit, never for tournament audit. Two rules when touching events:

- **Adding a new `event_type`:** give it a home in `retention.ts` (a bucket or `KEEP_FOREVER`). Unlisted types are never deleted and are logged nightly as `unknown_types` until a policy decision is made.
- **Adding a reader of `events`:** its query window must fit inside the type's retention bucket — the floors are pinned in `cloud/src/retention.test.ts` (rate-limit reads 1h, admin stats 30d); raise them there if a longer window is needed.

## Game / user identity & PII

- Each game records the uploader's nation (`user_nation`) and win flag (`user_won`) at upload time. Re-uploads from a different perspective produce a new game record.
- Upload supports an "observer" mode (`uploaderIndex === null`) for tournament admins archiving matches or users uploading a friend's save. Server records nation and won as NULL, no `is_uploader=TRUE` rows, no `online_id` captured.
- Multiplayer games store `online_id` (Steam/GOG/Epic) per human player in the `player_roster` blob. For anonymous share viewers, `online_id` is the **only** blob field stripped — via a deep walk (`stripOnlineIds`/`stripOnlineIdsDeep` in `cloud/src/games.ts`) before the blob is returned; owners keep it. `discord_id`/`username` live only in D1 metadata, never in the share blob. **PII is never logged.**

## Tournament engine

The tournament Worker code lives in `cloud/src/tournament/` — `admin.ts` (mutations), `public.ts` (reads), `player.ts`, and the engine: `seed.ts`, `pairing.ts`, `standings.ts`, `bracket.ts`, `export.ts`, `authz.ts`. Data model: `tournaments` (1) → `tournament_rounds` → `tournament_matches`; matches reference `tournament_slots` by id; `map_pool` is JSON on the tournament. For how tournaments actually *behave* (pairing, byes, divisions, advancement, tiebreakers, maps, reporting), the source of truth is `docs/tournament-rules.md` + the `tournament-rules` skill — keep the doc in sync with this engine; **code wins on conflict.**
