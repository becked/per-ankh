# Identity work order

The order to work the `user_online_ids` and sign-in issues, and why that order. Written 2026-11-24 alongside #386. Code wins on conflict; this records sequencing and the measurements the sequencing rests on, not behaviour.

## The one rule

Four of these issues are the same function. `captureOnlineIds` (`cloud/src/online-ids.ts`) and its two call sites are what #346, #377, #243 and #246 are about, and #244 and #386 each add a new writer to it. So: **fix what the writer writes before adding writers to it.**

## Issue order

### 1. #346 and #377 — correctness in `captureOnlineIds`

Both live, both measured, both one pass over the same function. Cheapest items on the list, and nothing downstream is right while they're broken.

- #346 — the two writers disagree on the guard, so a claim on an empty-id seat writes `('')`. `UNAMBIGUOUS_ONLINE_ID_OWNERS_SQL` then resolves `''` to that one account. 406 empty `player_summaries.online_id` values in the 2026-10-23 prod snapshot, 4 of them on human seats.
- #377 — one `OnlineID` covering two human seats links an account to a stranger's id even when the claim is correct. 14 of 986 games, 28 of 1,942 human seats.

### 2. #243 — provenance

The `source` column (`upload_pick` | `discord_connection` | `steam_link`), the backfill, and the policy: verified outranks claimed, and a contested id credits nobody.

After step 1 specifically because of #243's own backfill plan — "existing rows are all `upload_pick`, so the backfill is a constant". That stamp should go onto rows that are structurally sound, not onto `''` rows and stranger links. The enum already names `steam_link`, so this is the schema both later writers target.

### 3. #246 — unlink

Rows now carry provenance, so the surface can distinguish a verified link from a claimed one, and "tombstone or re-doable" has an answer rather than a guess. Needs the re-import bug fixed first — `captureOnlineIds` runs on the re-import path with no `isReimport` guard, so an unlink doesn't stick today.

#246 has two surfaces with different dependencies. The operator half (`./per-ankh admin unlink-online-id`) depends on none of this; it wraps a remote D1 write someone is doing by hand. The named live case — Egotheist's id linked to Akuukis, leaving both uncredited — is fixable with that alone, whenever it starts to matter.

### 4. #386 — Steam sign-in

Writes `steam_link` rows with provenance from day one rather than rows needing a later backfill. Largest piece; its internal order is below.

### 5. #244 — Discord connections import

Deliberately after #386, and smaller because of it. A Steam login is first-party proof of a SteamID64, which is a stronger writer than anything mediated through Discord. What's left for #244 is Epic ids — 17 of 72 distinct ids in `test-data/saves/` — and Steam players who'd rather not link.

The tension, recorded so it isn't rediscovered: #244 is far cheaper than #386 and delivers a verified writer sooner. If #386 slips, doing #244 first would have been right.

### 6. #265 — MCP OAuth authorization server

It sits on whatever identity layer #386 produces. Building an OAuth AS against `users.discord_id NOT NULL` and then rebuilding that table underneath it is the wrong order.

### Two more that belong in this sequence

- **#43** (account deletion and data export, security review F-01) touches every `user_id`-bearing table — the same 23-foreign-key surface as #386's `users` rebuild. Before #386 it gets written twice.
- **#263** (observer upload never checks the slot mapping against known `online_id`s) is a *reader* of `user_online_ids`. It gets more reliable after steps 1–2 but doesn't block them. Place it anywhere after #243.

## Order within #386

The two reversible pieces go first, the Steam plumbing is exercised as a *link* against real accounts before it's trusted to create them, and the `users` rebuild — the one irreversible step — happens late with nothing else riding on it.

1. **Avatar indirection.** Add `users.avatar_url`, persisted, written by one precedence function that today has Discord custom → Discord default. Replace the ~20 `buildAvatarUrl` call sites with reading the column. No Steam, no new provider, no behaviour change. Verified mechanically: every row's new `avatar_url` must be byte-identical to what `buildAvatarUrl(discord_id, avatar_hash)` produced. After this, a third provider never touches those call sites again.
2. **`user_identities`, Discord rows only.** Table plus backfill from `users.discord_id`. The login upserts still use `ON CONFLICT(discord_id)`; they just also write the identity row. `users` is untouched. Verified: `user_identities` row count equals `users` row count after backfill, and stays equal after a login.
3. **Steam OpenID as a *link*, from Settings.** Provider registry (copy `cloud/src/video/registry.ts`), start + callback, the KV nonce in a signed `return_to`, per-provider paths in `isAllowedRedirectUri`, the Steam Web API key secret, `GetPlayerSummaries` with the PII drop, `avatars.steamstatic.com` in CSP `img-src`, and **precedence level 2 only**. Not level 4: every account still has a Discord identity here, so level 3 catches everyone and a Steam default would be unreachable. Level 2 is reachable immediately — anyone with a blank Discord avatar and a linked Steam custom one. This proves the whole Steam path against real accounts with no account-creation risk.
4. **The `users` rebuild.** `discord_id` becomes nullable; the three `ON CONFLICT(discord_id)` upserts move to the identity table. 23 foreign keys point in. Its own PR, its own deploy, nothing else in it, backup first.
5. **Session shape.** `SessionData` drops the `discord_username` requirement. The readers that pull it — `handleSignup`, the slot-claim path — resolve it from the identity table. This forces a global re-login, the only step that does; `cloud/src/session.ts` already treats that as correct when the gate changes. Deploy close to step 4 so the disruption lands once.
6. **Sign in with Steam.** Account creation from an unknown Steam identity, with the "create new / link existing" interstitial and the pending identity in KV. Precedence **level 4** ships here — the first point a user can exist with no snowflake.
7. **The surface tail.** `AND discord_username IS NOT NULL` out of `handleUserSearch`, `slug` into the autocomplete rows, `discord_username` optional in `BulkCreateSlotsSchema` when `user_id` is set, null binds in self-signup, `ADMIN_DISCORD_ID` rekeyed on `user_id`, the Steam profile deep link behind the registry. Only reachable after step 6, and it's what makes a Steam-only account usable rather than merely existing — a Steam user who can sign in but can't be picked into a bracket is the half-delivered version.

## Measurements the order rests on

Recorded so they aren't re-derived. Counts only; the ids themselves are other players' identities.

`OnlineID` is an **attribute** on the Player node, read as `@_OnlineID` (`src/lib/parser/parsers/players.ts`). There is no `<OnlineID>` element, so an element-shaped grep finds nothing.

Against `test-data/saves/` (116 saves), 2026-11-24: 215 `OnlineID` occurrences, 72 distinct non-empty ids — **55 SteamID64** (`7656119` + 10 digits), **17 32-char lowercase hex** (Epic-shaped), 0 of any other shape. This is a property of the corpus, weighted toward multiplayer opponents, not a sample of the player base; the audience measurement is the shape mix in `player_summaries.online_id` from local D1 (`./per-ankh backup --local`).

`ISteamUser/GetPlayerSummaries/v0002` against all 55 in one request (the endpoint takes up to 100), 2026-11-24. 55 requested, 55 returned — Steam omits ids it doesn't recognise and omitted none, so the corpus holds no dead Steam ids.

| `communityvisibilitystate` | Accounts | With `personaname` | With `avatarhash` |
|---|---|---|---|
| 1 (private) | 6 | 6 | 6 |
| 2 (friends only) | 8 | 8 | 8 |
| 3 (public) | 41 | 41 | 41 |

`personaname` and `avatarhash` come back at **every** visibility level, so a Steam-only login can always satisfy `users.display_name NOT NULL` and no private-profile fallback is needed. `communityvisibilitystate` 2 is a live, distinct value — it is not folded into 1.

Steam's default-avatar hash is `fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb` — 12 of the 55, and the only `avatarhash` shared by more than one account in the sample. Default-versus-custom is detectable. Steam's `avatarhash` is 40 hex (SHA-1); Discord's is 32 hex with an optional `a_` prefix, so the two are distinguishable by length.

## Closed off

Reddit sign-in is not buildable. Self-serve OAuth app registration closed under the Responsible Builder Policy, and new public-API access requests stopped being accepted after 2026-10-31.

GOG has no path. Its third-party authorisation is Encrypted App Tickets, requiring the running game to request a ticket through the Galaxy SDK and a backend sharing a key with the game's GOG product — only Mohawk could enable that. GOG is not a Discord connection type either. GOG ids stay upload-claim-only. Full provider survey in #268 (closed, still readable).
