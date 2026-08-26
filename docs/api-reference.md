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
- [Account](#account) — `/v1/users/me/online-ids`, profile URL, settings
- [Tournaments — reads](#tournaments--reads)
- [Tournaments — lifecycle & configuration](#tournaments--lifecycle--configuration)
- [Tournaments — slots](#tournaments--slots)
- [Tournaments — matches](#tournaments--matches)
- [Tournaments — admins](#tournaments--admins)
- [Tournaments — player self-service](#tournaments--player-self-service)
- [Tournament export](#tournament-export)
- [Site admin: games](#site-admin-games) — `/v1/admin/games/*`
- [Site admin: featured videos](#site-admin-featured-videos) — `/v1/admin/featured-videos*`
- [Diagnostics](#diagnostics) — `/v1/csp-report`

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

### Authentication model

Auth is a session cookie (name `session`; `session_staging` on staging), `Domain=per-ankh.app`, `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS, 30-day TTL, backed by KV. Obtain it via the Discord OAuth flow (`POST /v1/auth/discord/start` → Discord → `POST /v1/auth/discord/callback`), or locally via `GET /v1/auth/dev/login` (disabled on HTTPS). `is_admin` / `is_beta` on `GET /v1/auth/me` are advisory for frontend gating only — the Worker re-checks server-side on every privileged call.

### Request format

- JSON bodies: `Content-Type: application/json`. Non-JSON where a body is required → `415 UNSUPPORTED_MEDIA_TYPE`; malformed JSON → `400 INVALID_JSON`; schema failure (Valibot) → `400 INVALID_BODY`.
- `POST /v1/games` and `POST /v1/admin/games/:user_id/reparse-upload` take `multipart/form-data`.

### Response & error envelope

Success bodies are endpoint-specific JSON (or a binary stream for downloads/exports). Errors are `{ "error": string, "code"?: string }`, with optional extra fields (e.g. `qualifier_count`). Every response carries an `X-Request-Id` header; unhandled `500`s also include `request_id` in the body.

### Identifiers

- Game, tournament, slot, match, user ids are **21-char nanoids** (`[A-Za-z0-9_-]{21}`).
- Tournament **slugs** match `^[a-z0-9][a-z0-9-]{0,63}$`. Note `GET /v1/tournaments/:slug` is the one read keyed by slug; every other per-tournament route uses the 21-char id.
- Match **part** ids are `[A-Za-z0-9_-]{1,40}`.

### Profile slugs

A user's `slug` is the `<slug>` in `per-ankh.app/u/<slug>` — a separate namespace from tournament slugs, matching `^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$` (3–30 chars), unique across users, and public on every payload that names a person.

It is **derived, not claimed**: at first login the effective display name (`COALESCE(alias, display_name)`) is lowercased, whitespace becomes hyphens, anything outside `[a-z0-9-]` is dropped, hyphen runs collapse, and leading/trailing hyphens are trimmed. If the result fails the format rule, hits the reserved list, or is already taken, the user simply gets **no slug** — there is no numeric-suffix disambiguation and no truncation, and `null` stays a normal value on every payload that carries one. Existing rows are filled in by `./per-ankh admin backfill-slugs`, not by a migration (SQLite has no regex). Derivation runs on the first-login INSERT only, which is what makes a released slug stay released.

From there it's the user's: [`POST /v1/users/me/slug`](#post-v1usersmeslug) renames it (7-day cooldown), [`DELETE`](#delete-v1usersmeslug) releases it. A released name is immediately claimable by anyone, so `/u/<name>` may retarget; `/users/<user_id>` is the permalink that never moves, and [`GET /v1/users/:user_id`](#get-v1usersuser_id) keeps serving every profile either way.

### Rate limiting

Counters live in the D1 `events` table and are keyed per-user, per-IP, or globally depending on the endpoint. Notable buckets:

Two things shape what "per IP" means for traffic that arrives through `per-ankh.app`'s server-side rendering, since those subrequests leave Cloudflare's SSR egress rather than the visitor's connection:

- **The visitor is the bucket.** The frontend Worker forwards the visitor's edge address and authenticates itself with the `SSR_TRUSTED_KEY` shared secret; `adoptTrustedFrontend` (`cloud/src/util.ts`) verifies it once at the Worker's entry and swaps the address in before any handler reads it. Without a valid key those headers are stripped, so a caller can't claim an address it doesn't have — and with the secret unset on either Worker, nothing is forwarded and every counter behaves as it did before. The address is all that travels: the visitor's User-Agent is deliberately **not** forwarded, because it would extend the scraper exemption below to anyone who types `Discordbot/2.0` into a header.
- **The address is the only thing the key buys.** Every read is gated and charged the same for every caller — there is no cheaper class of read and no discount for being our own SSR Worker. A cold `/tournaments/[slug]` costs four slots (the tournament, then standings, bracket and matches) whether it was server-rendered or reached by a hydrated navigation, and the stats page costs six. That is why the ceilings below are stated in **reads**, and why the tournament-page one is four times the others: converting to page loads is the operator's job, and the fan-out is the conversion factor.

The three tournament read buckets are split by the *surface that spends them*, not by feature: a read a busy page makes on every render must not share a budget with the pages it could otherwise take down (see `cloud/src/tournament/limits.ts`).

| Bucket | Limit | Applies to |
| --- | --- | --- |
| `anon_read` | 200 / hr per IP | anonymous game reads (`GET /v1/games/:id`, `public-recent`) |
| `tournament_view` | 2400 reads / hr per IP | the tournament page reads: detail, standings, bracket, rounds, matches, match detail, both stats endpoints, and the profile Tournaments tab. ~4 reads per page load (6 on stats), so ~600 page loads an hour. The ceiling is the `TOURNAMENT_VIEW_PER_HOUR` var, so it can be retuned mid-event with `wrangler secret put` instead of a redeploy — until the next deploy restores the `wrangler.toml` value |
| `tournament_list_view` | 600 reads / hr per IP | `GET /v1/tournaments`. Its own budget, not `tournament_view`'s: the **home page** fetches the list on every render, so sharing would let ordinary landing-page traffic decide when `/tournaments/[slug]` starts refusing. Own ceiling var (`TOURNAMENT_LIST_VIEW_PER_HOUR`), retuned the same way |
| `tournament_link_view` | 600 reads / hr per IP | `GET /v1/games/:id/tournament-link`. Its own budget for the same reason: every game-page render calls it, and sharing let a `/games/*` crawl 429 the tournament pages. Own ceiling var too (`TOURNAMENT_LINK_VIEW_PER_HOUR`) |
| `tournament_export` | 30 / hr per user | `GET /v1/tournaments/:id/export` |
| `tournament_admin` | 30 / hr per user | tournament admin mutations |
| `tournament_schedule` | 60 / hr per user | match schedule + caster self-service |
| `tournament_create` | 5 / hr per user | `POST /v1/tournaments` |
| user search | 60 / hr per user | `GET /v1/users/search` |
| `user_search_public` | 300 / hr per user | `GET /v1/users/public-search` |
| `slug_claim_attempt` | 15 / hr per user | `POST` + `DELETE /v1/users/me/slug` (counts attempts, not successes) |
| upload / download | per-user + per-IP + global | game upload / download |

Over-limit → `429` with an endpoint-specific `code`. Known scraper User-Agents are exempt from the anonymous read/view limits, and from their audit rows too — so an exempt read leaves no trace in `events`. The exemption is keyed on a self-declared header, which is why the visitor's UA isn't forwarded across the SSR hop: it applies to a caller hitting the API directly and not to page traffic through `per-ankh.app`.

### CORS

All paths use **credentialed, echo-Origin** CORS (the request `Origin` is reflected when in `ALLOWED_ORIGINS = https://per-ankh.app, http://localhost:1420`) so cookies traverse `per-ankh.app ↔ api.per-ankh.app`. CORS is browser-enforced only; a non-browser client is unaffected.

### PII

`online_id` (Steam/GOG/Epic) is stripped from game blobs for non-owner viewers via a deep walk (`stripOnlineIds`). The raw save ZIP retains it, which is why `GET /v1/games/:id/download` requires a session while the JSON `GET /v1/games/:id` serves public games anonymously. `discord_id` / `discord_username` appear only in admin-tier tournament responses, never in public payloads. A user's `slug` is public by design. It is derived from the effective display name (see [Profile slugs](#profile-slugs)) — never from `discord_username` or any other identity field the user hasn't already published — so the URL restates a name every public payload already renders. Since it is issued rather than chosen, `/u/<slug>` is an account-existence oracle keyed on display names; that is accepted, and users who don't want the URL can release it via [`DELETE /v1/users/me/slug`](#delete-v1usersmeslug). PII is never logged.

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
- **Response 200:** `{ user_id, discord_id, display_name, avatar_url, slug: string|null, next }`; sets the session cookie and clears `oauth_pending`.
- **Errors:** `400` (`INVALID_BODY`, `MISSING_FIELDS`, `MISSING_PENDING`, `PENDING_NOT_FOUND`, `STATE_MISMATCH`, `REDIRECT_URI_MISMATCH`), `500 CORRUPT_PENDING`, `502` (`TOKEN_EXCHANGE_FAILED`, `NO_ACCESS_TOKEN`, `USER_FETCH_FAILED`, `NO_USER_ID`), `500 UPSERT_FAILED`.
- **Notes:** Pending entry is single-use (read-then-deleted). On first-ever login, seeds a `Personal` collection, pins beta status, and claims any pre-linked tournament slots. Writes a `login` audit event.

### `GET /v1/auth/me`
Current session's user profile.

- **Auth:** Session.
- **Response 200:** `{ user_id, discord_id, display_name, discord_username, avatar_url, slug: string|null, is_beta: boolean, is_admin: boolean, default_game_public: boolean, stream_url: string|null }`.
- **Errors:** `401 UNAUTHORIZED` (also if the session points at a deleted user, which clears the cookie).
- **Notes:** Re-claims pre-linked tournament slots on every call. `slug` is the caller's profile URL, null when they have none — carried here so the account page has it without a second fetch. `is_beta`/`is_admin` are advisory (frontend gating); the server re-checks per endpoint.

### `GET /v1/auth/dev/login`
Local-only login bypass (no Discord).

- **Auth:** Local only — returns `404 NOT_FOUND` unless `DEV_LOGIN` is set **and** the request is non-HTTPS. Dark in production.
- **Query:** `discord_id` (required, numeric snowflake ≤20 digits), `username` (required, ≤32, lowercased), `display_name` (optional, ≤64), `next` (optional, sanitized).
- **Response:** `302` redirect to `<frontendOrigin><next>` with the session cookie set.
- **Errors:** `404 NOT_FOUND`, `400 VALIDATION_ERROR`, `500 UPSERT_FAILED`.
- **Notes:** Also grants tournament beta (note `dev-login`) and seeds the `Personal` collection. See `docs/dev-login.md`.

### `POST /v1/auth/settings`
Update account settings (partial — only the fields sent are written).

- **Auth:** Session.
- **Body:** `UserSettingsSchema` — `{ default_game_public?: boolean, stream_url?: string|null, open_to_matches?: boolean }`. `default_game_public` is the default visibility applied to newly uploaded saves. `stream_url` is the casting stream link (YouTube/Twitch allowlist, same as match-part streams), auto-attached when the user takes the streamer slot on a match part; `null` clears it. `open_to_matches` is whether other players may be shown this user as a suggested opponent — `false` removes them from everyone's list without stopping them getting their own.
- **Response 200:** `{ default_game_public: boolean, stream_url: string|null, open_to_matches: boolean }` (the full current settings, whichever subset was written).
- **Errors:** `401 UNAUTHORIZED`, `400 INVALID_JSON`, `400 INVALID_BODY`.

### `GET /v1/auth/channels`
List the signed-in user's linked video/stream channels.

- **Auth:** Session.
- **Response 200:** `{ channels: { platform, channel_url, channel_id }[] }`.
- **Errors:** `401 UNAUTHORIZED`.

### `POST /v1/auth/channels`
Add or replace the user's channel for the platform the pasted URL belongs to. The Worker detects the platform from the URL and resolves it to a native channel id (YouTube: one Data API lookup for an `@handle` / legacy `/user/` URL; a `…/channel/UC…` URL resolves without a key). One channel per platform (upsert on `(user_id, platform)`).

- **Auth:** Session.
- **Body:** `AddChannelSchema` — `{ url: string }` (required, ≤500 chars).
- **Response 200:** `{ channel: { platform, channel_url, channel_id } }`.
- **Errors:** `401 UNAUTHORIZED`, `400 INVALID_JSON`, `400 INVALID_BODY`, `422 UNSUPPORTED_PLATFORM`, `400 INVALID_URL`, `422 UNRESOLVABLE_CUSTOM_URL`, `422 CHANNEL_NOT_FOUND`, `503 RESOLVE_UNAVAILABLE`, `502 RESOLVE_FAILED` / `RESOLVE_ERROR`.

### `DELETE /v1/auth/channels/:platform`
Remove the user's channel for a platform. Idempotent.

- **Auth:** Session.
- **Response 200:** `{ ok: true }`.
- **Errors:** `401 UNAUTHORIZED`.

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
- **Response 200:** `PublicRecentGamesResponse` — `{ games: PublicRecentGame[] }` (≤20), each with uploader identity (`uploader_user_id`, `uploader_display_name`, `uploader_slug: string|null`, `uploader_avatar_url`) and per-player `vp_series` points.
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
- **Response 200:** the stored `FullGameData` JSON with injected top-level fields (`user_id`, `user_nation`, `uploader_nation`, `user_won`, `user_display_name`, `user_slug`, `display_name`); owner additionally gets `is_public`.
- **Errors:** `404` (`NOT_FOUND`, `BLOB_MISSING`), `401 UNAUTHORIZED`, `403 FORBIDDEN`, `429 RATE_LIMIT`.
- **Notes:** Non-owner viewers get `online_id` stripped from the blob. Anonymous reads consume the `anon_read` bucket (200/hr per IP). Owner responses are `private, no-store`; public responses `public, max-age=3600, s-maxage=60` with `Vary: Cookie, Origin`.

### `GET /v1/games/:id/tournament-link`
Whether a game is linked to a tournament match.

- **Auth:** Public (IP rate-limited).
- **Path:** `id` (21-char).
- **Response 200:** `{ link: GameTournamentLink | null }` — `link.tournament` `{ tournament_id, slug, name, status }` + `link.match` `{ match_id, phase, division, round_number, map_script, status, slot_a_id, slot_b_id, winner_slot_id, slot_a_display_name, slot_b_display_name }`; `{ link: null }` when unlinked.
- **Errors:** `429 RATE_LIMIT_TOURNAMENT_LINK`.
- **Notes:** `tournament_link_view` bucket (600/hr per IP; scraper UAs exempt) — its own, deliberately not the `tournament_view` one the tournament pages draw on. The budget is charged before the link is looked up, so an unlinked game costs a slot too.

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

### `GET /v1/users/public-search`
Find players by name — the "Players" group in the header search.

- **Auth:** Session (any logged-in user). Anonymous search stays gated to keep user enumeration behind a login.
- **Query:** `q` (trimmed, lowercased, 1–32; results only when ≥2 chars), `limit` (1–20, default 10).
- **Response 200:** `{ users: [{ user_id, display_name, slug: string|null, avatar_url }] }` (empty when `q<2`).
- **Errors:** `401 UNAUTHORIZED`, `429 RATE_LIMIT_USER_SEARCH_PUBLIC` (300/hr per user), `400 VALIDATION_ERROR`.
- **Notes:** **No `discord_username` — neither returned nor matchable.** Matching is on `display_name` + `alias` + `slug` only, so the endpoint can't confirm a Discord-handle prefix, and no `discord_*` field appears in the response. (`avatar_url` is a `cdn.discordapp.com` URL, so it carries the user's `discord_id` in its path — as every public avatar payload does; that's the cost of rendering an avatar, and the handle is what the PII stance protects.) `q` is matched as a literal: `%` and `_` are escaped, so a wildcard query can't widen the prefix lookup into a directory sweep. Results are scoped to users who made something public — a profile slug, a public game, a tournament slot, or a linked video channel; a user with none of those is absent from every result. Because slugs are now derived at signup rather than claimed, that first leg is true for nearly every account, so in practice this reaches anyone whose display name slugified — the same accepted consequence as `/u/<slug>` being an account-existence oracle. It publishes nothing a display-name prefix match didn't already, and the other three legs still carry the accounts no slug reached. Distinct from `GET /v1/users/search`, which serves the admin autocomplete and returns the Discord fields the slot pre-link needs.

### `GET /v1/users/:user_id`
Public profile + all-time summary.

- **Auth:** Public (owner extras) — the owner's summary includes private games; others/anon see public-only.
- **Path:** `user_id` (21-char).
- **Response 200:** `{ user_id, display_name, avatar_url, slug: string|null, summary: { total_games, win_rate: number|null, favorite_nation: string|null, favorite_day_of_week: number|null }, channels: { platform, channel_url }[], tournament_participant: boolean }`.
- **Errors:** `404 NOT_FOUND`.
- **Notes:** `slug` is the user's profile URL (`/u/<slug>`), null when they have none — see [Profile slugs](#profile-slugs). Summary is all-time over all saves (ignores any scope selector). `channels` are the user's linked video/stream channels (public) — drives whether the profile shows the "Videos" tab. `tournament_participant` plays the same role for the "Tournaments" tab: true when the user has a match attributable to them (same rule `GET /v1/users/:user_id/tournaments` uses — report-time snapshot for a decided match, live slot per side otherwise, byes excluded) **or** has cast a match sitting, so a dedicated caster who never plays still gets the tab. Holding a slot is deliberately not the test: a seat before round one renders nothing, and a substituted-out player holds no slot yet keeps every match they played. Both are flags only; the tabs' payloads load lazily from their own endpoints.

### `GET /v1/users/by-slug/:slug`
The same public profile, resolved by the user's slug — what `/u/<slug>` reads.

- **Auth:** Public (owner extras) — identical to `GET /v1/users/:user_id`; no rate limit either, for the same reason.
- **Path:** `slug` — 3–30 chars, `^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$`.
- **Response 200:** the same payload as `GET /v1/users/:user_id`, field for field — one shared builder assembles both, so the two can't drift.
- **Errors:** `404 NOT_FOUND` — unknown slug, and equally a malformed one (the route pattern admits only the stored lowercase shape, so anything else never matches a route).
- **Notes:** No case folding: `/u/Foo` is a miss, not a redirect, so each user has exactly one canonical URL. `/users/<user_id>` remains a permanent permalink and keeps serving every profile, slug or not — and a slug that has been released or renamed away 404s here, since it is only ever the current holder's.

### `GET /v1/users/:user_id/stats`
User-corpus aggregate stats bundle.

- **Auth:** Public (owner extras) — owner (`self`) corpus includes private games; visitor/anon forced to public.
- **Path:** `user_id` (21-char).
- **Query:** `scope` (default `all`; `public`|`vs_ai`|`mp`|`tournament`|`<collection_id>`; collection and `public` narrowing are owner-only).
- **Response 200:** `ChartBundle` — `ChartBundleCore` (meta, summary, nations, win rates, starting-leader archetype/trait win rates, wonder build/timing stats, yield curves, law/tech timing…) plus user-only `win_rate` and `games_with_outcome`.
- **Errors:** `400 INVALID_USER_ID`, `404 NOT_FOUND`.
- **Notes:** KV-cached, keyed on `{ user_id, viewerScope, scope, parser_version }`.

### `GET /v1/users/:user_id/videos`
Recent videos merged across the user's linked channels (newest first) — feeds the profile "Videos" tab.

- **Auth:** Public — channels and their videos are user-published; no PII, same for every viewer.
- **Path:** `user_id` (21-char).
- **Response 200:** `{ videos: { id, title, url, thumbnail_url: string|null, published_at, platform }[] }` (empty when the user has no linked channels). For live content `published_at` is when the broadcast aired, not when its VOD was later published — see the note below.
- **Notes:** Per-channel KV cache, stale-while-revalidate (serves cached instantly, refreshes in the background past a 1h soft TTL). YouTube videos come from the unauthenticated channel RSS feed. That feed dates live content by its VOD publish instant, which runs hours (routinely a calendar day) after the broadcast, so when `YOUTUBE_API_KEY` is configured each refresh spends one further quota unit on `videos.list` to re-date broadcasts to `liveStreamingDetails.actualStartTime` and re-sorts. Without the key the feed's own dates stand. A refresh whose `videos.list` call fails is served but not cached, so the feed dates never persist past that one response.

### `GET /v1/users/:user_id/tournaments`
One player's whole tournament record — played + upcoming matches, and cast appearances — for the profile "Tournaments" tab.

- **Auth:** Public — tournament reads already are, tournament-linked saves are forced public, and casters are already credited publicly on the tournament stats page.
- **Path:** `user_id` (21-char).
- **Response 200:** `{ user_id, tournaments: [{ tournament_id, slug, name, status, signups_open, division_a_name, division_b_name, map_pool }], matches: TournamentMatch[], casts: (TournamentMatch & { part_id })[], slot_labels, slot_user_ids, slot_slugs, slot_avatars }`.
- **Errors:** `429 RATE_LIMIT_TOURNAMENT_VIEW` (shares the per-IP tournament-view budget).
- **Notes:** Match attribution prefers the report-time occupant snapshot for decided matches, so a substitution never reassigns a played match to the substitute; it falls through to the live slot per side when the match is still pending **or** when that side's snapshot is null (the occupant hadn't claimed their slot at report time), matching the render layer's rule. `tournaments` is the index both sections group under, carrying only the per-tournament context the shared match table renders from — a tournament the player holds a seat in but has no match or cast for does not appear, so a setup-phase tournament (which has no rounds) never does. The setup gate still applies, same as every per-tournament read. `status` + `signups_open` are the pair every tournament surface renders its status chip from. Byes are excluded. The four admin-only `slot_a/b_discord_*` fields are **absent** from every match here, not null. `slot_labels`/`slot_user_ids`/`slot_slugs`/`slot_avatars` carry live per-slot identity, which the pending (upcoming) rows render — and link — from. `slot_user_ids` exposes nothing new: the same ids already ship on every row as `slot_a/b_user_id`; `slot_slugs` is what lets a pending row's link skip the `/users/<id>` redirect.

### `GET /v1/creator-videos`
Cross-creator home feed — the newest uploads across all users' linked channels, merged newest-first for the home page's "Latest from creators" strip.

- **Auth:** Public — channels and their videos are user-published; no PII, same for every viewer.
- **Response 200:** `{ videos: { id, title, url, thumbnail_url: string|null, published_at, platform, user_id, display_name, slug: string|null, avatar_url }[] }` (each video carries its creator; empty only when no channel has recent uploads).
- **Notes:** Cached as one pre-assembled KV entry, stale-while-revalidate (mirrors the per-channel cache): fresh served as-is, stale served instantly while a background task re-assembles it, cold miss built synchronously and cached so the first request already returns the feed. The cold build's per-channel fetches run in parallel over mostly-warm caches (at worst one RSS fetch per channel, plus one `videos.list` call where a key is configured). Capped at 12, matching the home strip (which merges this feed with `GET /v1/tournament-videos`, capped to match). Underlying per-channel data is the same SWR cache as `GET /v1/users/:user_id/videos`, including its broadcast-date correction — so a cast is placed and labelled by when it aired.

### `GET /v1/tournament-videos`

Cross-tournament home feed — the newest uploads across every visible tournament's admin-set playlist, merged newest-first. The home page interleaves these with `GET /v1/creator-videos` into one strip.

- **Auth:** Public — the same admin-set playlists each tournament's own Videos tab already serves to anyone; no PII, same for every viewer. Outside the per-IP tournament-view budget (no `429` here): every home page load would otherwise spend a slot on a strip nobody navigated to.
- **Response 200:** `{ videos: … }` — entries carry the same three-way uploader attribution as `GET /v1/tournaments/:id/videos` (linked Per-Ankh user → `user_id`/`display_name`/`slug`/`avatar_url`; unlinked YouTube channel → `uploader_name`/`uploader_url`; neither → the bare video). Empty when no visible tournament has a playlist.
- **Notes:** Which tournaments contribute is read from D1 per request, so a newly-set playlist appears without an invalidation step; visibility is viewer-independent (anything past `setup`, plus `setup` with `signups_open=1`) because the response is shared-cacheable. Playlist videos come from the same per-playlist KV entries (SWR) as the per-tournament read, so a home request is one D1 read plus mostly-warm KV reads. Distinct playlist ids only — two tournaments sharing a playlist fetch it once — and a video listed on two playlists collapses to one entry. Capped at 12, matching the strip. **Unfiltered**, unlike the creator feed's Old World title filter: an admin curated the playlist for that tournament, and match VODs rarely name the game. Edge-cached 60s (`s-maxage`), no browser cache.

### `GET /v1/featured-videos`

The site-admin featured set (see [Site admin: featured videos](#site-admin-featured-videos)), newest video first. The signed-out home page leads with its first entry; the writes that curate it stay admin-only.

- **Auth:** Public — the same videos, and the same uploader identity, the creator strip and tournament playlists already serve to anyone. Outside the `anon_read` budget (no `429` here), like both sibling video feeds.
- **Response 200:** `{ videos: FeaturedVideo[] }` — the same three-way uploader attribution as [`GET /v1/admin/featured-videos`](#get-v1adminfeatured-videos). Empty when nothing is featured.
- **Notes:** Read straight from D1 — the set is a small curated table, not a platform fan-out, so there's no KV layer. Ordered `published_at DESC` (the video's own date, not when an admin starred it) and capped at 12, matching the strip. Edge-cached 60s (`s-maxage`), no browser cache, so a newly-starred video shows up on reload. Best-effort: a D1 failure answers an empty feed rather than 500-ing the home page.

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

### `POST /v1/users/me/slug`
Set the caller's profile URL (`/u/<slug>`) — claiming one, or renaming the one they have.

- **Auth:** Session.
- **Body:** JSON `{ slug: string }`. Trimmed and lowercased before validation, so mixed-case input claims the lowercase name; must then match `^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$` (3–30 chars) and not be reserved (`admin`, `staff`, `moderator`, `support`, `me`, `per-ankh`, `perankh` — impersonation/brand holds, not route safety).
- **Response 200:** `{ slug }` — the normalized value as stored. Submitting the slug the caller already holds is a no-op success and does not start a cooldown.
- **Errors:** `401 UNAUTHORIZED`, `400 INVALID_SLUG` (bad format **or** reserved; the message states the rule and is safe to show verbatim), `409 SLUG_TAKEN` (another user holds it), `429 RATE_LIMIT_SLUG_RENAME` (inside the 7-day rename cooldown; the message names the time left), `429 RATE_LIMIT_SLUG_CLAIM` (15/hr per user), `415 UNSUPPORTED_MEDIA_TYPE`, `400 INVALID_BODY`.
- **Notes:** Most callers already hold a slug — one is derived from the display name at first login (see [Profile slugs](#profile-slugs)) — so this endpoint is mostly the correction of a derived name plus renames afterwards. Uniqueness is enforced by the `users.slug` unique index rather than a pre-check, so two simultaneous claims of the same name can't both win. How often the column can *change* is bounded by a **7-day cooldown** on `users.slug_changed_at`, as a predicate in the same conditional UPDATE (the successor to 0039's set-once `slug IS NULL`, and race-safe for the same reason); how often the endpoint can be *called* is bounded separately, since every well-formed request is a real D1 write and a name-availability probe, by the `slug_claim_attempt` bucket (24h retention, metadata-free, shared with the DELETE below). `slug_changed_at` records the user's **own** changes only: a derived or operator-set slug leaves it NULL, so a user's first correction is immediate. A change writes a `slug_claim` audit event with `{ slug, previous_slug }` (awaited; 90-day retention).

### `DELETE /v1/users/me/slug`
Release the caller's profile URL, leaving them on the `/users/<user_id>` permalink.

- **Auth:** Session.
- **Response:** `204 No Content` (idempotent).
- **Errors:** `401 UNAUTHORIZED`, `429 RATE_LIMIT_SLUG_CLAIM` (the same 15/hr attempts bucket as the POST).
- **Notes:** Deliberately **not** gated by the rename cooldown — taking your name back out of a public URL always works — but it does *stamp* it, so release-then-claim isn't a way around the gate. The released name returns to the pool immediately and anyone may claim it, so an old `/u/<name>` link can end up resolving to a different person; `/users/<user_id>` is the permalink that doesn't move. Writes a `slug_release` audit event with `{ previous_slug }` (awaited; 90-day retention) only when a slug was actually held.

_(Account settings live at [`POST /v1/auth/settings`](#post-v1authsettings).)_

---

## Tournaments — reads

All reads in this section are **Public (owner extras)** unless noted: a session is optional and only unlocks admin/owner fields; anonymous callers see the public shape. Setup-phase tournaments return a `404`-shape to non-admins (unless signups are open). All are per-IP rate-limited via the `tournament_view` bucket (2400 reads/hr; `429 RATE_LIMIT_TOURNAMENT_VIEW`) **except the list**, which has its own — see below. All take the 21-char tournament `id` except detail-by-slug.

### `GET /v1/tournaments`
List tournaments.

- **Query:** `status` (`setup`|`swiss`|`championship`|`complete`), `limit` (default 20, 1–100), `offset` (default 0).
- **Response 200:** `{ tournaments: [{ tournament_id, slug, name, status, signups_open, created_at, updated_at, swiss_wins_to_advance, swiss_losses_to_eliminate, swiss_max_rounds, map_pool_size, player_count, active_round: { round_number, matches_total, matches_reported } | null, champion: { display_name, avatar_url } | null }], limit, offset }`.
- **Errors:** `429 RATE_LIMIT_TOURNAMENT_LIST`.
- **Notes:** Setup-phase rows appear only to their admins or when `signups_open`. `tournament_list_view` bucket (600/hr per IP), **not** the `tournament_view` one the rest of this section draws on: the home page fetches this list on every render, so a shared budget would let landing-page traffic close the tournament pages.

### `GET /v1/tournaments/:slug`
Tournament detail (the only read keyed by **slug**).

- **Path:** `slug` (slug regex).
- **Response 200:** `{ tournament_id, slug, name, description, status, division_a_name, division_b_name, swiss_wins_to_advance, swiss_losses_to_eliminate, swiss_max_rounds, map_pool, links, slot_counts: { swiss, championship, swiss_by_division: { A, B } }, signups_open, signup_question, youtube_playlist_url, viewer_slot: { slot_id, division, swiss_seed } | null, is_viewer_admin, is_viewer_creator, owner: { display_name, avatar_url } | null, admins: [...], starts_at, completed_at, created_at, updated_at }`.
- **Errors:** `404 TOURNAMENT_NOT_FOUND` (missing, or setup-phase to a non-admin), `429 RATE_LIMIT_TOURNAMENT_VIEW`.
- **Notes:** `viewer_slot`, `is_viewer_admin`, `is_viewer_creator` require a session (else null/false).

### `GET /v1/tournaments/:id/standings`
Swiss standings per division + combined qualifier ranking.

- **Response 200:** `{ tournament_id, divisions: { A: { name, standings: RankedStanding[] }, B: {...} }, combined_qualifier_ranking?: [...] }`. Per-row fields include `slot_id, rank, wins, losses, status, h2h, buchholz_cut1, opponents_buchholz, cumulative, division, display_name, user_id, slug, avatar_url, swiss_seed, withdrawn`; admins additionally see `signup_answer` and `discord_username` (null for public).
- **Errors:** `404 TOURNAMENT_NOT_FOUND`, `429 RATE_LIMIT_TOURNAMENT_VIEW`.

### `GET /v1/tournaments/:id/bracket`
Championship bracket.

- **Response 200:** `{ tournament_id, slots: [{ slot_id, championship_seed, display_name, user_id, slug, avatar_url }], rounds: [{ round_id, round_number, status, matches: [<serializeMatch> & { total_turns }] }] }` (championship-phase only).
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
- **Response 200:** `{ tournament_id, matches: [<serializeMatch> & { round_id, round_number, phase, division }] }`. Each match carries `status` (e.g. `pending`), `match_number`, both slots' display names/nations/avatars plus each occupant's `slot_a/b_user_id` and `slot_a/b_slug`, `map_script`, `winner_slot_id`/`game_id`/`reported_at`, and a `parts[]` array of scheduled sittings — each part `{ id, scheduled_at, casters[], streams }`, each caster `{ user_id, name, display_name, slug, avatar_url }`.
- **Errors:** `404 TOURNAMENT_NOT_FOUND`, `429 RATE_LIMIT_TOURNAMENT_VIEW`.
- **Notes:** "Upcoming" = `status: "pending"` and/or a future `parts[].scheduled_at`. Admin-only discord fields are null for public viewers.

### `GET /v1/tournaments/:id/matches/:match_id`
Single match detail.

- **Path:** `id`, `match_id` (both 21-char).
- **Response 200:** `{ ...serializeMatch, round_id, round_number, phase, division, tournament_id }`.
- **Errors:** `404 MATCH_NOT_FOUND` (missing, or the match's round isn't in this tournament), `404 TOURNAMENT_NOT_FOUND`, `429 RATE_LIMIT_TOURNAMENT_VIEW`.

### `GET /v1/tournaments/:id/videos`
Uploads from the tournament's admin-set YouTube playlist (`youtube_playlist_url`) — feeds the Videos tab, whose search filters the returned list client-side. KV-cached (stale-while-revalidate), same as the profile videos read. When `YOUTUBE_API_KEY` is configured the whole playlist is enumerated via the Data API (`playlistItems.list`, paged, capped at 500) so search can reach every video, and broadcasts are re-dated to when they aired (`videos.list`, one further unit per 50 videos — same correction as the profile videos read); without the key it falls back to the free RSS feed's ~15 most-recent entries, dated as the feed gave them.

- **Response 200:** `{ videos: [{ id, title, url, thumbnail_url, published_at, platform, …uploader }] }`, newest first (on the keyed path, by air time for live content). Each video carries uploader attribution: a linked Per-Ankh uploader adds `{ user_id, display_name, slug, avatar_url }` (Discord identity, like the creator feed); an unlinked YouTube uploader adds `{ uploader_name, uploader_url }`; a feed without an author adds neither. Empty when no playlist is configured or the stored value no longer parses.
- **Errors:** `404 TOURNAMENT_NOT_FOUND`, `429 RATE_LIMIT_TOURNAMENT_VIEW`.

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
- **Body:** `PatchTournamentSchema` (all optional) — `name`, `description`, `division_a_name`/`division_b_name`, `swiss_wins_to_advance`/`swiss_losses_to_eliminate`/`swiss_max_rounds`, `map_pool`, `links` (`LinksSchema`: ≤16 of `{ label, url }`), `signups_open` (boolean), `starts_at` (nullable ISO-8601), `signup_question` (nullable, ≤2000), `youtube_playlist_url` (nullable YouTube playlist URL, ≤500 — validated to a youtube.com host + list id).
- **Response 200:** `{ tournament }` (the full row).
- **Errors:** `409 TOURNAMENT_LOCKED` (swiss-config edit when status ≠ setup), `409 INVALID_PHASE` (`signups_open` while locked), `400 INVALID_THRESHOLDS`, `400 MAP_OPTIONS_INVALID`, `409 TOURNAMENT_COMPLETE` / `409 MAP_POOL_LOCKED` (map-pool edits), `500 MAP_CONFIG_INVALID`, plus auth/body codes.
- **Notes:** Swiss config freezes once status ≠ setup. The map pool is append-only after setup (existing entries frozen; new ones may be added) and fully frozen when complete. `links` / `starts_at` / `signup_question` / `youtube_playlist_url` are never phase-locked.

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

### `POST /v1/tournaments/:id/slots/swap`
Swap the occupants of two same-phase slots (identity moves; the seat — seed, division, match history — stays). Re-pairs the people in every pending match the seats are in, e.g. to unblock a round-1 match when one player is unavailable.

- **Body:** `SwapSlotsSchema` — `{ slot_a_id, slot_b_id }`.
- **Response 200:** `{ slots: [SlotRow, SlotRow] }` (the two updated slots).
- **Errors:** `400 SAME_SLOT`, `404 SLOT_NOT_FOUND`, `409 PHASE_MISMATCH`, `409 SLOT_WITHDRAWN`, `409 TOURNAMENT_LOCKED` (cross-division after start), `409 SLOT_HAS_RESULTS` (either seat has a decided match — incl. a bye — so results can never be reattributed).

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

### `POST /v1/tournaments/:id/rounds/:round_id/matches`
Add a match to an open Swiss round (late pairing) — the catch-up game for a substitute reinstated after the round was paired.

- **Auth:** Tournament admin.
- **Body:** `{ slot_a_id, slot_b_id }`.
- **Response 201:** `{ match }` — pending, map auto-assigned by the round-generation engine (fresh-map rule), next `match_index`/`match_number`, pick order to `slot_b`. The round won't auto-close until this match is reported; there is no un-add.
- **Errors:** `404 ROUND_NOT_FOUND`/`SLOT_NOT_FOUND`, `400 SAME_SLOT`, `409 TOURNAMENT_LOCKED` (not swiss) / `ROUND_CLOSED` / `WRONG_DIVISION` / `SLOT_WITHDRAWN` / `SLOT_INACTIVE` (already advanced or eliminated) / `ALREADY_PAIRED`.

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

- **Auth:** Session (any logged-in user who isn't a participant in the match).
- **Path:** `id`, `match_id` (21-char), `part_id` (1–40 chars).
- **Body:** `CastMatchPartSchema` — `{ role?: "streamer" | "cocaster", stream_url?: string }` (role defaults: streamer if the part has no caster, else co-caster). `stream_url` (YouTube/Twitch allowlist) is saved to the account (`users.stream_url`) before the cast applies — the one-time "remember my stream" path.
- **Response:** `204 No Content` (refetch to see the result).
- **Errors:** `400 INVALID_BODY`, `401 UNAUTHORIZED`, `403 PARTICIPANT_CANNOT_CAST`, `404 MATCH_NOT_FOUND` / `PART_NOT_FOUND`, `409 MATCH_NOT_PENDING` / `TOO_MANY_CASTERS` / `CONFLICT`, `429 RATE_LIMIT_TOURNAMENT_SCHEDULE`.
- **Notes:** Self-only (keyed by your `user_id`); the caster name is snapshotted from your Discord username. Casting is third-party: either slot's occupant is refused with `403 PARTICIPANT_CANNOT_CAST` (distinct from `NOT_MATCH_PARTICIPANT`, which means the inverse). Taking the streamer slot auto-attaches your stored stream link to the part's streams (skipped for co-casters, already-listed URLs, and at the 20-stream cap). CAS on `parts_rev`; max 10 casters/part. Shares the `tournament_schedule` budget.

### `DELETE /v1/tournaments/:id/matches/:match_id/parts/:part_id/casters/me`
Remove yourself as a caster.

- **Auth:** Session.
- **Path:** `id`, `match_id` (21-char), `part_id` (1–40 chars).
- **Response:** `204 No Content`.
- **Errors:** `401 UNAUTHORIZED`, `403 PARTICIPANT_CANNOT_CAST`, `404 MATCH_NOT_FOUND` / `PART_NOT_FOUND`, `409 MATCH_NOT_PENDING` (bye) / `CONFLICT`, `429 RATE_LIMIT_TOURNAMENT_SCHEDULE`.
- **Notes:** Self-only. Allowed even on decided matches (byes still rejected). Casting is third-party in both directions, so either slot's occupant is refused here too — a player never has a caster entry on their own match to remove. Also removes your stored stream link (matched by URL) from the part's streams, undoing the cast auto-attach.

---

## Tournaments — admins

### `GET /v1/tournaments/:id/admins`
List a tournament's admins.

- **Auth:** Tournament admin (the read still requires admin and consumes the admin rate-limit budget).
- **Path:** `id` (21-char).
- **Response 200:** `{ admins: [{ user_id, display_name, slug: string|null, avatar_url, is_creator: boolean }] }` (ordered by grant time).
- **Errors:** `401 UNAUTHORIZED`, `403 NOT_TOURNAMENT_ADMIN`, `429 RATE_LIMIT_TOURNAMENT_ADMIN`, `404 TOURNAMENT_NOT_FOUND`.
- **Notes:** The only tournament endpoint that exposes admin `user_id`s (public detail hides them).

### `POST /v1/tournaments/:id/admins`
Grant co-admin.

- **Auth:** Tournament admin.
- **Path:** `id` (21-char).
- **Body:** `GrantAdminSchema` — `{ user_id: string }` (21-char).
- **Response 201:** `{ admin: { user_id, display_name, slug, avatar_url, is_creator } }` — the same shape the list endpoint returns.
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

### `GET /v1/users/me/opponents`
Your ten suggested opponents — players you should get a close game against.

- **Auth:** Session.
- **Response 200:** `{ opponents: [{ user_id, display_name, slug, avatar_url, discord_url, meetings, badges }], rated }`. `discord_url` is their Discord profile, built from the snowflake `avatar_url` already carries — no `discord_*` field is serialized, and the handle never is. `meetings` is how many rated games the pair has already played; `badges` is a subset of `active_this_week` / `new_here` / `bridges_circles`; `rated` is whether the viewer has any rated multiplayer game at all, which is what separates "nothing yet" from "nothing this week".
- **Errors:** `401 UNAUTHORIZED`.
- **Notes:** There is no by-user-id form of this route, by design — a player sees only their own list. The response carries no rating, win probability or score, and neither does the table behind it (migration 0045); the model runs entirely inside the Worker. The list is rebuilt by the nightly cron and shuffled, so its order is not a ranking. An empty list is a normal answer.

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

- **Query:** `version` (required); optional section filters — see below.
- **Response 200:** `AdminGameListResponse` — `{ games: AdminGameListItem[] }` (GameListItem + `user_id`, `owner_display_name`).
- **Errors:** `404 NOT_FOUND`, `400 INVALID_QUERY`.

### `GET /v1/admin/games/all`
All game ids/names (drives the reindex sweep).

- **Query:** optional section filters — see below.
- **Response 200:** `AdminGameIdListResponse` — `{ games: [{ game_id, game_name }] }`.
- **Errors:** `404 NOT_FOUND`, `400 INVALID_QUERY`.

**Section filters** (both list endpoints, all optional, AND-composed) let the admin page run a sweep over one slice of the corpus at a time:

| Param | Value | Selects |
| --- | --- | --- |
| `user_id` | 21-char id | games owned by that user |
| `tournament_id` | 21-char id | games linked to that tournament's `status='complete'` matches (the same set `/v1/tournaments/:id/stats` aggregates) |
| `from` | `YYYY-MM-DD` | games uploaded on or after that day |
| `to` | `YYYY-MM-DD` | games uploaded on or before that day |

`from`/`to` bound `games.created_at`, which is UTC and is preserved across re-import. Empty values are treated as absent; a malformed value is `400 INVALID_QUERY` rather than a silently unfiltered sweep.

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

## Site admin: featured videos — `/v1/admin/featured-videos*`

All **Site admin** (`ADMIN_DISCORD_ID`). Non-admins receive `404 NOT_FOUND` (existence hidden).

The curated set of videos an admin has starred from any video card. These are the only videos stored in D1 — every other video surface (the home creator strip, a profile's Videos tab, a tournament's playlist) reads live from the platform and caches in KV. A featured video ages out of the feed it came from (a channel's RSS returns ~15 entries), so each row is a **snapshot** of the fields the platform owns. The uploader's name and avatar are deliberately not snapshotted: a stored `user_id` is joined against `users` at read time (so a rename follows), and `uploader_name`/`uploader_url` carry an unlinked YouTube channel.

Writes are admin-only; the set itself is public — see [`GET /v1/featured-videos`](#get-v1featured-videos).

### `GET /v1/admin/featured-videos`
The whole featured set, newest video first (`published_at DESC`). Uncapped — the set is hand-curated.

- **Response 200:** `{ videos: FeaturedVideo[] }`, each `{ id, title, url, thumbnail_url, published_at, platform }` plus one of three uploader attributions: `user_id, display_name, slug, avatar_url` (a linked Per-Ankh user), `uploader_name, uploader_url` (an unlinked YouTube channel), or nothing at all. The same three-way shape [`GET /v1/tournaments/:id/videos`](#get-v1tournamentsidvideos) returns.
- **Errors:** `404 NOT_FOUND`.

### `POST /v1/admin/featured-videos`
Feature a video, by snapshot.

- **Body:** JSON `{ platform, video_id, url, title, published_at }` plus optional `thumbnail_url`, `user_id`, `uploader_name`, `uploader_url` (each defaulting to null). `platform` must have a registered provider (`youtube`); `url`/`thumbnail_url`/`uploader_url` must be http(s) — they're rendered as hrefs.
- **Response 200:** `{ ok: true }`.
- **Errors:** `404 NOT_FOUND`, `400 INVALID_BODY` / `INVALID_JSON`, `415 UNSUPPORTED_MEDIA_TYPE`.
- **Notes:** Upserts on `(platform, video_id)` — re-featuring a video already in the set refreshes its snapshot (and its `featured_at`/`featured_by`) rather than failing. Omitted attribution fields are cleared, not preserved: the write is a whole-row replace, not a patch.

### `DELETE /v1/admin/featured-videos/:platform/:video_id`
Unfeature.

- **Path:** `platform` (lowercase), `video_id` (≤64 chars of `[A-Za-z0-9_-]`).
- **Response 200:** `{ ok: true }`.
- **Errors:** `404 NOT_FOUND` (non-admin only).
- **Notes:** Idempotent — deleting a video that isn't featured still succeeds, so the card star and the Featured tab's Remove don't have to agree on which got there first.

### `POST /v1/admin/ratings/rebuild`
Rebuild the rating cache and every player's suggested-opponent list now, instead of waiting for the nightly cron.

- **Auth:** Session + **site admin**.
- **Response 200:** `{ users, ratableDuels, recommended, stats }` — how many players were rated, how many duels the model could reconstruct, how many ended up with a list, and the extraction diagnostics (`tournament`, `casual`, `deduped`, `casualGamesScanned`, `unresolvedOpponent`, `ambiguousOnlineId`).
- **Errors:** `404 NOT_FOUND` (non-admin), `500 REBUILD_FAILED`.
- **Notes:** Idempotent and full-replace; takes no body. Run it after the reindex sweep has backfilled `player_summaries.online_id`, which is what lets a casual game's opponent be identified at all. Audited as `ratings_rebuild`. The nightly cron runs the same job unaudited — the audit trail records people, not schedules.

---

## Diagnostics

### `POST /v1/csp-report`
Receive CSP violation reports from browsers.

- **Auth:** Public (no auth, no rate limit).
- **Body:** raw text — legacy `application/csp-report` (single object) or Reporting-API `application/reports+json` (array); max 64 KB.
- **Response:** `204 No Content` (also for empty/unknown/zero-violation bodies).
- **Errors:** `413` (> 64 KB), `400` (unreadable / invalid JSON).
- **Notes:** Each violation is logged as `csp_violation`. No CORS headers on the response itself.

