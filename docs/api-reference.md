# API Reference

The Per-Ankh HTTP API — the Cloudflare Worker under `cloud/`, served at `https://api.per-ankh.app`.

**Reflects deployed release `2026-07-07-0fdd309`** (commit `5ded63e`, generated 2026-07-08). Endpoint set and behavior are pinned to that release; when the code and this doc disagree, **the code wins** — file a fix against this doc.

This reference is drift-guarded: `cloud/src/routes-doc.test.ts` asserts it documents exactly the routes registered in the `ROUTES` table (`cloud/src/index.ts`) — one `### ` heading per route, no more and no fewer. Adding, renaming, or removing an endpoint fails that test until this doc is updated in the same change.

## Contents

- [Conventions](#conventions) — base URL, auth tiers, error envelope, identifiers, rate limits, CORS, PII
- [Authentication](#authentication----v1auth) — `/v1/auth/*`
- [Games](#games----v1games) — `/v1/games/*`
- [Collections](#collections----v1collections) — `/v1/collections`
- [Users & profiles](#users--profiles) — `/v1/users/*` (public)
- [Account](#account) — `/v1/users/me/online-ids`, settings
- [Tournaments — reads](#tournaments--reads)
- [Tournaments — lifecycle & configuration](#tournaments--lifecycle--configuration)
- [Tournaments — slots](#tournaments--slots)
- [Tournaments — matches](#tournaments--matches)
- [Tournaments — admins](#tournaments--admins)
- [Tournaments — player self-service](#tournaments--player-self-service)
- [Tournament export](#tournament-export)
- [Site admin: games](#site-admin-games) — `/v1/admin/games/*`
- [Diagnostics](#diagnostics) — `/v1/csp-report`
- [Legacy share](#legacy-share) — `/v1/share/*` (frozen)

---

## Conventions

### Base URL & environments

| Environment | API base |
| --- | --- |
| Production | `https://api.per-ankh.app` |
| Staging | `https://api-staging.per-ankh.app` |
| Local dev | `http://localhost:8787` |

All paths are versioned under `/v1`. The frontend client (`src/lib/api-cloud.ts`) defaults to `https://api.per-ankh.app/v1`.

### Authorization tiers

Auth is enforced inside each handler (not declared on the route). Every endpoint below is tagged with one of:

- **Public** — no session required; reachable by any client (including non-browser clients, which ignore CORS).
- **Public (owner extras)** — works anonymously, but a valid session widens the response: the owner sees their private games, tournament admins see admin-only fields. Anonymous callers see the public-only shape.
- **Session** — any logged-in user. Anonymous → `401 UNAUTHORIZED`.
- **Site admin** — the `ADMIN_DISCORD_ID` secret. Non-admins get `404` (existence hidden) unless noted otherwise.
- **Tournament admin** — the tournament's creator or a granted co-admin (`requireTournamentAdmin`). Non-admins → `403 NOT_TOURNAMENT_ADMIN`.
- **Tournament creator** — creator or site admin only (co-admins excluded).
- **Match participant** — either match slot's claiming user (a fallback tier on the schedule endpoint).
- **Beta** — the tournament-create allowlist (`isTournamentBeta`). Gates tournament creation only.
- **App key (legacy)** — the frozen `/v1/share/*` surface; authenticated by `X-App-Key` / `X-Delete-Token` headers, not the session cookie.

### Authentication model

Auth is a session cookie (name `session`; `session_staging` on staging), `Domain=per-ankh.app`, `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS, 30-day TTL, backed by KV. Obtain it via the Discord OAuth flow (`POST /v1/auth/discord/start` → Discord → `POST /v1/auth/discord/callback`), or locally via `GET /v1/auth/dev/login` (disabled on HTTPS). `is_admin` / `is_beta` on `GET /v1/auth/me` are advisory for frontend gating only — the Worker re-checks server-side on every privileged call.

### Request format

- JSON bodies: `Content-Type: application/json`. Non-JSON where a body is required → `415 UNSUPPORTED_MEDIA_TYPE`; malformed JSON → `400 INVALID_JSON`; schema failure (Valibot) → `400 INVALID_BODY`.
- `POST /v1/games` and `POST /v1/admin/games/:user_id/reparse-upload` take `multipart/form-data`.
- `POST /v1/share` (legacy) takes a gzip binary body.

### Response & error envelope

Success bodies are endpoint-specific JSON (or a binary stream for downloads/exports). Errors are `{ "error": string, "code"?: string }`, with optional extra fields (e.g. `qualifier_count`). Every response carries an `X-Request-Id` header; unhandled `500`s also include `request_id` in the body. **Legacy `/v1/share/*` errors are `{ "error": string }` only — no `code`.**

### Identifiers

- Game, tournament, slot, match, user ids are **21-char nanoids** (`[A-Za-z0-9_-]{21}`).
- Tournament **slugs** match `^[a-z0-9][a-z0-9-]{0,63}$`. Note `GET /v1/tournaments/:slug` is the one read keyed by slug; every other per-tournament route uses the 21-char id.
- Match **part** ids are `[A-Za-z0-9_-]{1,40}`.

### Rate limiting

Counters live in the D1 `events` table (or the Cache API for legacy downloads) and are keyed per-user, per-IP, or globally depending on the endpoint. Notable buckets:

| Bucket | Limit | Applies to |
| --- | --- | --- |
| `anon_read` | 200 / hr per IP | anonymous game reads (`GET /v1/games/:id`, `public-recent`) |
| `tournament_view` | 600 / hr per IP | anonymous tournament reads |
| `tournament_export` | 30 / hr per user | `GET /v1/tournaments/:id/export` |
| `tournament_admin` | 30 / hr per user | tournament admin mutations |
| `tournament_schedule` | 60 / hr per user | match schedule + caster self-service |
| `tournament_create` | 5 / hr per user | `POST /v1/tournaments` |
| user search | 60 / hr per user | `GET /v1/users/search` |
| upload / download | per-user + per-IP + global | game upload / download |

Over-limit → `429` with an endpoint-specific `code`. Known scraper User-Agents are exempt from the anonymous read/view limits (and their audit rows).

### CORS

Cloud paths use **credentialed, echo-Origin** CORS (the request `Origin` is reflected when in `ALLOWED_ORIGINS = https://per-ankh.app, http://localhost:1420`) so cookies traverse `per-ankh.app ↔ api.per-ankh.app`. Legacy `/v1/share/*` uses **single-origin** CORS (`ALLOWED_ORIGIN`). CORS is browser-enforced only; a non-browser client is unaffected.

### PII

`online_id` (Steam/GOG/Epic) is stripped from game blobs for non-owner viewers via a deep walk (`stripOnlineIds`). The raw save ZIP retains it, which is why `GET /v1/games/:id/download` requires a session while the JSON `GET /v1/games/:id` serves public games anonymously. `discord_id` / `discord_username` appear only in admin-tier tournament responses, never in public payloads. PII is never logged.

---

## Authentication — `/v1/auth/*`

### `POST /v1/auth/discord/start`
Begin the Discord OAuth (PKCE) flow.

- **Auth:** Public
- **Body:** JSON `{ redirect_uri: string, next?: string }`. `redirect_uri` required and must be an allowed origin + exactly `/auth/callback`; `next` is sanitized to a same-origin path.
- **Response 200:** `{ authorize_url: string }`; sets a short-lived `oauth_pending` cookie (5-min TTL).
- **Errors:** `400 INVALID_BODY`, `400 MISSING_REDIRECT_URI`, `400 INVALID_REDIRECT_URI`.
- **Notes:** Uses PKCE S256 + `prompt=none`. Pending state stored in KV for 300s.

### `POST /v1/auth/discord/callback`
Exchange the OAuth code for a session.

- **Auth:** Public (this call establishes the session).
- **Body:** JSON `{ code: string, state: string, redirect_uri: string }` (all required); also requires the `oauth_pending` cookie. `state` and `redirect_uri` are checked against the pending KV entry (timing-safe).
- **Response 200:** `{ user_id, discord_id, display_name, avatar_url, next }`; sets the session cookie and clears `oauth_pending`.
- **Errors:** `400` (`INVALID_BODY`, `MISSING_FIELDS`, `MISSING_PENDING`, `PENDING_NOT_FOUND`, `STATE_MISMATCH`, `REDIRECT_URI_MISMATCH`), `500 CORRUPT_PENDING`, `502` (`TOKEN_EXCHANGE_FAILED`, `NO_ACCESS_TOKEN`, `USER_FETCH_FAILED`, `NO_USER_ID`), `500 UPSERT_FAILED`.
- **Notes:** Pending entry is single-use (read-then-deleted). On first-ever login, seeds a `Personal` collection, pins beta status, and claims any pre-linked tournament slots. Writes a `login` audit event.

### `GET /v1/auth/me`
Current session's user profile.

- **Auth:** Session.
- **Response 200:** `{ user_id, discord_id, display_name, discord_username, avatar_url, is_beta: boolean, is_admin: boolean, default_game_public: boolean }`.
- **Errors:** `401 UNAUTHORIZED` (also if the session points at a deleted user, which clears the cookie).
- **Notes:** Re-claims pre-linked tournament slots on every call. `is_beta`/`is_admin` are advisory (frontend gating); the server re-checks per endpoint.

### `GET /v1/auth/dev/login`
Local-only login bypass (no Discord).

- **Auth:** Local only — returns `404 NOT_FOUND` unless `DEV_LOGIN` is set **and** the request is non-HTTPS. Dark in production.
- **Query:** `discord_id` (required, numeric snowflake ≤20 digits), `username` (required, ≤32, lowercased), `display_name` (optional, ≤64), `next` (optional, sanitized).
- **Response:** `302` redirect to `<frontendOrigin><next>` with the session cookie set.
- **Errors:** `404 NOT_FOUND`, `400 VALIDATION_ERROR`, `500 UPSERT_FAILED`.
- **Notes:** Also grants tournament beta (note `dev-login`) and seeds the `Personal` collection. See `docs/dev-login.md`.

### `POST /v1/auth/settings`
Update account settings.

- **Auth:** Session.
- **Body:** `UserSettingsSchema` — `{ default_game_public: boolean }` (required). Default visibility applied to newly uploaded saves.
- **Response 200:** `{ default_game_public: boolean }`.
- **Errors:** `401 UNAUTHORIZED`, `400 INVALID_JSON`, `400 INVALID_BODY`.

### `POST /v1/auth/logout`
End the current session.

- **Auth:** Public / idempotent — deletes the session if present; anonymous calls still succeed.
- **Response:** `204 No Content`; clears the session cookie.
- **Notes:** Writes a `logout` audit event only when a real session was torn down.

---

## Games — `/v1/games/*`

### `POST /v1/games`
Upload (or re-import) a parsed save.

- **Auth:** Session.
- **Body:** `multipart/form-data` — `data` (gzipped `FullGameData` JSON, ≤10 MB compressed / ≤50 MB decompressed, validated against `FullGameDataSchema`: `version` literal `2`, `parser_version` in `KNOWN_PARSER_VERSIONS`), `save` (raw ZIP, ≤50 MB), `uploader_player_index` (JSON `number | null`; `null` = observer mode). Optional: `tournament_match_id` (21-char), `tournament_slot_a_player_index` / `tournament_slot_b_player_index` (required for observer/admin tournament uploads).
- **Response:** `201 { game_id, url }` on first upload; `200 { game_id, url, reimported: true, from_version, to_version }` on re-import; `200 { game_id, url, tournament_match_reported: true }` when a dedup-hit relinks a match.
- **Errors:** `400` (many: `INVALID_FORM`, `MISSING_DATA`, `MISSING_SAVE`, `MISSING_INDEX`, `INVALID_BLOB`, `NOT_COMPLETED`, `UNKNOWN_PLAYER_INDEX`, observer/slot-mapping codes…), `401 UNAUTHORIZED`, `403 NOT_MATCH_PARTICIPANT`, `404 MATCH_NOT_FOUND`, `409` (`DUPLICATE`, `TOURNAMENT_COMPLETE`, `WRONG_HUMAN_COUNT`, `NO_WINNER`, `WINNER_NOT_IN_MATCH`, `UPLOADER_LOCKED_TOURNAMENT`), `413` (`BLOB_TOO_LARGE`, `ZIP_TOO_LARGE`, `DECOMPRESSED_TOO_LARGE`), `429` (`RATE_LIMIT_USER` / `_IP` / `_GLOBAL`), `500` (`R2_FAILED`, `D1_FAILED`).
- **Notes:** Unknown `parser_version` → `400 INVALID_BLOB` (deploy Worker before frontend). Only completed games (`game_over`) accepted. Dedup keyed on SHA-256 of the raw ZIP per `(user_id, file_hash)`: same/older parser version → `409 DUPLICATE`, newer → re-import. Observer mode records `user_nation`/`user_won` NULL and captures no `online_id`. Tournament-linked uploads are forced `is_public=1` and moved to a `Tournament: {name}` collection.

### `GET /v1/games`
List a user's games (search + filters + scope).

- **Auth:** Public (owner extras). With `?user_id`, session is optional and a non-owner/anonymous viewer is restricted to `is_public=1`. Without `?user_id`, a session is required (lists the caller's own library).
- **Query:** `user_id` (21-char), `limit` (default 50, max 500), `offset` (default 0), `scope` (`all`|`public`|`vs_ai`|`mp`|`tournament`|`<collection_id>`), `q` (free-text), `nation`, `date` (`YYYY-MM-DD`), `result` (`win`|`loss`), `sort` (default `date_desc`).
- **Response 200:** `GameListResponse` — `{ games: GameListItem[], total: number }`.
- **Errors:** `400 INVALID_USER_ID`, `401 UNAUTHORIZED`.

### `GET /v1/games/public-recent`
Most-recent public games across all users (home-page feed).

- **Auth:** Public. Serves `is_public=1` rows only.
- **Response 200:** `PublicRecentGamesResponse` — `{ games: PublicRecentGame[] }` (≤20), each with uploader identity and per-player `vp_series` points.
- **Errors:** `429 RATE_LIMIT`.
- **Notes:** `anon_read` bucket (200/hr per IP; scraper UAs exempt). Only `display_name`/`player_name` exposed — no `online_id`/email. Cached `public, max-age=300, s-maxage=60`.

### `GET /v1/games/out-of-date`
The caller's games whose `parser_version` differs from a target (drives bulk reparse).

- **Auth:** Session (scoped to the caller).
- **Query:** `version` (required).
- **Response 200:** `{ games: [...], total }` (GameListItem-shaped). Not paginated.
- **Errors:** `401 UNAUTHORIZED`, `400 INVALID_QUERY`.

### `GET /v1/games/:id/download`
Download the raw save ZIP.

- **Auth:** Session (any logged-in user). The game must be `is_public=1` **or** the caller must be the owner, else `404` (hides existence).
- **Path:** `id` (21-char).
- **Response 200:** `application/zip` stream with `Content-Disposition`; `Cache-Control: private, max-age=300`.
- **Errors:** `401 UNAUTHORIZED`, `404` (`NOT_FOUND`, `BLOB_MISSING`), `429` (`RATE_LIMIT_USER` / `_IP`).
- **Notes:** Auth-gated because the ZIP retains `online_id` (the JSON GET strips it for anon). `download` bucket: 50/hr per user, 100/hr per IP.

### `GET /v1/games/:id`
Fetch the parsed game blob (JSON).

- **Auth:** Public (owner extras). Owner always allowed; non-owner only if `is_public=1`; anonymous on a private game → `401`, signed-in non-owner on a private game → `403`.
- **Path:** `id` (21-char).
- **Response 200:** the stored `FullGameData` JSON with injected top-level fields (`user_id`, `user_nation`, `uploader_nation`, `user_won`, `user_display_name`, `display_name`); owner additionally gets `is_public`.
- **Errors:** `404` (`NOT_FOUND`, `BLOB_MISSING`), `401 UNAUTHORIZED`, `403 FORBIDDEN`, `429 RATE_LIMIT`.
- **Notes:** Non-owner viewers get `online_id` stripped from the blob. Anonymous reads consume the `anon_read` bucket (200/hr per IP). Owner responses are `private, no-store`; public responses `public, max-age=3600, s-maxage=60` with `Vary: Cookie, Origin`.

### `GET /v1/games/:id/tournament-link`
Whether a game is linked to a tournament match.

- **Auth:** Public (IP rate-limited).
- **Path:** `id` (21-char).
- **Response 200:** `{ link: GameTournamentLink | null }` — `link.tournament` `{ tournament_id, slug, name, status }` + `link.match` `{ match_id, phase, division, round_number, map_script, status, slot_a_id, slot_b_id, winner_slot_id, slot_a_display_name, slot_b_display_name }`; `{ link: null }` when unlinked.
- **Errors:** `429 RATE_LIMIT_TOURNAMENT_VIEW`.
- **Notes:** `tournament_view` bucket (600/hr per IP; scraper UAs exempt).

### `PATCH /v1/games/:id`
Update a game's visibility, collection, or display name.

- **Auth:** Session + owner. Non-owner or missing game → `404` (does not distinguish).
- **Path:** `id` (21-char).
- **Body:** `GamePatchSchema` (all optional, ≥1 required) — `is_public` (boolean), `collection_id` (`number | null`, ≥1), `display_name` (`string | null`, 1–120 trimmed).
- **Response 200:** echoes only the supplied fields — `{ game_id, is_public?, collection_id?, display_name? }`.
- **Errors:** `401 UNAUTHORIZED`, `404 NOT_FOUND` (non-owner / missing / non-owned `collection_id`), `400` (`INVALID_JSON`, `INVALID_BODY`), `409 LINKED_TO_ACTIVE_TOURNAMENT`, `429 RATE_LIMIT_USER`.
- **Notes:** `is_public` toggle rate-limited (`visibility_change`, 60/hr). Cannot set `is_public=false` while the game is linked to a non-`complete` tournament match.

### `DELETE /v1/games/:id`
Delete a game and its blobs.

- **Auth:** Session + owner. Missing game → `404`; non-owner → `403 FORBIDDEN` (note: leaks existence, unlike PATCH).
- **Path:** `id` (21-char).
- **Response:** `204 No Content`.
- **Errors:** `401 UNAUTHORIZED`, `404 NOT_FOUND`, `403 FORBIDDEN`, `409 LINKED_TO_ACTIVE_TOURNAMENT`.
- **Notes:** Blocked while linked to any tournament whose status ≠ `complete`. Deletes R2 objects then the D1 row (child tables cascade).

---

## Collections — `/v1/collections`

### `GET /v1/collections`
List a user's collections + scope counts.

- **Auth:** Public (owner extras) with `?user_id`; Session required without it. A non-owner viewer gets `collections: []` and public-only `scope_counts`.
- **Query:** `user_id` (21-char, optional).
- **Response 200:** `{ collections: [{ collection_id, name, is_default, game_count }], scope_counts: { all, public, vs_ai, mp, tournament } }`.
- **Errors:** `400 INVALID_USER_ID`, `401 UNAUTHORIZED`.

### `POST /v1/collections`
Create a collection.

- **Auth:** Session.
- **Body:** `CreateCollectionSchema` — `{ name: string }` (trimmed, 1–64).
- **Response 201:** `{ collection_id, name, is_default: false, game_count: 0 }`.
- **Errors:** `401 UNAUTHORIZED`, `400` (`INVALID_JSON`, `INVALID_BODY`), `409 DUPLICATE_NAME`, `500 INSERT_FAILED`.

---

## Users & profiles

### `GET /v1/users/search`
Autocomplete users (for slot creation).

- **Auth:** Session.
- **Query:** `q` (trimmed, lowercased, 1–32; results only when ≥2 chars), `limit` (1–20, default 10).
- **Response 200:** `{ users: [{ user_id, discord_id, discord_username, display_name }] }` (empty when `q<2`).
- **Errors:** `401 UNAUTHORIZED`, `429 RATE_LIMIT_USER_SEARCH` (60/hr per user), `400 VALIDATION_ERROR`.
- **Notes:** Only these four identity fields — no email, avatar, or timestamps.

### `GET /v1/users/:user_id`
Public profile + all-time summary.

- **Auth:** Public (owner extras) — the owner's summary includes private games; others/anon see public-only.
- **Path:** `user_id` (21-char).
- **Response 200:** `{ user_id, display_name, avatar_url, summary: { total_games, win_rate: number|null, favorite_nation: string|null, favorite_day_of_week: number|null } }`.
- **Errors:** `404 NOT_FOUND`.
- **Notes:** Summary is all-time over all saves (ignores any scope selector).

### `GET /v1/users/:user_id/stats`
User-corpus aggregate stats bundle.

- **Auth:** Public (owner extras) — owner (`self`) corpus includes private games; visitor/anon forced to public.
- **Path:** `user_id` (21-char).
- **Query:** `scope` (default `all`; `public`|`vs_ai`|`mp`|`tournament`|`<collection_id>`; collection and `public` narrowing are owner-only).
- **Response 200:** `ChartBundle` — `ChartBundleCore` (meta, summary, nations, win rates, yield curves, law/tech timing…) plus user-only `win_rate` and `games_with_outcome`.
- **Errors:** `400 INVALID_USER_ID`, `404 NOT_FOUND`.
- **Notes:** KV-cached, keyed on `{ user_id, viewerScope, scope, parser_version }`.

---

## Account

### `GET /v1/users/me/online-ids`
List the caller's captured multiplayer online ids.

- **Auth:** Session.
- **Response 200:** `{ online_ids: string[] }`.
- **Errors:** `401 UNAUTHORIZED`.

### `DELETE /v1/users/me/online-ids/:id`
Forget one online id.

- **Auth:** Session.
- **Path:** `id` — the URL-encoded `online_id` value (no format constraint).
- **Response:** `204 No Content` (idempotent).
- **Errors:** `401 UNAUTHORIZED`.
- **Notes:** Scoped to the caller's own row; re-uploading a save re-links the id.

_(Account settings live at [`POST /v1/auth/settings`](#post-v1authsettings).)_

---

## Tournaments — reads

All reads in this section are **Public (owner extras)** unless noted: a session is optional and only unlocks admin/owner fields; anonymous callers see the public shape. Setup-phase tournaments return a `404`-shape to non-admins (unless signups are open). All are per-IP rate-limited via the `tournament_view` bucket (600/hr; `429 RATE_LIMIT_TOURNAMENT_VIEW`), and all take the 21-char tournament `id` **except** detail-by-slug.

### `GET /v1/tournaments`
List tournaments.

- **Query:** `status` (`setup`|`swiss`|`championship`|`complete`), `limit` (default 20, 1–100), `offset` (default 0).
- **Response 200:** `{ tournaments: [{ tournament_id, slug, name, status, signups_open, created_at, updated_at, swiss_wins_to_advance, swiss_losses_to_eliminate, swiss_max_rounds, map_pool_size, player_count, active_round: { round_number, matches_total, matches_reported } | null, champion: { display_name, avatar_url } | null }], limit, offset }`.
- **Notes:** Setup-phase rows appear only to their admins or when `signups_open`.

### `GET /v1/tournaments/:slug`
Tournament detail (the only read keyed by **slug**).

- **Path:** `slug` (slug regex).
- **Response 200:** `{ tournament_id, slug, name, description, status, division_a_name, division_b_name, swiss_wins_to_advance, swiss_losses_to_eliminate, swiss_max_rounds, map_pool, links, slot_counts: { swiss, championship, swiss_by_division: { A, B } }, signups_open, signup_question, viewer_slot: { slot_id, division, swiss_seed } | null, is_viewer_admin, is_viewer_creator, owner: { display_name, avatar_url } | null, admins: [...], starts_at, completed_at, created_at, updated_at }`.
- **Errors:** `404 TOURNAMENT_NOT_FOUND` (missing, or setup-phase to a non-admin), `429 RATE_LIMIT_TOURNAMENT_VIEW`.
- **Notes:** `viewer_slot`, `is_viewer_admin`, `is_viewer_creator` require a session (else null/false).

### `GET /v1/tournaments/:id/standings`
Swiss standings per division + combined qualifier ranking.

- **Response 200:** `{ tournament_id, divisions: { A: { name, standings: RankedStanding[] }, B: {...} }, combined_qualifier_ranking?: [...] }`. Per-row fields include `slot_id, rank, wins, losses, status, h2h, buchholz_cut1, opponents_buchholz, cumulative, division, display_name, avatar_url, swiss_seed, withdrawn`; admins additionally see `signup_answer` and `discord_username` (null for public).
- **Errors:** `404 TOURNAMENT_NOT_FOUND`, `429 RATE_LIMIT_TOURNAMENT_VIEW`.

### `GET /v1/tournaments/:id/bracket`
Championship bracket.

- **Response 200:** `{ tournament_id, slots: [{ slot_id, championship_seed, display_name, user_id, avatar_url }], rounds: [{ round_id, round_number, status, matches: [<serializeMatch> & { total_turns }] }] }` (championship-phase only).
- **Errors:** `404 TOURNAMENT_NOT_FOUND`, `429 RATE_LIMIT_TOURNAMENT_VIEW`.
- **Notes:** Admin-only `slot_*_discord_username` / `slot_*_discord_id` inside matches are null for public viewers.

### `GET /v1/tournaments/:id/stats`
Competition stats (standings + caster leaderboard + player picks).

- **Response 200:** `{ standings: <public standings shape>, caster_leaderboard: [...], player_picks: [...] }`.
- **Errors:** `404 TOURNAMENT_NOT_FOUND`, `429 RATE_LIMIT_TOURNAMENT_VIEW`.
- **Notes:** Always the public standings shape (admin-only fields null) regardless of viewer. Uncached.

### `GET /v1/tournaments/:id/stats/games`
Aggregate game/chart stats over the tournament's completed matches.

- **Response 200:** `ChartBundleCore` (same core fields as user stats, "humans" focal — every human player).
- **Errors:** `404 TOURNAMENT_NOT_FOUND`, `429 RATE_LIMIT_TOURNAMENT_VIEW`.
- **Notes:** KV-cached, keyed on `{ tournament_id, updated_at, parser_version }`.

### `GET /v1/tournaments/:id/rounds`
Round structure.

- **Response 200:** `{ tournament_id, rounds: [{ round_id, tournament_id, phase, division: "A"|"B"|null, round_number, status, generated_at, started_at, completed_at }] }`.
- **Errors:** `404 TOURNAMENT_NOT_FOUND`, `429 RATE_LIMIT_TOURNAMENT_VIEW`.

### `GET /v1/tournaments/:id/matches`
Matches, with optional filters — the source for upcoming/scheduled games.

- **Query:** `round_id`, `phase`, `division`, `slot_id` (all optional, in-memory filters).
- **Response 200:** `{ tournament_id, matches: [<serializeMatch> & { round_id, round_number, phase, division }] }`. Each match carries `status` (e.g. `pending`), `match_number`, both slots' display names/nations/avatars, `map_script`, `winner_slot_id`/`game_id`/`reported_at`, and a `parts[]` array of scheduled sittings — each part `{ id, scheduled_at, casters[], streams }`.
- **Errors:** `404 TOURNAMENT_NOT_FOUND`, `429 RATE_LIMIT_TOURNAMENT_VIEW`.
- **Notes:** "Upcoming" = `status: "pending"` and/or a future `parts[].scheduled_at`. Admin-only discord fields are null for public viewers.

### `GET /v1/tournaments/:id/matches/:match_id`
Single match detail.

- **Path:** `id`, `match_id` (both 21-char).
- **Response 200:** `{ ...serializeMatch, round_id, round_number, phase, division, tournament_id }`.
- **Errors:** `404 MATCH_NOT_FOUND` (missing, or the match's round isn't in this tournament), `404 TOURNAMENT_NOT_FOUND`, `429 RATE_LIMIT_TOURNAMENT_VIEW`.

---

## Tournaments — lifecycle & configuration

### `POST /v1/tournaments`
Create a tournament.

- **Auth:** Session + **Beta**. Non-beta → `403 TOURNAMENT_CREATE_FORBIDDEN`.
- **Body:** `CreateTournamentSchema` — `name` (required, 1–120); optional `slug` (slug regex), `description` (≤2000), `division_a_name`/`division_b_name` (1–64), `swiss_wins_to_advance`/`swiss_losses_to_eliminate`/`swiss_max_rounds` (int 1–20), `map_pool` (`MapPoolSchema`: ≤64 entries of `{ id?, script, options? }`).
- **Response 201:** `{ tournament: { tournament_id, slug, name, description, status: "setup", division_a_name, division_b_name, swiss_wins_to_advance, swiss_losses_to_eliminate, swiss_max_rounds, map_pool, slot_counts: { swiss: 0, championship: 0 }, is_viewer_admin: true, created_at, updated_at } }`.
- **Errors:** `403 TOURNAMENT_CREATE_FORBIDDEN`, `429 RATE_LIMIT_TOURNAMENT_CREATE` (5/hr), `400 SLUG_RESERVED`, `409 SLUG_TAKEN`, `400 MAP_OPTIONS_INVALID`, `400 INVALID_THRESHOLDS`, `500` (`SLUG_DERIVATION_FAILED`, `TOURNAMENT_LOAD_FAILED`).
- **Notes:** The creator is added to `tournament_admins` in the same batch. Thresholds default to 5/3/3.

### `PATCH /v1/tournaments/:id`
Edit tournament configuration.

- **Auth:** Tournament admin.
- **Path:** `id` (21-char).
- **Body:** `PatchTournamentSchema` (all optional) — `name`, `description`, `division_a_name`/`division_b_name`, `swiss_wins_to_advance`/`swiss_losses_to_eliminate`/`swiss_max_rounds`, `map_pool`, `links` (`LinksSchema`: ≤16 of `{ label, url }`), `signups_open` (boolean), `starts_at` (nullable ISO-8601), `signup_question` (nullable, ≤2000).
- **Response 200:** `{ tournament }` (the full row).
- **Errors:** `409 TOURNAMENT_LOCKED` (swiss-config edit when status ≠ setup), `409 INVALID_PHASE` (`signups_open` while locked), `400 INVALID_THRESHOLDS`, `400 MAP_OPTIONS_INVALID`, `409 TOURNAMENT_COMPLETE` / `409 MAP_POOL_LOCKED` (map-pool edits), `500 MAP_CONFIG_INVALID`, plus auth/body codes.
- **Notes:** Swiss config freezes once status ≠ setup. The map pool is append-only after setup (existing entries frozen; new ones may be added) and fully frozen when complete. `links` / `starts_at` / `signup_question` are never phase-locked.

### `DELETE /v1/tournaments/:id`
Cancel (delete) a tournament.

- **Auth:** **Tournament creator** or site admin (co-admins excluded).
- **Path:** `id` (21-char).
- **Response 200:** `{ deleted: true }`.
- **Errors:** `401 UNAUTHORIZED`, `404 TOURNAMENT_NOT_FOUND`, `403 FORBIDDEN_DELETE`, `409 CANNOT_DELETE_COMPLETED`.
- **Notes:** Completed tournaments are deletable only via the CLI. Slots/rounds/matches/admins cascade; game blobs are left intact.

### `POST /v1/tournaments/:id/start`
Start the tournament (setup → swiss).

- **Auth:** Tournament admin.
- **Path:** `id` (21-char).
- **Response 201:** `{ tournament, rounds: [{ division, round_id, matches }] }`.
- **Errors:** `409 INVALID_PHASE` (status ≠ setup), `409 NO_SLOTS`, `409 DIVISION_EMPTY`, `409 MAP_CONFIG_EMPTY`, `500 MAP_CONFIG_INVALID`, plus auth codes.
- **Notes:** One-shot; generates Round 1 for both divisions and clears `signups_open`.

### `POST /v1/tournaments/:id/transition-championship`
Advance swiss → championship.

- **Auth:** Tournament admin.
- **Path:** `id` (21-char).
- **Body:** `TransitionChampionshipSchema` — `{ override_ranks?: string[] }` (slot ids; bypasses auto-promotion).
- **Response 201:** `{ status: "championship", round_id, matches, qualifier_count, bracket_size, byes, seed_order: string[] }`.
- **Errors:** `409 INVALID_PHASE` (status ≠ swiss), `409` (pending swiss matches block, via auto-close), `400 INVALID_OVERRIDE` / `OVERRIDE_SLOT_NOT_IN_TOURNAMENT` / `OVERRIDE_SLOT_WRONG_PHASE`, `409 INSUFFICIENT_QUALIFIERS` (body includes `qualifier_count`, `ranked[]`), `500` (`SOURCE_SLOT_MISSING`, `MAP_CONFIG_INVALID`), plus auth/body codes.
- **Notes:** Auto-ranks non-withdrawn qualifiers (wins → H2H → Buchholz cut-1 → cumulative) unless `override_ranks` is given. Generates championship round 1 (with byes for non-power-of-2 fields).

---

## Tournaments — slots

All **Tournament admin**, all take `id` (and `slot_id`) as 21-char nanoids, all share the `tournament_admin` rate-limit bucket (30/hr; `429 RATE_LIMIT_TOURNAMENT_ADMIN`).

### `POST /v1/tournaments/:id/slots`
Bulk-create slots.

- **Body:** `BulkCreateSlotsSchema` — array (1–200) of `{ division: "A"|"B", discord_username (1–64, lowercased), swiss_seed?: int (1–1000), user_id?: 21-char }`.
- **Response 201:** `{ created: [{ slot_id, division, swiss_seed }] }`.
- **Errors:** `409 INVALID_PHASE` (status ≠ setup), `400 INVALID_USER_ID`, `409 DUPLICATE_USERNAME` (collision with an existing swiss slot), `400 DUPLICATE_USERNAME` (dup within the batch).
- **Notes:** A supplied `user_id` pre-links the slot (canonical username/id resolved from `users`, so it's claimed from the start). Free-text slots claim at OAuth login. Missing `swiss_seed` auto-assigns the next per division.

### `POST /v1/tournaments/:id/slots/reorder`
Renumber swiss seeds / reassign divisions.

- **Body:** `ReorderSlotsSchema` — `{ divisions: { A: string[], B: string[] } }` (slot ids, ≤200 each).
- **Response 200:** `{ slots: SlotRef[] }`.
- **Errors:** `409 INVALID_PHASE` (status ≠ setup), `400 DUPLICATE_SLOT`, `400 INCOMPLETE_REORDER` (must list every swiss slot exactly once).

### `PATCH /v1/tournaments/:id/slots/:slot_id`
Edit a slot.

- **Body:** `PatchSlotSchema` (all optional) — `discord_username` (1–64, lowercased), `division` (`A`|`B`), `swiss_seed` (int 1–1000), `user_id` (21-char), `signup_answer` (nullable, ≤2000).
- **Response 200:** `{ slot }` (the full row).
- **Errors:** `404 SLOT_NOT_FOUND`, `409 TOURNAMENT_LOCKED` (division change when status ≠ setup), `400 INVALID_USER_ID`, `409 DUPLICATE_USERNAME`.
- **Notes:** A `user_id` pre-links identity; a free-text occupant change clears the link (re-claim at login). Only the division change is phase-gated.

### `DELETE /v1/tournaments/:id/slots/:slot_id`
Remove a slot (setup only).

- **Response:** `204 No Content`.
- **Errors:** `409 INVALID_PHASE` (status ≠ setup — use withdraw after start), `404 SLOT_NOT_FOUND`.

### `POST /v1/tournaments/:id/slots/:slot_id/withdraw`
Withdraw a slot (swiss/championship).

- **Response 200:** `{ slot }` (idempotent — returns the current row if already withdrawn).
- **Errors:** `409 INVALID_PHASE` (not swiss/championship), `404 SLOT_NOT_FOUND`.
- **Notes:** Forfeits the slot's pending match(es) to the opponent and may advance the round. Admin-only (players can't self-withdraw post-start).

### `DELETE /v1/tournaments/:id/slots/:slot_id/withdraw`
Reinstate a withdrawn slot.

- **Response 200:** `{ slot }` (idempotent). No phase gate.
- **Errors:** `404 SLOT_NOT_FOUND`.
- **Notes:** Takes effect from the next round generated; a prior auto-forfeit is not undone.

---

## Tournaments — matches

### `PATCH /v1/tournaments/:id/matches/:match_id`
Retroactively edit a match result.

- **Auth:** Tournament admin.
- **Path:** `id`, `match_id` (21-char).
- **Body:** `PatchMatchSchema` (all optional) — `winner_slot_id` (nullable 21-char), `status` (`pending`|`complete`|`forfeit`|`bye`), `game_id` (nullable 21-char), `notes` (≤2000).
- **Response 200:** `{ match }` (the full row).
- **Errors:** `404 MATCH_NOT_FOUND`, `409 DOWNSTREAM_BLOCKED` (a downstream round already has reported matches, or a swiss edit after championship start), `400` (`WINNER_NOT_IN_MATCH`, `SLOT_NOT_IN_TOURNAMENT`, `WINNER_REQUIRES_NON_PENDING_STATUS`, `WINNER_REQUIRED_FOR_STATUS`), plus auth/body codes.
- **Notes:** Enforces the status↔winner invariant; a forward transition may auto-generate the next round.

### `PATCH /v1/tournaments/:id/matches/:match_id/map`
Reassign a pending match's map.

- **Auth:** Tournament admin.
- **Path:** `id`, `match_id` (21-char).
- **Body:** `PatchMatchMapSchema` — `{ map_pool_id?: string }` (must be in the tournament's pool).
- **Response 200:** `{ match }`.
- **Errors:** `404 MATCH_NOT_FOUND`, `409 MATCH_NOT_PENDING`, `500 MAP_CONFIG_INVALID`, `400 MAP_NOT_IN_POOL`.
- **Notes:** Only pending/bye matches; denormalizes `map_script` onto the match. Slot identity is not patchable here.

### `PATCH /v1/tournaments/:id/matches/:match_id/schedule`
Set a match's scheduled sittings (times, casters, streams).

- **Auth:** Tournament admin **or** match participant (either slot's owner). Anonymous → `401`.
- **Path:** `id`, `match_id` (21-char).
- **Body:** `PatchMatchPartsSchema` — `parts` (≤30) of `{ id?, scheduled_at (nullable ISO-8601), casters (≤10) of { user_id?, name? }, streams (≤20) of { url (YouTube/Twitch allowlist), label? } }`; `expected_rev?` (int, for CAS).
- **Response 200:** `{ match: { ...row, parts } }`.
- **Errors:** `401 UNAUTHORIZED`, `404 MATCH_NOT_FOUND`, `403 NOT_MATCH_PARTICIPANT`, `429 RATE_LIMIT_TOURNAMENT_SCHEDULE` (60/hr), `409 MATCH_NOT_PENDING` (bye), `403 NOT_TOURNAMENT_ADMIN` (participant editing a decided match), `400 INVALID_USER_ID`, `409 CONFLICT` (`parts_rev` CAS mismatch), plus body codes.
- **Notes:** Replace-all over the parts list, guarded by a `parts_rev` CAS (last-write-wins when `expected_rev` is omitted). Linked casters snapshot their canonical username. Decided matches are editable admin-only (participants blocked to prevent stream-wipe by the loser).

### `POST /v1/tournaments/:id/matches/:match_id/parts/:part_id/casters/me`
Add yourself as a caster on a match part.

- **Auth:** Session (any logged-in user).
- **Path:** `id`, `match_id` (21-char), `part_id` (1–40 chars).
- **Body:** `CastMatchPartSchema` — `{ role?: "streamer" | "cocaster" }` (defaults: streamer if the part has no caster, else co-caster).
- **Response:** `204 No Content` (refetch to see the result).
- **Errors:** `400 INVALID_BODY`, `401 UNAUTHORIZED`, `404 MATCH_NOT_FOUND` / `PART_NOT_FOUND`, `409 MATCH_NOT_PENDING` / `TOO_MANY_CASTERS` / `CONFLICT`, `429 RATE_LIMIT_TOURNAMENT_SCHEDULE`.
- **Notes:** Self-only (keyed by your `user_id`); the caster name is snapshotted from your Discord username. CAS on `parts_rev`; max 10 casters/part. Shares the `tournament_schedule` budget.

### `DELETE /v1/tournaments/:id/matches/:match_id/parts/:part_id/casters/me`
Remove yourself as a caster.

- **Auth:** Session.
- **Path:** `id`, `match_id` (21-char), `part_id` (1–40 chars).
- **Response:** `204 No Content`.
- **Errors:** `401 UNAUTHORIZED`, `404 MATCH_NOT_FOUND` / `PART_NOT_FOUND`, `409 MATCH_NOT_PENDING` (bye) / `CONFLICT`, `429 RATE_LIMIT_TOURNAMENT_SCHEDULE`.
- **Notes:** Self-only. Allowed even on decided matches (byes still rejected).

---

## Tournaments — admins

### `GET /v1/tournaments/:id/admins`
List a tournament's admins.

- **Auth:** Tournament admin (the read still requires admin and consumes the admin rate-limit budget).
- **Path:** `id` (21-char).
- **Response 200:** `{ admins: [{ user_id, display_name, avatar_url, is_creator: boolean }] }` (ordered by grant time).
- **Errors:** `401 UNAUTHORIZED`, `403 NOT_TOURNAMENT_ADMIN`, `429 RATE_LIMIT_TOURNAMENT_ADMIN`, `404 TOURNAMENT_NOT_FOUND`.
- **Notes:** The only tournament endpoint that exposes admin `user_id`s (public detail hides them).

### `POST /v1/tournaments/:id/admins`
Grant co-admin.

- **Auth:** Tournament admin.
- **Path:** `id` (21-char).
- **Body:** `GrantAdminSchema` — `{ user_id: string }` (21-char).
- **Response 201:** `{ admin: { user_id, display_name, avatar_url, is_creator } }`.
- **Errors:** `404 USER_NOT_FOUND`, plus auth/body codes.
- **Notes:** Idempotent (`INSERT OR IGNORE`). A granted admin can act regardless of beta status.

### `DELETE /v1/tournaments/:id/admins/:user_id`
Revoke co-admin.

- **Auth:** Tournament admin.
- **Path:** `id`, `user_id` (21-char).
- **Response 200:** `{ revoked: true }`.
- **Errors:** `409 CANNOT_REMOVE_CREATOR`, `404 ADMIN_NOT_FOUND`, plus auth codes.

---

## Tournaments — player self-service

All **Session** (anonymous → `401 UNAUTHORIZED`). `me` = the session user.

### `POST /v1/tournaments/:id/signup`
Sign yourself up.

- **Path:** `id` (21-char).
- **Body:** `TournamentSignupSchema` — `{ division: "A"|"B", signup_answer?: string (≤2000) }`.
- **Response 201:** `{ slot: { slot_id, division, swiss_seed } }`.
- **Errors:** `409 SIGNUPS_CLOSED` (status ≠ setup or signups closed), `409 ALREADY_SIGNED_UP`, `404 TOURNAMENT_NOT_FOUND`, plus body codes.
- **Notes:** Identity comes from the session, not the body. One slot per user (race-guarded).

### `DELETE /v1/tournaments/:id/signup`
Withdraw your own signup (before start).

- **Path:** `id` (21-char).
- **Response:** `204 No Content`.
- **Errors:** `409 TOURNAMENT_STARTED` (status ≠ setup), `404 NOT_SIGNED_UP`, `404 TOURNAMENT_NOT_FOUND`.
- **Notes:** Allowed even when signups are closed, as long as the tournament hasn't started. Post-start, an admin must withdraw the slot.

### `GET /v1/users/me/tournaments`
Tournaments you have a slot in.

- **Response 200:** `{ tournaments: [{ tournament_id, slug, name, status, slot_id, division, claim_banner_dismissed_at }] }`.
- **Errors:** `401 UNAUTHORIZED`.

### `GET /v1/users/me/admin-tournaments`
Tournaments you administer.

- **Response 200:** `{ tournaments: [{ tournament_id, slug, name, status }] }`.
- **Errors:** `401 UNAUTHORIZED`.

### `GET /v1/users/me/matches`
Your matches across all tournaments.

- **Response 200:** `{ matches: [...] }` (up to 200; each row carries match, slot, round, and tournament identity fields).
- **Errors:** `401 UNAUTHORIZED`.

### `POST /v1/users/me/tournaments/:id/dismiss-banner`
Dismiss the "claim your slot" banner.

- **Path:** `id` (21-char).
- **Response 200:** `{ dismissed: number }` (rows updated; `0` on a repeat call).
- **Errors:** `401 UNAUTHORIZED`, `404 NO_SLOT_IN_TOURNAMENT`.
- **Notes:** Idempotent; requires you to own a slot in the tournament.

---

## Tournament export

### `GET /v1/tournaments/:id/export`
Download standings + matches as CSVs.

- **Auth:** Session + **Tournament admin** (unlike the other reads — anonymous → `401`, not a setup-gated `404`).
- **Path:** `id` (21-char).
- **Response 200:** `application/zip` (`standings.csv` + `matches.csv`), `Content-Disposition: attachment; filename="<slug>-export.zip"`.
- **Errors:** `401 UNAUTHORIZED`, `403 NOT_TOURNAMENT_ADMIN`, `404 TOURNAMENT_NOT_FOUND`, `429 RATE_LIMIT_TOURNAMENT_EXPORT` (30/hr per user).
- **Notes:** Standings CSV uses the full admin shape. Not behind the per-IP view limit.

---

## Site admin: games — `/v1/admin/games/*`

All **Site admin** (`ADMIN_DISCORD_ID`). Non-admins receive `404 NOT_FOUND` (existence hidden).

### `GET /v1/admin/games/out-of-date`
Games across all users whose `parser_version` differs from a target.

- **Query:** `version` (required).
- **Response 200:** `AdminGameListResponse` — `{ games: AdminGameListItem[] }` (GameListItem + `user_id`, `owner_display_name`).
- **Errors:** `404 NOT_FOUND`, `400 INVALID_QUERY`.

### `GET /v1/admin/games/all`
All game ids/names (drives the reindex sweep).

- **Response 200:** `AdminGameIdListResponse` — `{ games: [{ game_id, game_name }] }`.
- **Errors:** `404 NOT_FOUND`.

### `POST /v1/admin/games/:id/reindex`
Rebuild a game's D1 pivot tables from its stored blob.

- **Path:** `id` (21-char).
- **Response 200:** `{ reindexed: true }`.
- **Errors:** `404 NOT_FOUND` / `BLOB_MISSING`, `500 REINDEX_FAILED`.
- **Notes:** Re-runs only the D1 pivot (no re-parse, no re-upload); the `games` row and R2 are untouched.

### `GET /v1/admin/games/:id/download`
Download any game's raw ZIP (admin).

- **Path:** `id` (21-char).
- **Response 200:** `application/zip` stream; `Cache-Control: private, max-age=0`.
- **Errors:** `404 NOT_FOUND` / `BLOB_MISSING`.
- **Notes:** No rate limit and no `is_public`/owner gate — retains `online_id`.

### `POST /v1/admin/games/:user_id/reparse-upload`
Re-import a save into a target user's library (admin).

- **Path:** `user_id` (21-char) — the library owner the upload runs as.
- **Body:** same `multipart/form-data` as [`POST /v1/games`](#post-v1games); `tournament_match_id` is rejected here.
- **Response:** `UploadGameResponse` — same shapes as `POST /v1/games`.
- **Errors:** `404 NOT_FOUND` (non-admin), `400 INVALID_FORM` (`tournament_match_id` supplied), plus all `POST /v1/games` errors.
- **Notes:** Runs as the target user; upload rate limits are skipped and the action is audited as `admin_reimport` (doesn't count toward the user's upload caps).

---

## Diagnostics

### `POST /v1/csp-report`
Receive CSP violation reports from browsers.

- **Auth:** Public (no auth, no rate limit).
- **Body:** raw text — legacy `application/csp-report` (single object) or Reporting-API `application/reports+json` (array); max 64 KB.
- **Response:** `204 No Content` (also for empty/unknown/zero-violation bodies).
- **Errors:** `413` (> 64 KB), `400` (unreadable / invalid JSON).
- **Notes:** Each violation is logged as `csp_violation`. No CORS headers on the response itself.

---

## Legacy share — `/v1/share/*`

The frozen desktop-era share surface. Authenticated by header app keys (not the session cookie), single-origin CORS, and **error bodies are `{ error }` only — no `code`**.

### `POST /v1/share`
Upload a share blob.

- **Auth:** App key — `X-App-Key` header (UUID-v4), then blocklist + rate-limit checks.
- **Body:** gzip binary (`Content-Type: application/gzip`); decompresses to a JSON payload validated by `validateSharePayload` (17 required fields, `version: 1`, array/collection length bounds).
- **Response 201:** `{ share_id, url, delete_token }` (`url = https://per-ankh.app/share/<id>`).
- **Errors:** `503` (`UPLOADS_ENABLED` kill switch), `400` (missing/invalid `X-App-Key`, wrong content-type, empty/invalid payload), `403` (blocklist), `429` (per-key/per-IP/global), `413` (compressed or decompressed size cap), `500` (D1 insert).
- **Notes:** gzip-bomb guarded. Writes the R2 blob then the D1 row.

### `GET /v1/share/:id`
Download a share blob.

- **Auth:** Public (per-IP download rate limit only).
- **Path:** `id` (21-char).
- **Response 200:** decompressed JSON stream; `Cache-Control: public, max-age=3600`.
- **Errors:** `429` (download limit), `404` (not found).
- **Notes:** CDN-cached 1h. No PII stripping (legacy blobs are stored as uploaded).

### `DELETE /v1/share/:id`
Delete a share blob.

- **Auth:** App key — requires both `X-Delete-Token` and `X-App-Key` headers (compared timing-safe).
- **Path:** `id` (21-char).
- **Response:** `204 No Content`.
- **Errors:** `400` (missing header), `404` (not found), `403` (invalid credentials).
- **Notes:** Hard-deletes the R2 blob then the D1 row.
