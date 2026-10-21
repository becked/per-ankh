---
name: admin-cli
description: >-
  Operate the live Per-Ankh app via `./per-ankh admin` — inspect or manage
  users, games, events, security, and tournaments — or run the
  local-only dev helpers (dev-login, tournament seed). Use when the user asks
  to look up a user/game, check stats or events, moderate/block/nuke shares,
  grant tournament beta/admin, seed a local fixture, or mint a local dev
  session. NOT for writing app code.
metadata:
  type: project
  implementation: scripts/admin/
---
# Cloud Admin CLI (`./per-ankh admin`)

**Red line — read first.** `./per-ankh admin` defaults to **production**. Never run it against production or with `--staging`/`--remote` — including read-only reads — unless the user's current message explicitly asks for that exact command; ask first. It authenticates against the user's Cloudflare account (a 1Password prompt on this machine). Only the `--local` path (and the hard-local-only `dev-login` / `tournament seed`) is safe to run unprompted.

`./per-ankh admin` is the operator CLI for the live app. Implementation lives under `scripts/admin/`. Calls `wrangler` directly (no API key — relies on `wrangler login`). Run `./per-ankh admin --help` for the full list. The list below is illustrative, not exhaustive — `--help` groups the full surface (Stats, Users, Creator channels, Games, Events, Corpus sweeps, Security, Tournaments, Caches, Dev).

```bash
./per-ankh admin stats                       # Global counts + recent activity
./per-ankh admin users [--limit N] [--sort recent|uploads|created]
./per-ankh admin user <user_id>              # Detail (games, collections, online_ids)
./per-ankh admin add-channel <user_id> <url|@handle>   # Link a creator's YouTube channel to a user (resolves + upserts)
./per-ankh admin remove-channel <user_id> <platform>  # Unlink a user's channel
./per-ankh admin list-channels [--limit N]            # All linked creator channels (roster for the home strip)
./per-ankh admin games [--limit N] [--user U]
./per-ankh admin events [--type T] [--user U]
./per-ankh admin nuke-user <user_id>         # Delete cloud user + games + R2 blobs (type "nuke")
```

**The delete paths need `CLOUDFLARE_PURGE_TOKEN` exported.** `delete-game`, `purge-games` and `nuke-user` also remove the games' screenshots — a second bucket, and public — so they purge the image URLs from the edge, and `wrangler` has no purge command to do it with. The token is the only thing to provide: the zone id is read out of `cloud/wrangler.toml` per target, the same file the Worker gets it from, so there is no committed value to retype. Without the token the objects are still deleted and the command warns, naming what is missing: the edge keeps serving them for up to the 30-day Edge TTL, which has no other symptom than the picture still being there.

## Corpus sweeps

`./per-ankh admin reparse-all [--dry-run] [--user U] [--limit N] [--from-version V] [--concurrency N] [--cache-dir DIR]` reparses every game whose stored `parser_version` isn't the current one — the headless equivalent of the account page's bulk-reparse button and the admin page's sweep, which drive the same work one game at a time in a browser tab. Per game: read `saves/<game_id>.zip` out of R2, parse it locally under `tsx` (nothing in `src/lib/parser/` is browser-bound), carry the uploader's stored seat (`player_summaries.is_uploader`) through unchanged, and POST the fresh blob to `POST /v1/admin/games/:user_id/reparse-upload`. Every write stays the Worker's — the re-import branch of `handleGameUpload` is what preserves screenshots, collections and tournament links across the `INSERT OR REPLACE`, and nothing here reimplements it.

**The destination is never a flag.** The blob posted is whatever the local parse produces, so it carries this checkout's `PARSER_VERSION` — which is what the selection is compared against. `--from-version V` only narrows that selection to the games stored at exactly `V` (one cohort: `--from-version 2.15.0` was 273 games in the snapshot below), and it can only narrow it, so no run spends a download, a parse and an upload on a game that is already current just to earn its `409`.

**It needs `ADMIN_CLI_TOKEN` exported** — the sweep has no session, and that endpoint is the one admin route accepting a bearer token instead (set per environment with `wrangler secret put ADMIN_CLI_TOKEN`; `ADMIN_DISCORD_ID` must also be set there, and that account must have signed in once, because the audit row names it). Without the token the command refuses and says so; `--dry-run` lists what it would touch and needs no token. Against `--local` it also reads the token out of `cloud/.dev.vars`, so a local sweep can't disagree with the Worker `./per-ankh dev` is running.

Start with `--dry-run`, then `--limit 5` against staging before the whole corpus. Each game is one re-upload and one blob rewrite, and the whole corpus is 992 games — all 992 of them stale at parser 2.26.0, the oldest cohorts being 2.15.0 ×273, 2.17.0 ×163 and 2.14.0 ×120 (local D1 snapshot, 2026-10-06) — hence the confirmation prompt (`--yes` to skip). Rows that reparsed are summarised as a count; the table lists only what needs a human — a `409` skip (the stored parse isn't older, which is what a checkout behind the deployed frontend hits), a save missing from R2, or an ambiguous nation match. One case can never be swept: a **challenge map or run is an in-progress game**, `challenge_id` is rejected on an admin reparse, and without it the Worker's `game_over` gate refuses the upload — so those are reported as skips and stay at the version they were uploaded with.

`./per-ankh admin duel-event-titles [--csv] [--out FILE] [--concurrency N] [--cache-dir DIR]` lists the event stories that have fired in a two-player multiplayer duel, one row per event type with the counts an event balance pass needs: `games` (duel games it fired in), `player_games` (player slots that fired it, at most two per game), and `character_city_records` (characters and cities holding their own record of it). `--csv` writes a spreadsheet instead of the markdown table. Unlike every other read command it is a **sweep**: one `wrangler` spawn per matching save (hundreds), so budget minutes, not seconds. Saves land in `--cache-dir` and are reused, so a second run to reshape the output reads nothing remote.

It reads the raw ZIPs rather than the parsed blobs on purpose — `story_events` only began carrying a game's whole history at parser 2.14.0, and older blobs hold just the newest 100 player-scoped rows with no character- or city-scoped ones at all. The save itself is the authoritative record of what fired.

## Tournaments

`./per-ankh admin tournament <sub>` — `create`, `list`, `show`, `delete`, `grant-admin`, `revoke-admin`, `seed`, `beta-grant`, `beta-revoke`, `beta-list`:

```bash
./per-ankh admin tournament beta-grant <discord_id>    # Add to the tournament create-allowlist (CLI-only)
./per-ankh admin tournament beta-list                  # Show the create-allowlist
./per-ankh admin --local tournament seed <slug> [name] # Build a full local fixture (see below)
```

Build a full local fixture (Swiss + championship via the real planner) with `./per-ankh admin --local tournament seed <slug> [name]`, flags `--qualifiers N` (default 6), `--players-per-division N` (default 8), `--fill mid-swiss|swiss-done|mid-championship|complete` (default `mid-championship`).

## Caches (KV)

`./per-ankh admin cache list [--kind stats|videos] [--match S] [--limit N]` and `./per-ankh admin cache clear <stats|videos|all> [--match S]` inspect and drop the two KV caches — stats bundles (`cloud/src/stats/cache.ts`) and YouTube feeds (`cloud/src/video/cache.ts`). Both share the `SESSIONS_KV` namespace with `session:`/`oauth:` keys; the command's prefix allowlist is what keeps those unreachable, so no flag combination can sign users out.

```bash
./per-ankh admin cache list --kind stats --match ':user:abc123:'   # One user's bundles
./per-ankh admin cache clear stats --match 'stats:v7-'             # Drop one schema version
./per-ankh admin cache clear videos                                # Force a YouTube refetch
```

Unlike the Worker's `invalidateStatsCache` (which walks only the current `BUNDLE_SCHEMA_VERSION`), `clear` sweeps every schema version under the prefix — that's what reaches entries orphaned by a version bump. Clearing `videos` costs YouTube Data API quota on the next playlist view.

**The parsed-game blob cache is a different layer and this command cannot reach it.** It caches R2 bytes for `games/{id}.json.gz` in each POP's Cache API storage (`cloud/src/blob-cache.ts`), which has no CLI surface — `wrangler` has no cache command, and zone purge can't address the keys because they're synthetic and belong to no zone. It also needs no operator action: the key carries the game's `parser_version`, so a reparse drifts the key and every POP misses at once. If a game somehow serves stale bytes anyway, that's the D1-batch-rollback path in `handleGameUpload` (the Worker evicts locally there) and the entry expires on its own within 24h. The `Cache-Control: s-maxage` directives on game responses are live at the edge as of `[cache]` (`cloud/wrangler.toml`, issue #291) — a public game-detail response is stored in front of the Worker for 60s, keyed on the URL and the verbatim `Cookie` string — and they are no more reachable from this CLI than the blob tier is, for the same reason: `wrangler` has no cache command. The 60s is short because a Make Private toggle has to propagate (`cloud/src/games.ts`), which is also why there is nothing here for an operator to clear by hand.

## Dev (local only)

`./per-ankh admin --local dev-login [--username NAME]` provisions a fake local user + 30-day session cookie (and adds them to the tournament create-allowlist) for testing a second account. Both `tournament seed` and `dev-login` are **local-only** and refuse to run against remote (staging included). For the browser-side Discord-free login bypass, see `docs/dev-login.md`.

## Flags & targeting

Add `--json` to any read command for pipeable output; add `--yes` to skip confirmation on destructive ops. `--local` targets the local `.wrangler` state; `--staging` targets the staging D1/R2 (remote, mutually exclusive with `--local`); the default is **production**. The dev-only commands (`dev-login`, `tournament seed`) refuse both remote targets, staging included.
