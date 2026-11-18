---
name: admin-cli
description: >-
  Operate the live Per-Ankh app via `./per-ankh admin` — inspect or manage
  users, games, events, security, tournaments, and the Explore ask off
  switch — or run the local-only dev helpers (dev-login, tournament seed).
  Use when the user asks to look up a user/game, check stats or events,
  moderate/block/nuke shares, grant tournament beta/admin, switch the Explore
  ask input off or on or check its month's spend, seed a local fixture, or
  mint a local dev session. NOT for writing app code.
metadata:
  type: project
  implementation: scripts/admin/
---
# Cloud Admin CLI (`./per-ankh admin`)

**Red line — read first.** `./per-ankh admin` defaults to **production**. Never run it against production or with `--staging`/`--remote` — including read-only reads — unless the user's current message explicitly asks for that exact command; ask first. It authenticates against the user's Cloudflare account (a 1Password prompt on this machine). Only the `--local` path (and the hard-local-only `dev-login` / `tournament seed`) is safe to run unprompted.

`./per-ankh admin` is the operator CLI for the live app. Implementation lives under `scripts/admin/`. Calls `wrangler` directly (no API key — relies on `wrangler login`). Run `./per-ankh admin --help` for the full list. The list below is illustrative, not exhaustive — `--help` groups the full surface (Stats, Users, Creator channels, Games, Events, Corpus sweeps, Security, Tournaments, Caches, Explore ask, Dev).

```bash
./per-ankh admin stats                       # Global counts + recent activity
./per-ankh admin users [--limit N] [--sort recent|uploads|created]
./per-ankh admin user <user_id>              # Detail (games, collections, online_ids)
./per-ankh admin add-channel <user_id> <url|@handle>   # Link a creator's YouTube channel to a user (resolves + upserts)
./per-ankh admin remove-channel <user_id> <platform>  # Unlink a user's channel
./per-ankh admin list-channels [--limit N]            # All linked creator channels (roster for the home strip)
./per-ankh admin games [--limit N] [--user U]
./per-ankh admin events [--type T] [--user U]
./per-ankh admin online-ids check            # Flag links that credit seats to the wrong account
./per-ankh admin online-ids unlink <user_id> <online_id>   # Remove one link
./per-ankh admin set-uploader <game_id> <player_index|observer>  # Change which seat the owner claimed
./per-ankh admin nuke-user <user_id>         # Delete cloud user + games + R2 blobs (type "nuke")
```

**The delete paths need `CLOUDFLARE_PURGE_TOKEN` exported.** `delete-game`, `purge-games` and `nuke-user` also remove the games' screenshots — a second bucket, and public — so they purge the image URLs from the edge, and `wrangler` has no purge command to do it with. The token is the only thing to provide: the zone id is read out of `cloud/wrangler.toml` per target, the same file the Worker gets it from, so there is no committed value to retype. Without the token the objects are still deleted and the command warns, naming what is missing: the edge keeps serving them for up to the 30-day Edge TTL, which has no other symptom than the picture still being there.

## Corpus sweeps

`./per-ankh admin reparse-all [--dry-run] [--user U] [--limit N] [--from-version V] [--concurrency N] [--cache-dir DIR]` reparses every game whose stored `parser_version` isn't the current one — the headless equivalent of the account page's bulk-reparse button and the admin page's sweep, which drive the same work one game at a time in a browser tab. Per game: read `saves/<game_id>.zip` out of R2, parse it locally under `tsx` (nothing in `src/lib/parser/` is browser-bound), carry the uploader's stored seat (`player_summaries.is_uploader`) through unchanged, and POST the fresh blob to `POST /v1/admin/games/:user_id/reparse-upload`. Every D1 and R2 write stays the Worker's — the re-import branch of `handleGameUpload` is what preserves screenshots, collections and tournament links across the `INSERT OR REPLACE`, and nothing here reimplements it. One write is the command's own: when a run reparsed at least one game it clears the stats bundles out of KV at the end, once for the whole sweep, the same thing `cache clear stats` does. Each reparse rewrote that game's `game_player_turn` rows and no bundle key drifts on a reparse, so without it the user, global and tournament bundles keep serving pre-sweep numbers for their full 24h TTL — and the crons don't cover it: the nightly precompute is hours later, the hourly warm only rebuilds bundles that are *missing*, and a tournament bundle has no cron at all. The count is in the run's summary and in `--json`.

**The destination is never a flag.** The blob posted is whatever the local parse produces, so it carries this checkout's `PARSER_VERSION` — which is what the selection is compared against. `--from-version V` only narrows that selection to the games stored at exactly `V` (one cohort: `--from-version 2.15.0` was 273 games in the snapshot below), and it can only narrow it, so no run spends a download, a parse and an upload on a game that is already current just to earn its `409`.

**It needs `ADMIN_CLI_TOKEN` exported** — the sweep has no session, and that endpoint is one of the two admin routes accepting a bearer token instead, the other being the reindex endpoint `reindex-all` posts to (set per environment with `wrangler secret put ADMIN_CLI_TOKEN`; `ADMIN_DISCORD_ID` must also be set there, and that account must have signed in once, because the audit row names it). Without the token the command refuses and says so; `--dry-run` lists what it would touch and needs no token. Against `--local` it also reads the token out of `cloud/.dev.vars`, so a local sweep can't disagree with the Worker `./per-ankh dev` is running.

Start with `--dry-run`, then `--limit 5` against staging before the whole corpus. Each game is one re-upload and one blob rewrite, and the whole corpus is 992 games — all 992 of them stale at parser 2.26.0, the oldest cohorts being 2.15.0 ×273, 2.17.0 ×163 and 2.14.0 ×120 (local D1 snapshot, 2026-10-06) — hence the confirmation prompt (`--yes` to skip). Rows that reparsed are summarised as a count; the table lists only what needs a human — a `409` skip (the stored parse isn't older, which is what a checkout behind the deployed frontend hits), a save missing from R2, or an ambiguous nation match. One case can never be swept: a **challenge map or run is an in-progress game**, `challenge_id` is rejected on an admin reparse, and without it the Worker's `game_over` gate refuses the upload — so those are reported as skips and stay at the version they were uploaded with.

`./per-ankh admin reindex-all [--dry-run] [--user U] [--limit N] [--concurrency N]` rebuilds every game's derived D1 rows from its stored blob. It is the headless equivalent of the admin page's reindex sweep (`BulkReindexModal`). Use it after a migration adds a column or table that the pivot fills from data the blob already holds; a field the blob never carried needs `reparse-all` instead. Nothing is downloaded or parsed: each game is one `POST /v1/admin/games/:id/reindex`, and the Worker does the write. It deletes and rebuilds that game's derived child tables (`player_summaries`, `game_player_turn`, the tech, law and wonder event tables, and the rest `handleAdminReindex` lists), bumps `games.updated_at`, writes an `admin_reindex` audit row, and clears every stats bundle. The command has no write of its own. The selection is every game, newest first; `--user` narrows it to one owner and `--limit` caps it. It needs `ADMIN_CLI_TOKEN` the same way `reparse-all` does, and `--dry-run` needs no token. Rows that reindexed are summarised as a count; the table lists only games whose blob is missing from R2 and failures.

`./per-ankh admin duel-event-titles [--csv] [--out FILE] [--concurrency N] [--cache-dir DIR]` lists the event stories that have fired in a two-player multiplayer duel, one row per event type with the counts an event balance pass needs: `games` (duel games it fired in), `player_games` (player slots that fired it, at most two per game), and `character_city_records` (characters and cities holding their own record of it). `--csv` writes a spreadsheet instead of the markdown table. Unlike every other read command it is a **sweep**: one `wrangler` spawn per matching save (hundreds), so budget minutes, not seconds. Saves land in `--cache-dir` and are reused, so a second run to reshape the output reads nothing remote.

It reads the raw ZIPs rather than the parsed blobs on purpose — `story_events` only began carrying a game's whole history at parser 2.14.0, and older blobs hold just the newest 100 player-scoped rows with no character- or city-scoped ones at all. The save itself is the authoritative record of what fired.

`./per-ankh admin saves pull [--sample N] [--seed S] [--out DIR] [--dry-run] [--concurrency N] [--cache-dir DIR]` draws a stratified sample of games and writes their original save ZIPs into `test-data/saves/`, so a claim measured "across the corpus" is measured across something representative rather than across one player's save folder. It is the only way to get at a stored save locally: `./per-ankh backup` is D1 only (`restore` prints `R2 / KV: untouched`), so a snapshot gives metadata rows and no archive.

**The draw is a coverage floor first, then proportional.** The pool spreads over `game_mode` × `map_size` × `victory_type`, and two in five of those cells hold a single game — so a straight proportional draw of 100 reproduces the common case the hand-copied saves already cover and misses nearly every cell. Phase 1 is therefore a greedy set cover over every cell *and* every value of `map_class`, the `total_turns` band and `parser_version`; phase 2 spends the remainder proportionally (highest averages over cell size). Against the 2026-10-23 remote snapshot that is 81 cells over 935 games, 32 of them holding one game, so a `--sample 100` draw spends most of its slots on the floor and the remainder proportionally (84 and 16 over the 78 cells of a 820-row local D1). `--sample` below the floor is allowed and warns, naming what it left unrepresented. `--seed` fixes the draw (default `per-ankh`, so a plain run is reproducible).

**The pool is deduped on `xml_game_id`, not on `game_id`.** An observer's upload and the player's own upload of the same match are two `games` rows — `UNIQUE (user_id, file_hash)` does not collapse them — and in that snapshot 1,095 rows carry 935 distinct `xml_game_id`. Where both exist the player's own upload wins, because it is the one that claimed a seat.

**Game version is reported, not selected.** The build version is not a column: it is in the Root `Version` attribute, alongside the `+`-separated mod tokens. So each save is parsed once it lands and the realized build and mod spread is reported — a draw cannot target a version band, and an empty band is answered by raising `--sample` or changing `--seed`, not by a filter. The parse is also what catches a save this corpus could not read.

Each pulled file is named for its shape (`network-smallest-conquest-t72-<game_id>.zip`), which is also the resume marker: a name is a function of the game's D1 columns, so a re-run re-reads its own output and spends no remote reads. `pull-manifest.json` lands beside the saves with every pick, the requirements it was picked for, the realized spread and the byte total. Saves carry other players' names and `online_id`, and `.gitignore` holds `test-data/saves/` to its README, `.gitkeep` and `sample.xml` — so nothing pulled, manifest included, can be committed. Start with `--dry-run`, which prints the per-cell allocation and the per-dimension spread without downloading anything.

## Seat attribution (`user_online_ids`)

`./per-ankh admin online-ids check [--kind K]` reads the table that decides which account a seat belongs to, and flags the links that credit seats to the wrong one. `./per-ankh admin online-ids unlink <user_id> <online_id>` removes one.

Why there is a command at all: `captureOnlineIds` (`cloud/src/online-ids.ts`) is the table's only writer and it writes one row per **claimed** seat, so a user who picks the wrong human in the upload picker links themselves to that player's id. Nothing removes the row again — `handleGamePatch` keeps ids "learned from other games" when the uploader seat moves (`cloud/src/games.ts`) — and `PLAYER_USER_ID_SQL` (`cloud/src/query/catalog.ts`) then credits that player's seats to the wrong account on **every** identity surface at once: the played-games board, the duel rating model and Explore. The user-facing escape hatch, `DELETE /v1/users/me/online-ids/:online_id`, is callable only by the account holder and no screen calls it, which leaves the cross-account cases — where the account holding the bad link is not the player it harms — reachable from nowhere else.

Three checks, each reporting one row per link, `--kind` to run one alone:

- **`uncorroborated`** — the user has no claimed seat carrying this id, so nothing they did says the id is theirs. Precise: 1 of 77 links in the 2026-11-15 production snapshot.
- **`ambiguous`** — two or more accounts claim the id. `UNAMBIGUOUS_ONLINE_ID_OWNERS_SQL` resolves it to nobody rather than guess, so every seat carrying it leaves the board, the rating model and Explore at once and no surface says so. A genuinely shared account is a legitimate instance (it is one of migration 0003's reasons the table is many-to-many), so this check reports rather than condemns.
- **`name-mismatch`** — no seat carrying the id plays under a name the account answers to, although the account's own claimed seats do. This is the one that reaches a wrong claim nobody corrected, which `uncorroborated` cannot see: the claim corroborates the link, so only the names give it away.

Each flagged row also carries the **claim** behind it: CLAIMS is how many seats that user claimed carrying the id, and CLAIM names the first of them by game and seat. That column is the second half of the repair, because an unlink on its own expires — `reparse-all` posts the stored seat back verbatim (`scripts/admin/commands/reparse.ts`) and `handleGameUpload` re-runs `captureOnlineIds` on it, so a link with a claim behind it returns on the next parser bump. Six of the seven links removed from staging on 2026-11-15 had one. CLAIMS is also what separates a one-off misclaim from the real owner: in that snapshot every wrong link had exactly one claim and every correct owner had dozens.

Read the SEAT NAMES column before acting. It is the whole evidence: an id whose seats are all some other player's handle is the shape a wrong claim leaves, and an in-game name that simply differs from a Discord one is not. The second half of `name-mismatch` — that the account does generally play under its own name — is what keeps it readable: 859 of 1,213 claimed seats match their account's name, and 18 of 68 users have no claimed seat that matches theirs, so a bare name comparison would flag every link those 18 hold.

`unlink` prints the link, the seats it credits and whether the user has a claimed seat carrying the id, then takes a typed `unlink` confirmation (`--yes` skips it). SEATS counts public seats the user did **not** upload, which is exactly what stops being credited — the uploader's own claimed seat is credited by the other arm of `PLAYER_USER_ID_SQL` whatever the link says, so unlinking never touches it. Audited as `unlink_online_id`, distinct from the Worker's `online_id_remove` for the reason `delete_game` is distinct from `delete`: different actors, and the trail has to tell them apart. If the user's own claim still carries the id, the command warns that the link returns on their next upload.

### `set-uploader`

`./per-ankh admin set-uploader <game_id> <player_index | observer>` changes which seat a game's owner claimed. It is the operator half of `PATCH /v1/games/:id { uploader_player_index }`, which the owner drives from the game page's player popover (`src/lib/GameActions.svelte`) and which is owner-only with no admin override — so the cross-account repairs, where the account holding a bad claim is not the player it harms, are reachable from nowhere else.

**There is no single right repair, so the command takes the seat rather than assuming one.** Of the six leftover claims on staging, four wanted `observer` (the uploader was not in the roster at all), one wanted a different seat in the same game (Siontific claimed "Nizar" while sitting in seat 1), and one wanted nothing: Akuukis claimed their own seat in a save that wrote one `online_id` onto *both* human seats, so the claim is right and only the link was wrong. That last shape is rare but real — 14 of 986 games and 28 of 1,942 human seats on staging carry a non-empty id covering more than one human.

Three of `handleGamePatch`'s guards carry over, because they are rules about the data rather than about who is asking: a tournament-linked save is locked (the match's slot mapping is the historical record of which player the uploader was), a run on an open challenge is locked (its verdict is scored once and never rescored), and the index must name a human seat in that game. The per-user rate limit does not carry over — it is an abuse guard on a public endpoint.

The pick is validated against `player_summaries` rather than the R2 blob the Worker reads. The table is that blob's pivot, and the two columns this writes derive identically from it: across the 798 claimed games in the 2026-11-15 local snapshot, the seat's `nation` and `is_winner` reproduce the stored `games.user_nation` and `user_won` on every row, including NULL `user_won` for the 26 games no seat won. The write clears `is_uploader` before setting it, the same ordering `handleGamePatch` uses, because migration 0053's partial unique index is checked per row.

Audited as `set_uploader`. It clears that owner's stats bundles — the Worker does this on the same change and a direct D1 write bypasses it — and reports the count. Duel ratings read `is_uploader` and rebuild on the 03:47 cron (`cloud/src/ratings/rebuild.ts`), so they keep the old attribution until then or until `POST /v1/admin/ratings/rebuild`; the command says so rather than doing it, since there is no CLI surface for that rebuild.

## Tournaments

`./per-ankh admin tournament <sub>` — `create`, `list`, `show`, `delete`, `grant-admin`, `revoke-admin`, `seed`, `beta-grant`, `beta-revoke`, `beta-list`:

```bash
./per-ankh admin tournament beta-grant <discord_id>    # Add to the tournament create-allowlist (CLI-only)
./per-ankh admin tournament beta-list                  # Show the create-allowlist
./per-ankh admin --local tournament seed <slug> [name] # Build a full local fixture (see below)
```

Build a full local fixture (Swiss + championship via the real planner) with `./per-ankh admin --local tournament seed <slug> [name]`, flags `--qualifiers N` (default 6), `--players-per-division N` (default 8), `--fill mid-swiss|swiss-done|mid-championship|complete` (default `mid-championship`).

## Caches (KV)

`./per-ankh admin cache list [--kind stats|videos|ask] [--match S] [--limit N]` and `./per-ankh admin cache clear <stats|videos|ask|all> [--match S]` inspect and drop the three KV caches: stats bundles (`cloud/src/stats/cache.ts`), YouTube feeds (`cloud/src/video/cache.ts`) and Explore ask answers (`cloud/src/query/ask-cache.ts`). All three share the `SESSIONS_KV` namespace with `session:`/`oauth:` keys and the ask off switch. The command's prefix allowlist is what keeps those unreachable, so no flag combination can sign users out or switch the ask input back on.

```bash
./per-ankh admin cache list --kind stats --match ':user:abc123:'   # One user's bundles
./per-ankh admin cache clear stats --match 'stats:v7-'             # Drop one schema version
./per-ankh admin cache clear videos                                # Force a YouTube refetch
./per-ankh admin cache clear ask                                   # Drop every cached ask answer
```

Unlike the Worker's `invalidateStatsCache` (which walks only the current `BUNDLE_SCHEMA_VERSION`), `clear` sweeps every schema version under the prefix — that's what reaches entries orphaned by a version bump. Clearing `videos` costs YouTube Data API quota on the next playlist view.

**The parsed-game blob cache is a different layer and this command cannot reach it.** It caches R2 bytes for `games/{id}.json.gz` in each POP's Cache API storage (`cloud/src/blob-cache.ts`), which has no CLI surface — `wrangler` has no cache command, and zone purge can't address the keys because they're synthetic and belong to no zone. It also needs no operator action: the key carries the game's `parser_version`, so a reparse drifts the key and every POP misses at once. If a game somehow serves stale bytes anyway, that's the D1-batch-rollback path in `handleGameUpload` (the Worker evicts locally there) and the entry expires on its own within 24h. The `Cache-Control: s-maxage` directives on game responses are live at the edge as of `[cache]` (`cloud/wrangler.toml`, issue #291) — a public game-detail response is stored in front of the Worker for 60s, keyed on the URL and the verbatim `Cookie` string — and they are no more reachable from this CLI than the blob tier is, for the same reason: `wrangler` has no cache command. The 60s is short because a Make Private toggle has to propagate (`cloud/src/games.ts`), which is also why there is nothing here for an operator to clear by hand.

## Explore ask

`./per-ankh admin ask status|off|on` is the off switch for the plain-language question input on `/stats/explore` (`POST /v1/query/ask`). `off` makes the endpoint refuse every question before it calls the model, cached answers included. The Explore builder keeps working either way. The switch is the one `SESSIONS_KV` key `query_ask:disabled`, and the command writes no other key. A change reaches every location within about a minute. `status` also shows the current UTC month's questions and spend.

```bash
./per-ankh admin ask status    # On or off, and the month's questions and spend
./per-ankh admin ask off       # Refuse every question before the model runs
./per-ankh admin ask on        # Switch it back on
```

A question asked again on the same UTC day is answered from a KV cache. To drop a bad cached answer before the day ends, run `./per-ankh admin cache clear ask` (see [Caches](#caches-kv)).

## Dev (local only)

`./per-ankh admin --local dev-login [--username NAME]` provisions a fake local user + 30-day session cookie (and adds them to the tournament create-allowlist) for testing a second account. Both `tournament seed` and `dev-login` are **local-only** and refuse to run against remote (staging included). For the browser-side Discord-free login bypass, see `docs/dev-login.md`.

## Flags & targeting

Add `--json` to any read command for pipeable output; add `--yes` to skip confirmation on destructive ops. `--local` targets the local `.wrangler` state; `--staging` targets the staging D1/R2 (remote, mutually exclusive with `--local`); the default is **production**. The dev-only commands (`dev-login`, `tournament seed`) refuse both remote targets, staging included.
