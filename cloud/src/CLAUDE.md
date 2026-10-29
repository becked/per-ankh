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

## Cache posture on a new route

A shared cache sits **in front of** this Worker (`[cache]` in `cloud/wrangler.toml`), so on a hit the handler does not run — no auth check, no rate-limit spend, no audit row, no access-log line. Two platform facts make that a correctness concern and not a tuning one: an unheadered `200` gets 7200s of heuristic freshness, and `Cookie` is not in the cache key.

- **The posture is enforced, not conventional.** The wrapper in `index.ts` rewrites any response a shared cache could store, on a route that didn't declare `sharedCache`, to `private, no-store` before it leaves — so the failure mode of forgetting is a response that is privately cached rather than one that leaks. A handler that *wanted* a hit rate and didn't declare it logs `shared_cache_directive_forced`; that log line, not a leak, is the symptom to look for.
- `jsonResponse` already emits `private, no-store`, so a route that reaches for it inherits the safe posture and needs no thought. A handler that builds its own `Response` — a stream, or anything with a hand-written header block — inherits nothing from it, and should still set a directive: the reason is local to the response, and reads better there than inferred from the route table.
- A route whose body may be stored for *other viewers* declares `sharedCache` in the ROUTES table (`index.ts`) and takes an entry in `shared-cache-routes.test.ts`, which also pins the count of `public, max-age=…` sites per file. The bar is that the body does not depend on who asked, or that a `Vary` puts the dependence into the key (`GET /v1/games/:id` is the only one that needs the second form). The flag is what makes the handler's directive *reachable* — without it the response is served private.
- A shared-cacheable response carries no `X-Request-Id`: a stored entry outlives the request that filled it, so the header would replay one caller's id to everyone for the whole `s-maxage`, and a hit writes no access line to join it to.

Reads do **not** get a free pass for being read-only: `GET /v1/users/:user_id/stats` picks its scope off the session and includes the owner's private games, which is why it is `private` despite being the most cacheable-looking route on the API.

## Game / user identity & PII

- Each game records the uploader's nation (`user_nation`) and win flag (`user_won`) from the player the uploader claimed. Two writers, both deriving them the same way (`deriveUploaderColumns`): the upload picker, and the owner correcting a wrong pick afterwards via `uploader_player_index` on `PATCH /v1/games/:id`, which also moves the `player_summaries.is_uploader` flag and needs no reparse — the roster is already in the blob. Re-uploads from a different perspective still produce a new game record.
- Upload supports an "observer" mode (`uploaderIndex === null`) for tournament admins archiving matches or users uploading a friend's save. Server records nation and won as NULL, no `is_uploader=TRUE` rows, no `online_id` captured.
- Multiplayer games store `online_id` (Steam/GOG/Epic) per human player in the `player_roster` blob. For anonymous share viewers it is stripped via a deep walk (`stripOnlineIds`/`stripOnlineIdsDeep` in `cloud/src/games.ts`) before the blob is returned; owners keep it. `discord_id`/`username` live only in D1 metadata, never in the share blob. **Never put PII in a log field** — the `PII_KEYS` deny-list in `cloud/src/log.ts` is the last line of defense, not the first.
- Map pins (`pings`, 2.30.0+) are the only blob field carrying player-authored free text, and the read does not narrow them: a non-owner gets every seat's, like every other blob field. The save writes every seat's pins, including seats that did not write the file. So another player's note text is readable by anyone who can open a public game, with no moderation gate in front of it — unlike a screenshot, which is screened before anything is stored. `handleGameDownload` serves the same text by a second route: the original ZIP, every seat's `<Pings>` included, to any signed-in user once `is_public = 1`. The in-game team gate (`buildTileTooltipPingText`, `HelpText.Game.cs:5325-5332`) is a gate on a live game, where a note is a player's standing plan, and the save does not carry it. `MAX_PINGS` (`cloud/src/schemas/game.ts`) bounds the array at upload — that cap is about unbounded player-authored text, not about who reads it.

## Screenshots (`cloud/src/screenshots/`)

User-uploaded game screenshots, screened by a Clef classifier before anything is stored (issue #289). Four rules that aren't visible from the code that enforces them:

- **The request is the thresholds.** `clef.ts` holds the state string, the five questions and the conjunctive gate, and the eval (`npm run eval:screenshots`) imports them rather than restating them. The numbers in `BANDS` were fitted against that exact text on that exact model variant over `test-data/screenshots/` — so editing a question, or swapping `clef` for `clef-flash`, invalidates every band and means re-running the eval. They are code constants, not wrangler vars, because only a deploy can move the question and its band together.
- **A screenshot requires its game to be public,** which is what lets the objects be served from a cacheable public host with no per-request gate. Both writers enforce it: the upload endpoint refuses on a private game, and `handleGamePatch` refuses to unpublish a game that still has screenshots. Readers therefore filter on `hidden_at` only — don't add an `is_public` join.
- **The gate fails closed.** A classifier error, or an answer `readClefAnswers` can't narrow, refuses the upload. Clef returns a probability for anything rather than declining, so failing open would be a gate only while the model was up.
- **The test isolate has no `AI` binding.** Workers AI has no local simulator, so a declared `[ai]` binding makes the vitest pool open a remote proxy session against the account — fatal on a checkout that never ran `wrangler login`, and account-touching on one that did. `vitest.config.mts` strips the section from the config it builds the isolate from, and the tests replace `env.AI` with a stub; the long version is in that file. `wrangler dev` keeps the binding, so driving an upload locally spends real inference.

## Tournament engine

The tournament Worker code lives in `cloud/src/tournament/` — `admin.ts` (mutations), `public.ts` (reads), `player.ts`, and the engine: `seed.ts`, `pairing.ts`, `standings.ts`, `bracket.ts`, `export.ts`, `authz.ts`. Data model: `tournaments` (1) → `tournament_rounds` → `tournament_matches`; matches reference `tournament_slots` by id; `map_pool` is JSON on the tournament. For how tournaments actually *behave* (pairing, byes, divisions, advancement, tiebreakers, maps, reporting), the source of truth is `docs/tournament-rules.md` + the `tournament-rules` skill — keep the doc in sync with this engine; **code wins on conflict.**
