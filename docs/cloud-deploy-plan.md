# Per-Ankh Cloud Deploy Plan

> **Status (2026-05-16):** Cloud rewrite is shipped and live at https://per-ankh.app. §3 (Cloudflare provisioning) and §4 (Deploy steps) are historical — kept for reference and for future re-deploy runbook use. §6 (First-week monitoring), §7 (Explicitly NOT doing), §8 (Parked follow-ups) are still applicable.
>
> Day-to-day deploy is now `./per-ankh prod deploy` (preflight → migrate → worker → frontend → smoke). Preflight (`./per-ankh prod preflight`) covers lint, typecheck, format, npm audit, secret-leak scanning, `[vars]` vs `secrets` hygiene, and required-secret presence. Most §3 setup steps are one-time and won't need redoing; §4 step ordering still applies if cutover ever needs to be repeated.

Forward-only checklist for getting the cloud rewrite deployed to https://per-ankh.app. Replaces the active
parts of [`cloud-productionization-plan.md`](./cloud-productionization-plan.md);
the old doc stays as historical context.

## 1. Status

- Tauri is gone. v0.2.0 GitHub Release is the desktop-final artifact.
- Cloud Worker is feature-complete (auth, upload, games, dashboard, sharing,
  reparse, downloads, observability, audit log, CSP reporting).
- Sign-up is open to anyone who completes Discord OAuth — there is no
  invite-code or allowlist gate on account creation. (A shared `INVITE_CODE`
  passphrase gated sign-up before launch and was removed at release.) Abuse is
  bounded downstream by the per-user/per-IP/global upload rate limits plus
  Discord's own anti-abuse.
- **The tournament feature is public.** Anonymous visitors can browse
  tournaments and view standings/brackets/matches; any logged-in user can
  sign up, report matches, and act as a granted admin. The
  `tournament_beta_users` allowlist now gates tournament **creation** only —
  a non-allowlisted logged-in caller gets `403 TOURNAMENT_CREATE_FORBIDDEN`.
  Grant a creator with `./per-ankh admin tournament beta-grant <discord-id>`:
  ```
  ./per-ankh admin tournament beta-grant <your-discord-id> --note "self"
  ./per-ankh admin tournament beta-list   # confirm
  ```
  Grants take effect on the next request — no re-login required for users
  whose `user_id` is already in the row (CLI auto-pins on grant when the
  user has signed in). Grants by raw `discord_id` for users who haven't
  signed in yet get pinned on their first OAuth callback. (The feature
  originally 404-gated every endpoint behind this allowlist; it was opened
  to the public in `5e19cb4`.)
- Legacy `/v1/share/*` endpoints stayed live on the API Worker through
  the cutover (desktop v0.2.0 minted share URLs against it). At cutover,
  deploy moved `per-ankh.app` from the Pages project to the new SSR
  Worker, reattached the legacy SPA to `legacy.per-ankh.app`, and added a
  `/share/*` 302 from `per-ankh.app` to `legacy.per-ankh.app` (see §3.8 +
  §4 step 5). **All of this has since been retired** — the endpoints, the
  `web/` SPA, and the redirect are gone; `per-ankh.app/share/[id]` now
  serves a static "link retired" page. §3.8 and §4 below are kept as the
  historical cutover record.

Real test users arrived with the next feature, providing live feedback;
that's why this plan deliberately skipped formal bake stages.

## 2. UI polish backlog (deploy-blocking)

Fill in as items surface. Empty this list before running §4.

- [ ] _(add items here)_

## 3. Cloudflare provisioning checklist

> **Status: completed.** Historical reference for the one-time setup. Re-run any of these if a fresh environment ever needs provisioning.

One-time setup. Everything below blocked the original deploy.

### 3.1. Sessions KV namespace

`cloud/wrangler.toml` now has real `SESSIONS_KV` namespace IDs — this one-time step is done (it originally shipped `REPLACE_WITH_PROD_KV_ID` placeholders).

```bash
cd cloud
npx wrangler kv namespace create SESSIONS_KV
npx wrangler kv namespace create SESSIONS_KV --preview
```

Paste the returned `id` and `preview_id` into `cloud/wrangler.toml`.

### 3.2. Worker secrets

```bash
cd cloud
npx wrangler secret put DISCORD_CLIENT_SECRET   # from Discord developer portal
```

`./per-ankh prod preflight` will fail if `DISCORD_CLIENT_SECRET` is unset on the
production Worker (it's the only entry in the preflight's required-secrets list).

**`SSR_TRUSTED_KEY` goes on both Workers, with the same value.** It's what lets
the API believe the visitor address the frontend forwards on
server-rendered requests; without it every SSR visitor is counted into one
bucket and a single crawler can spend the whole site's per-IP budget
(`adoptTrustedFrontend` in `cloud/src/util.ts`, and the 2026-08-05 outage in
`docs/cloudflare-waf.md`).

```bash
# Generate one value and give it to both:
openssl rand -base64 32

(cd cloud && npx wrangler secret put SSR_TRUSTED_KEY)   # API Worker
npx wrangler secret put SSR_TRUSTED_KEY                 # frontend Worker (repo root)
```

Not in the preflight's **required** list, because unset is a working state —
both sides check it, so forwarding stays off until both have it and the two
Workers can be deployed in either order.

It is checked, though. Leaving it unset costs nothing at deploy time and
everything at runtime, silently: `ssr_forward_rejected` means a key was
presented and didn't match (a half-finished rotation), and a Worker with no key
at all has nothing to reject, so it says nothing. The `secrets.ssr_trust`
preflight check stands in for that missing signal — it lists the secrets on
both Workers and **warns** when neither has the key, **fails non-blockingly**
when only one does. Neither state stops a deploy; both are printed, so the
deploy window can't quietly become permanent. The runtime confirmation is still
the counters — a Cloudflare egress address at the top of the per-IP bucket
query in `docs/cloudflare-waf.md` means SSR traffic is pooling again.

### 3.3. Discord OAuth app

Both prod and dev redirect URIs are already configured in the Discord
developer portal for client `1500901451034263604`
(`https://per-ankh.app/auth/callback` + `http://localhost:1420/auth/callback`).
Nothing to do — just spot-check the portal still lists both before deploy.

Background, in case it ever needs revisiting: the redirect URI is supplied
by the frontend at request time (`cloud/src/auth.ts:164`), and Discord
rejects URIs not on its allowlist.

### 3.4. Content-hashed atlas + sprite paths

> **Status: implemented in `373ce65`.** Manifests live at `src/lib/generated/{atlas-manifest,sprite-manifest,tech-names}.ts`; `_headers` at repo root sets `Cache-Control: immutable, max-age=1y` on `/atlases/*` and `/sprites/*`. See `CLAUDE.md` § "Content-hashed paths" for the live pipeline.

The 26 MB of atlases (~6 MB hit on every first paint of `/games/[id]`) need
aggressive caching, but Pinacotheca iteration means re-bakes happen
routinely and atlas content does change. In-place updates with
`Cache-Control: immutable` would leave returning browsers serving stale
images for up to a year — `immutable` tells the browser to never even
revalidate. The fix is content-addressable URLs: hash each baked file by
its content, embed the hash in the filename, and serve those paths with
`immutable, max-age=1y`. Re-bakes that change content produce new URLs;
re-bakes that produce identical bytes reuse old URLs (cache hit).

This is the standard pattern Vite/SvelteKit already uses for `_app/immutable/*`
— we're extending it to `static/atlases/*` and `static/sprites/*`, which
Vite leaves alone today.

**Bake-script change.** Each `scripts/bake-*.ts` writes its outputs as
`<name>.<sha256-prefix>.webp` (e.g. `terrain-3d.a1b2c3d4.webp`), where the
hash prefix is the first 8 chars of the sha256 of the file contents. After
all bakes complete, emit a single manifest at
`src/lib/generated/atlas-manifest.ts` exporting a typed map of logical
name → hashed path. Pattern is the same as `scripts/bake-crests.ts`
generating `src/lib/generated/crests.ts` (per `CLAUDE.md`'s asset-bake
section). Wire the manifest write into `npm run bake:all` so it always
runs after every individual bake step — no separate command to remember.

Sketch of the manifest shape:

```typescript
// src/lib/generated/atlas-manifest.ts (generated; do not edit)
export const ATLAS_MANIFEST = {
	"terrain-3d.webp": "/atlases/terrain-3d.a1b2c3d4.webp",
	"improvements-base.webp": "/atlases/improvements-base.e5f6g7h8.webp",
	"improvements-urban-AKSUM.webp":
		"/atlases/improvements-urban-AKSUM.i9j0k1l2.webp",
	// ...
} as const;
```

**Frontend change.** Three sites reference these paths today, all need to
move to manifest lookups:

1. `src/lib/SpriteMap.svelte:33-38` — atlas `.webp` URLs built from
   `ATLAS_BASE` + hardcoded names:

   ```typescript
   import { ATLAS_MANIFEST } from "$lib/generated/atlas-manifest";

   const TERRAIN_3D_ATLAS_URL = ATLAS_MANIFEST["terrain-3d.webp"];
   const IMPROVEMENTS_BASE_ATLAS_URL = ATLAS_MANIFEST["improvements-base.webp"];
   // ...
   const urbanAtlasUrl = (family: string) =>
   	ATLAS_MANIFEST[`improvements-urban-${family}.webp`];
   ```

2. `src/lib/SpriteMap.svelte:534` — `fetch(\`/atlases/${name}.json\`)`for
per-atlas cell-coordinate sidecars. The`.json`and`.webp` for the same
   atlas must share a hash so the pair stays in sync; the bake script
   should derive one hash per logical atlas (e.g. from the source PNG) and
   apply it to both files.
3. `src/lib/game-detail/helpers.ts:394,399,401` — constructs `/sprites/...`
   URLs by convention (`/sprites/crests/CREST_${enumValue}.png`,
   `/sprites/${category}/${filename}.png`). For hashed sprite filenames,
   helpers.ts needs to read from a sprite manifest (same generated-file
   pattern as atlases) instead of building URLs by convention.

Also: `src/lib/SpriteMap.svelte:30-32` has a stale comment about a planned
R2 migration — drop or update it as part of this change.

A grep for `/atlases/` and `/sprites/` across `src/` confirms these are the
only sites; rerun before merging in case anything new lands.

**Cache headers.** With content-hashed paths in place, create `_headers` at
the **repo root** (not in `static/`):

```
/atlases/*
  Cache-Control: public, max-age=31536000, immutable

/sprites/*
  Cache-Control: public, max-age=31536000, immutable
```

`immutable` is now correct because the URL itself is the version key.

`_headers` is natively supported by Workers Static Assets (which is what
adapter-cloudflare 7.x deploys to). Per the SvelteKit adapter docs, the
file goes at the project root; the adapter copies it into the deployed
asset bundle. The rules apply only to static asset responses (not SSR
output), which is exactly what we want — atlases and sprites bypass the
Worker entirely. Verify after first deploy with
`curl -I https://per-ankh.app/atlases/<some-hashed-name>.webp` to confirm
the `Cache-Control` header round-trips.

### 3.5. Root `wrangler.toml` for the SvelteKit Worker

`@sveltejs/adapter-cloudflare` 7.x outputs to `.svelte-kit/cloudflare/`
and is deployed via `wrangler deploy` from the repo root. There's no
root-level `wrangler.toml` today — add one with:

- `name = "per-ankh-frontend"` — distinct from the API Worker
  (`per-ankh-share-api`) and from the existing Pages project (`per-ankh`,
  see §3.8).
- `main = ".svelte-kit/cloudflare/_worker.js"` — verified against a
  current `npm run build` output.
- `compatibility_date = "2024-12-01"` to match the API Worker.
- **No** `compatibility_flags = ["nodejs_als"]`. That flag is
  API-Worker-specific (it backs `cloud/src/log.ts`'s AsyncLocalStorage).
  The SSR Worker uses only Web APIs — verified by grep, no `node:`
  imports in `src/`.
- `routes = [{ pattern = "per-ankh.app", custom_domain = true }]`.
- `[assets]` block with BOTH keys — the adapter's
  `validate_worker_settings`
  (`node_modules/@sveltejs/adapter-cloudflare/utils.js:22`) hard-requires
  `binding` whenever `main` is set, and `directory` whenever either is set:

  ```toml
  [assets]
  directory = ".svelte-kit/cloudflare"
  binding = "ASSETS"
  ```

- Do **not** set `assets.not_found_handling`. The default (fall through
  to the SSR Worker) is what we want; `404-page` /
  `single-page-application` would short-circuit dynamic routes.

The adapter auto-emits `.svelte-kit/cloudflare/.assetsignore` listing
`_worker.js`, `_routes.json`, `_headers`, `_redirects` so they're not
uploaded as static assets — nothing to configure for that.

### 3.6. Build-time env vars

Nothing to do at deploy time. The env-var layout has two layers:

- **Code defaults** in `src/lib/api-cloud.ts` and `src/lib/page-meta.ts`
  point at production (`https://api.per-ankh.app/v1`,
  `https://per-ankh.app`). These apply when no env var is set.
- **`.env.development`** (committed, repo root) overrides them with
  localhost values for `vite dev`. Vite loads this file _only_ in
  development mode, never during `vite build`, so the overrides cannot
  leak into a production bundle.

A bare `npm run build` therefore produces a correct prod build with no
env-var ceremony. Verified by `curl -I https://per-ankh.app/_app/...`
after deploy: bundled JS should reference the prod API URL, not
localhost.

If we ever switch to a Cloudflare Git-integration auto-deploy flow, the
same code defaults still apply — nothing to migrate to the dashboard
unless we need to override them per-environment.

### 3.7. Cloudflare alerts

Cloudflare's Notifications catalog is thinner than it sounds. Workers
ships exactly two templates (_Weekly Summary_ and _CPU Usage
Notification_ — fires at a hardcoded 25% above 7-day baseline, both
auto-on for new accounts), and D1 ships zero. There is no native
template for Worker error rate or D1 errors at any plan tier; that gap
is what §6's Sentry/Baselime line covers.

Cloudflare dashboard → Notifications. Confirm auto-on, then enable the
free hygiene alerts:

- Verify _Workers Weekly Summary_ and _Workers CPU Usage Notification_
  are enabled (should be auto-on).
- _Universal SSL Alert_ — cert validation/issuance/renewal/expiry events.
- _Cloudflare Status → Incident Alert_ — Cloudflare-side incidents
  affecting the account.
- _Cloudflare Status → Maintenance Notification_ — scheduled POP
  maintenance.

Real error-rate alerting (the thing this section originally reached for)
is deferred to §6.

### 3.8. Pages → SSR Worker domain swap + `/share/*` redirect

Today, `per-ankh.app` is the custom domain on the Pages project named
`per-ankh` (which serves the legacy `web/` static SPA, including
`/share/[id]` via SPA routing). The Pages project also has its own
auto-assigned hostname `per-ankh-web.pages.dev`, which keeps working
regardless of the custom domain.

A single Cloudflare hostname can be either a Pages custom domain or a
Worker custom domain — not both. Cutover swaps `per-ankh.app` from Pages
to the new SSR Worker. The legacy SPA stays alive on a dedicated
subdomain `legacy.per-ankh.app`, and the SSR Worker 302-redirects
`/share/*` there so old share URLs keep resolving.

302 (not 301) because the plan is to eventually fold `/share/*` back into
the new app. Browsers cache 301s aggressively — sometimes indefinitely —
so a 301 would force users to clear cache once the new in-app handler
lands. A 302 keeps that path open at no cost (these URLs aren't crawled,
so there's no SEO upside to 301 either way).

**Attach `legacy.per-ankh.app` to the Pages project.** Cloudflare
dashboard → Workers & Pages → Pages project `per-ankh` → Custom domains
→ add `legacy.per-ankh.app`. The `per-ankh.app` zone is already on
Cloudflare, so DNS is provisioned automatically. Do this well before
cutover (gives DNS time to propagate) and verify with
`curl -I https://legacy.per-ankh.app/` that it serves the legacy SPA.

**Code change (lands in the SSR Worker before deploy).** Add a `/share/*`
handler high in `src/hooks.server.ts` so it short-circuits before any
SvelteKit routing:

```typescript
// In src/hooks.server.ts handle()
if (event.url.pathname.startsWith("/share/")) {
	const id = event.url.pathname.slice("/share/".length);
	return Response.redirect(`https://legacy.per-ankh.app/share/${id}`, 302);
}
```

Verify with `curl -I https://per-ankh.app/share/test` after deploy: expect
`HTTP/2 302` with `location: https://legacy.per-ankh.app/share/test`.

The actual `per-ankh.app` domain detach + reattach is a §4 step (it has
to happen at cutover, between Pages serving the old SPA and the new
Worker serving the new app).

**Why redirect instead of bundling web/ into the new Worker.** web/'s
adapter-static SPA assumes it's mounted at the root (`_app/immutable/...`
paths are absolute). Path-prefixing the SPA into a subdirectory would
need either a base-path config in `web/svelte.config.js` and a re-deploy,
or asset-tree restructuring at copy time. Both are more work than a
302 redirect, and we want to fold `/share/*` into the new app properly
anyway — the redirect is a temporary bridge, not a permanent home.

**Legacy share creation stays enabled.** Desktop users on v0.2.0 still
POST to `/v1/share/*` on the API Worker to mint new share IDs. The
desktop app writes those URLs as `https://per-ankh.app/share/[id]`, so
post-cutover they hit the new SSR Worker, get 302'd to
`legacy.per-ankh.app`, and resolve normally. No changes to `/v1/share/*`
on the API Worker — endpoints stay live until the desktop installed base
has migrated.

### 3.9. Security-events drain database (issue #71)

Skiff (external, read-only security triage) drains one row per
security-relevant request from a `security_events` table over the D1 REST API,
cursoring on the AUTOINCREMENT `id`. It lives in its **own** D1 (binding
`SECURITY_DB`), **not** `SHARE_DB`, so write bursts under a probe flood can't
contend with live app queries (D1 is single-threaded per database). The emit
chokepoint is `cloud/src/security-events.ts`; the schema is
`cloud/migrations-security/0001_security_events.sql`.

Both the **prod** and **staging** `SECURITY_DB` bindings in `cloud/wrangler.toml`
now carry real `database_id`s — both databases are provisioned. The steps below
remain as the provisioning procedure of record. Provision and wire it up in this order
— **the database must exist before the Worker deploys** (wrangler validates
bindings), and Skiff's drain errors on a missing database (but tolerates a
missing table):

```bash
cd cloud
npx wrangler d1 create per-ankh-security-events           # prod
npx wrangler d1 create per-ankh-security-events-staging   # staging
# Paste both database_id values into cloud/wrangler.toml (top-level + [env.staging]).
```

1. Create both databases (above); paste the IDs into `wrangler.toml`.
2. Send both `database_id`s to Skiff; they point their read-only drain at them.
3. Staging: `npm run migrate:security:staging` → `./per-ankh staging deploy` →
   observe (rows emit, drain works, no app impact).
4. Prod: `npm run migrate:security:remote` → `./per-ankh prod deploy`.

**This database is deliberately outside the deploy automation.** The schema is
static (one table), so the migration is a one-time manual `migrate:security:*`
step rather than a change to the safety-critical deploy pipeline (which targets
`per-ankh-share-index` only). Consequences, all intentional:

- `./per-ankh prod deploy` / `staging deploy` do **not** detect or apply
  `migrations-security/` — apply it by hand (steps 3–4).
- `./per-ankh backup` and `staging reclone` ignore `SECURITY_DB` (they hardcode
  the share DB). Fine: the table is Skiff-drained and age-pruned, not a
  source of truth.
- Retention is a nightly age-out sweep (`sweepSecurityEvents`, 30-day floor) on
  the existing cron. Staging is opted out of the cron (`crons = []`), so staging
  rows don't auto-prune — fine (low volume, disposable, recloned). Skiff's
  credential stays read-only; deletion is ours, never the drain's.

### 3.10. D1 read replication on `SHARE_DB` (issue #149)

`per-ankh-share-index` lives in ENAM, so every query from a Worker running elsewhere crosses to Eastern North America and back. Read replication puts a copy nearer the reader; routes flagged `staleTolerant` in `cloud/src/index.ts` read through it. Both prod and staging are enabled — this section is the procedure of record for a fresh environment.

Replication is a property of the **database**, not of `wrangler.toml`, so nothing in this repo turns it on and no deploy step applies it:

```bash
# Dashboard: D1 → <database> → Settings → Enable Read Replication
# Or the API (token needs D1:Edit):
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/d1/database/$DATABASE_ID" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"read_replication": {"mode": "auto"}}'
```

Apply it to **both** `per-ankh-share-index` and `per-ankh-share-index-staging`, so a replica-served route is exercised on staging before prod.

**It fails silent in both directions**, which is the whole reason this is written down. The setting alone does nothing — a plain binding queries the primary regardless, and only the Sessions API handles built in `cloud/src/d1.ts` can leave it. The code alone does nothing either — `withSession` against a non-replicated database just runs on the primary. Skip this step on a new environment and everything works, only slower, with no error anywhere.

Verify on a deployed environment: `D1Result.meta` carries `served_by_region` and `served_by_primary`. Both are `undefined` under `wrangler dev`, so this can't be checked locally. Disabling is not instant — Cloudflare's docs note replicas take up to 24h to stop serving.

## 4. Deploy

> **Status: completed; now automated.** The first deploy ran via these manual steps at cutover. Day-to-day deploys now run through `./per-ankh prod deploy` (see top-of-file status banner). Steps below are kept for re-deploy runbook reference.

In order:

1. **Merge `cloud-rewrite` to `main`.** Use merge-commit or rebase-and-merge,
   not squash — the per-feature commit history is useful for future bisects
   especially around the TS parser port.
2. **Rehearse D1 migrations on a throwaway DB.** Forward-only migrations +
   prod data is a one-shot. From a clean checkout of `main`:
   ```bash
   npx wrangler d1 create per-ankh-rehearsal
   # paste the returned id into a temporary wrangler.toml override, then:
   cd cloud && npx wrangler d1 migrations apply per-ankh-rehearsal --remote
   # confirm 0001..0005 land cleanly, then:
   npx wrangler d1 delete per-ankh-rehearsal
   ```
3. **Apply migrations to prod D1.**
   ```bash
   cd cloud && npm run migrate:remote
   ```
   After this lands, **if migration `0012_tournament_beta_users.sql` was
   in the batch**, grant yourself the tournament create-allowlist so you
   can create tournaments (it gates creation only — browsing, signup, and
   admin actions are public):
   ```bash
   ./per-ankh admin tournament beta-grant <your-discord-id> --note "self"
   ./per-ankh admin tournament beta-list
   ```
4. **Deploy the API Worker.**
   ```bash
   cd cloud && npx wrangler deploy
   ```
5. **Detach `per-ankh.app` from the Pages project.** Cloudflare dashboard
   → Workers & Pages → Pages project `per-ankh` → Custom domains → remove
   `per-ankh.app`. Leave `legacy.per-ankh.app` (attached in §3.8) and the
   auto-assigned `per-ankh-web.pages.dev` in place — both keep the legacy
   SPA reachable, and `legacy.per-ankh.app` is what the §3.8 redirect
   targets. Do not delete the Pages project itself. Brief window between
   this step and step 6 where `per-ankh.app` returns a Cloudflare error;
   acceptable for a pre-announce cutover.
6. **Deploy the frontend Worker.** From the repo root:
   ```bash
   npm run build
   npx wrangler deploy
   ```
   The `routes` block in the new wrangler.toml attaches `per-ankh.app` as
   a custom domain on this Worker as part of the deploy. If the attach
   fails because the Pages detach hasn't fully propagated, wait 30s and
   retry the deploy.
7. **Verify custom domains resolve.** `curl -I https://per-ankh.app/`
   should return the new SSR Worker's response (look for SvelteKit-style
   `link: </_app/...>` modulepreload headers from the new build, distinct
   from the current Pages headers). `curl -I https://per-ankh.app/share/test`
   should return `302` with `location: https://legacy.per-ankh.app/share/test`.
   `curl -I https://legacy.per-ankh.app/` should still serve the legacy
   SPA. `curl -s -o /dev/null -w '%{http_code}\n'
   https://api.per-ankh.app/v1/stats` should print `401`.

   Two things about that last one. **Not `-I`:** that sends HEAD, and
   `dispatch` (`cloud/src/index.ts`) matches methods exactly against a
   GET-only route, so a HEAD 404s no matter how healthy the Worker is.
   **Not `200`:** `/v1/stats` requires a session, so an unauthenticated
   probe is *supposed* to be refused. What this step checks is that
   `api.per-ankh.app` reaches the Worker at all, and a `401` from the
   handler proves that exactly as well as a `200` would — where a DNS,
   cert, or route-attach failure gives neither.
8. **Run §5 smoke test against prod.** Do not announce until it passes.

## 5. Smoke test

> **Status: now automated.** A 2-probe subset (anonymous home, auth/me) runs as part of `./per-ankh prod deploy`. The full functional smoke (OAuth, upload, download, reparse, delete) remains manual and is the authoritative checklist below.

Against the live `https://per-ankh.app`. Run in this order:

1. Anonymous load of `/` — 200, no console errors.
2. `/login` → Discord OAuth → callback → `/dashboard`. Verifies the
   allowlisted Discord ID logs in (and that any other ID is rejected with
   a clean error, not a 500).
3. Upload one save via `/upload` — appears in `/games`.
4. Toggle public on that game, then load `/games/[id]` in a logged-out
   browser. Confirms anonymous read path works and PII is stripped.
5. Download the raw save back via the download endpoint.
6. Reparse the test game. The Reparse button on `/games/[id]`
   (`src/lib/ReparseButton.svelte`) only appears when the stored
   `parser_version` is older than the frontend's `PARSER_VERSION`; if
   they're equal, bump `PARSER_VERSION` locally to surface the button.
   The bulk equivalent is the dashboard's `BulkReparseModal`.
7. Delete the test game.

If any step fails, do not announce. Fix and re-deploy.

## 6. First-week monitoring

The floor for "is it broken right now". Polish comes after the next
feature surfaces real query patterns.

- **Error tracking.** Sentry or Baselime (Cloudflare-acquired). Free tier
  covers solo-launch volume. Wire it into the API Worker first; SSR
  Worker second. Skip until week one is uneventful if it slows the deploy.
- **Telemetry sinks — decided.** Workers Logs for the hot window, OTLP export for the durable archive, and automatic tracing alongside both; all configured in `cloud/wrangler.toml`. See §6.1 for what each is for, the two destinations the exports need that this repo cannot create, and why Logpush → R2 was abandoned.
- **Synthetic uptime check.** Cloudflare Health Checks on
  `/v1/featured-videos` every 1–5 min. Catches DNS/cert/whole-site-down
  failures that handler-level alerts miss.

  **Not `/v1/stats`,** which this section used to name. Three things rule
  it out, and the first is fatal on its own: it requires a session, so a
  synthetic check has no credential to pass and would sit permanently red
  on a `401`. Even without the gate it would be the wrong probe — every
  hit spends a slot of the `global_stats_view` per-IP budget from a single
  checker address, and a hit that lands on a cold key (the minutes after a
  `BUNDLE_SCHEMA_VERSION` bump orphans all 56 entries at once) triggers a
  whole-corpus aggregation rather than a cheap read.

  `/v1/featured-videos` has the shape a synthetic check wants: public and
  sessionless, outside every rate-limit budget, a single small D1 read, and
  best-effort — a D1 failure answers an empty feed rather than a 500, so
  the check stays honest about "is the site reachable" instead of flapping
  on a storage blip. Anything else chosen later needs those same four
  properties.
- **Audit-log spot check** at the end of week one. Grep `audit_events`
  for unexpected patterns (mass deletes, high-frequency reimports,
  PATCHes from unfamiliar IPs).

SLOs and dashboards explicitly deferred until usage patterns emerge with
the next feature.

### 6.1 Telemetry sinks: Workers Logs + OpenTelemetry export + tracing (issue #150)

> **Status: none of this has ever run.** Every `[observability]` block described here landed on the `perf/d1-instrumentation` branch and `main` has no observability config at all, so no version of it has been deployed. **Read this section as researched, not observed.** Claims about what Cloudflare indexes, what the export delivers, and what a record looks like on arrival come from vendor documentation, and vendor documentation has already proved wrong here once (§6.1.4 on `cloudflare.colo`). §6.1.5 is the checklist that converts this section from researched to observed; until it has been run, do not build anything on a specific field being queryable.
>
> Two claims **are** observed, both from source rather than docs: `db.query.text` excludes bound values (§6.1.4) and the `ctx.tracing` API is exposed at our compatibility date (§6.1.4). The second is narrower than it looks — `enterSpan` was exercised at that date, `startActiveSpan` (what `dispatch()` actually calls) was not, and §6.1.4 says what that rests on.

`cloud/src/log.ts` emits one JSON object per `console.log`: one `type=access` line per request carrying `route`, `colo`, `status`, `duration_ms` and the `d1_*`/`r2_*` storage-timing block, plus `type=event` lines correlated by `request_id`. Both **log** sinks below consume exactly those lines, so the `scrubPii` deny-list in `log.ts` is the only PII gate they have.

**Tracing (§6.1.4) is a second emission path and `scrubPii` does not sit in front of it.** Spans are generated by the platform, not by `log.ts`, so nothing in this repo filters them. That is the same objection that rules out Analytics Engine in §6.1.1, accepted here rather than dismissed — §6.1.4 records exactly what a span carries, including which of it is app data.

**Both log sinks are enabled, because they answer different questions.** Volume is free at this scale: OTLP export includes 10M events/month and Workers Logs 20M, against ~3k invocations/day (~90k/month).

- **Workers Logs** — the hot window. `[observability.logs] enabled = true` with `head_sampling_rate = 1` (explicit; 1 is the default, but there is no volume reason to sample here) and `persist = true`. Cloudflare parses and indexes our custom fields automatically, and both the dashboard Query Builder and the public telemetry query API take `groupBys` on arbitrary custom keys with `p50/p90/p95/p99/median/sum/count` calculations — so "p95 `d1_wall_ms` by `route` and `colo`" is one query, not a pipeline. **Retention: 7 days** on the Paid plan. This is the surface for immediate feedback after a deploy and for fast iteration on what to measure next.
- **OpenTelemetry export** — the durable archive. `[observability.logs] destinations = ["per-ankh-logs"]`, sending the same lines to an OTLP-compatible provider whose retention exceeds 7 days. This is load-bearing, not a nice-to-have: at ~3k/day the per-(`route` × `colo`) cells are thin, and the tail colos — which are the entire premise of issue #150 — need weeks, not days, to accumulate enough samples for a defensible p95. The 7-day window above expires before those cells fill.

`persist = true` is set explicitly *because* Cloudflare's own OTLP example sets it to `false`. That value means "export only, keep nothing in Cloudflare" — copying the example would silently delete the hot window.

**The exports send our data to a third-party data processor — Honeycomb (§6.1.2).** For log lines `scrubPii` runs first and the deny-list is unchanged, but `user_id` is on every access line. For spans nothing of ours runs at all, and that includes the **request query string**, which the access line has never carried and which does contain PII on two routes — §6.1.4 names them and records the decision to accept it. Either way this is a deliberate widening of where app data goes, not an implementation detail.

#### 6.1.1 Why not Logpush → R2

The original plan was a Logpush job on the `workers_trace_events` dataset writing to a dedicated R2 bucket: raw rows, unlimited retention, queried locally with DuckDB, no third party. **It is blocked on this account and the attempt is recorded here so nobody retries it from scratch.**

Job creation is refused with `HTTP 403`, `"creating a new job (for workers_trace_events dataset) is not allowed: exceeded max jobs allowed"` — against an empty job list on both `/accounts/{id}/logpush/jobs` and `/accounts/{id}/logpush/datasets/workers_trace_events/jobs`. A quota of zero against zero jobs is an entitlement gate, not a counting error, and the dashboard agrees: the Logpush page renders the Enterprise "Contact sales" upsell even though its own subtitle reads "available on Enterprise plans and Workers Paid plans." Cloudflare's Workers Logpush docs also now say: *"For new integrations, consider using OpenTelemetry export instead."* Not a deprecation, but it points the same way.

The blocker was the quota alone, not our configuration: `POST /accounts/{id}/logpush/ownership` returned `valid: true` and wrote its challenge file, which proves the bucket, the R2 key pair and the `r2://…?account-id=…&access-key-id=…&secret-access-key=…` form of `destination_conf` were all correct. Everything except job creation worked.

**This was not escalated to support, and Logpush is not a pending option.** The decision was to take Cloudflare's own advice and use OTLP export instead. Everything provisioned for the attempt has been torn down and nothing in this repo references any of it:

- the R2 log bucket, along with the `ownership-challenge-*.txt` the validation wrote into it,
- the R2 API token (Object Read & Write) whose key pair existed only to sit inside a Logpush `destination_conf`,
- the account API token with `Logs → Edit`, which existed only to talk to the Logpush API.

Anyone reopening this starts from zero, and should re-read whether the quota still reads 0 before provisioning anything.

The DuckDB-over-R2 query plan went with it. That also retires the note about DuckDB being a local analysis tool rather than an app runtime dependency — with no R2 archive, the root `CLAUDE.md`'s "no DuckDB" stands unqualified.

Still rejected, recorded so they don't get reopened: **a Tail Worker** (would still have to `JSON.parse` our line back out of the tail event's `Logs` array — more code for the same answers, plus a second Worker and a beta dependency); **a dedicated D1 table** (a per-request D1 write to measure per-request D1 round trips, which would land in `d1_queries` itself — the `security_events` precedent doesn't transfer, since that tees only on interesting requests, not every request). **Analytics Engine** was rejected because R2 beat its 3-month retention outright; with R2 unavailable that argument is gone, and what remains against it is a second emission path bypassing `scrubPii` plus the positional `blob1..blob20` schema hazard. Reconsider it only if the OTLP route also falls through.

#### 6.1.2 Out-of-band provisioning — the export destinations

`destinations = ["per-ankh-logs"]` is a **name**, not a URL. It resolves against account-level destinations created in the dashboard (Workers Observability), where the OTLP endpoint and its auth headers actually live. Nothing in this repo creates one, which makes it the same class of invisible dependency as D1 read replication (§3.10, and the `SHARE_DB` comment in `cloud/wrangler.toml`): a name with no matching destination exports nothing, forever, with no error anywhere.

**Two are needed, not one.** A destination pins a single OTLP endpoint, and traces and logs are different paths on the provider, so `per-ankh-logs` and `per-ankh-traces` are separate dashboard entries. Create each with:

- **Destination name** — must match the string in `wrangler.toml` exactly. A typo is silent.
- **Destination type** — Logs for `per-ankh-logs`, Traces for `per-ankh-traces`.
- **OTLP endpoint** and **custom headers** — from the provider. **Object storage is not a destination type** — this is why R2 is not reachable this way.

**Provider: Honeycomb** — chosen over Grafana Cloud and Axiom for 60-day free-tier retention against their 14 and 30, and for high-cardinality slicing that suits the `route` × `colo` question. Honeycomb bills a span as an event against the same 20M/month free allowance the log lines draw on; §6.1.4 sizes the combined draw.

| Destination       | Type   | OTLP endpoint                          |
| ----------------- | ------ | -------------------------------------- |
| `per-ankh-logs`   | Logs   | `https://api.honeycomb.io/v1/logs`     |
| `per-ankh-traces` | Traces | `https://api.honeycomb.io/v1/traces`   |

Both take one custom header, `x-honeycomb-team: <ingest key>`. (Those are the US-instance endpoints; an EU account is `api.eu1.honeycomb.io`.)

##### The API key

**It never enters this repo.** Not `wrangler.toml`, not `wrangler secret put`, not `.dev.vars` — the key lives only in the Cloudflare dashboard destination's custom headers, because the export runs in Cloudflare's infrastructure and not in our Worker. Nothing in `cloud/` ever sees it, which is also why no preflight check can assert it is present or valid.

1. In Honeycomb, go to **Environment Settings → API Keys** and create an **Ingest** key (not a Configuration key — those are for the management API and will not accept telemetry).
2. Tick **"Can create datasets."** Without it the first send is rejected and no dataset ever appears; the symptom is an empty Honeycomb with no error surfaced anywhere on the Cloudflare side.
3. Paste it as the `x-honeycomb-team` header value on **both** destinations. One key serves both signals.

**The header value is the Key ID and Key Secret concatenated with no separator** — not the secret alone, which is the natural reading when the UI shows them as two fields. A key created through the UI is displayed already concatenated ("Honeycomb provides the complete value as the Ingest Key"), so copying the single value it shows is correct; a key created through the management API returns the halves separately, at `data.id` and `data.attributes.secret`, and you join them yourself. One-glance check: the complete value starts with the ID's `hc…ik_` prefix (`ik` = ingest, `lk` = configuration). A value not starting with `hc` is a bare secret and will 401.

Validate before wiring it into a destination, because a bad key fails silently downstream — Cloudflare surfaces no export error (§6.1.2):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.honeycomb.io/1/auth \
  -H "X-Honeycomb-Team: $HONEYCOMB_KEY"    # 200 = good, 401 = "Unknown API key"
```

**No `x-honeycomb-dataset` header.** That is a Honeycomb Classic requirement. On a modern Environments & Services account — which a fresh signup is — the dataset is derived from the `service.name` resource attribute, and for OTLP logs from a service that defines one, the header is ignored outright. Setting it anyway on an E&S account is a silent no-op for both signals.

`observability` is inherited into `[env.staging]`, nested tables included, so staging exports to these same destinations under the same key and lands in the same Honeycomb environment (Environments are keyed by API key). Whether prod and staging then separate into different **datasets** depends on what Cloudflare puts in `service.name` — expected to be the script name, which would split them cleanly, but that is a vendor-doc expectation and §6.1.5 checks it. Until it is confirmed, **assume they share a dataset and filter every prod percentile on `cloudflare.script_name`**, exactly as it must filter `type = "access"` (§6.1.3). A forgotten filter mixes staging in without failing. Splitting them properly means giving `[env.staging]` its own `observability` block and its own destinations — deliberately not done.

The wrangler config ships as part of the script's upload metadata, so **none of this takes effect until the Worker is next deployed.**

#### 6.1.3 Query notes

Both `type=access` and `type=event` lines flow to both sinks. Any aggregate over the storage-timing fields must filter `type = "access"` **per record** — a `logWarn` line has no `d1_wall_ms` at all, so it contaminates a percentile without failing.

The double-encoding hazard of the Logpush path does **not** apply here. That was a property of the `workers_trace_events` row shape, where one row was one *invocation* and our line arrived escaped inside `Logs[].Message[0]`. OTLP carries log records, not invocation envelopes. **The exact body encoding of an exported record is unverified** — confirm it against real data before writing anything that depends on it, and record the answer here.

`colo` is on our own access line rather than derived at query time because the platform does not supply it to either sink in a groupable form, and `cf_ray` cannot stand in: it is unique per request, so grouping by it yields one group per request.

#### 6.1.4 Tracing

**This section previously read "Why traces are not enabled."** Its blocker was that `span.setAttribute()` works only on spans you create, so the normalized `route` — `GET /v1/games/:id`, the grouping key issue #150 needs — could not be attached "without wrapping dispatch in a custom active span." Cloudflare shipped exactly that: custom spans on 2026-06-16, `startActiveSpan()`/`span.end()` on 2026-07-28. The workaround the old text named as hypothetical is now a supported API, so traces are on.

`[observability.traces]` auto-instruments D1 and R2 binding calls — per-query spans with `cloudflare.d1.response.sql_duration_ms`, `rows_read`, `rows_written`, and per-operation R2 spans. That overlaps much of the storage-timing accumulator in `cloud/src/log.ts`, and is finer: raw spans yield both the sum and the union that `mergeBusyMs` computes, plus per-statement attribution the accumulator discards.

**Sizing.** Tracing multiplies one invocation into roughly ten spans (invocation + wrapper + per-query D1 + per-operation R2), so ~3k invocations/day is on the order of 900k spans/month. Honeycomb bills a span as an event against the same 20M/month free allowance the ~90k log lines draw on, which puts the combined draw near 5% of it. That is the headroom `head_sampling_rate = 1` spends: sampling would thin exactly the tail-colo cells issue #150 exists to measure. Revisit if invocation volume grows by an order of magnitude, not before.

**The route attribute is ours, not the platform's.** `dispatch()` in `cloud/src/index.ts` wraps each handler in `ctx.tracing.startActiveSpan(r.route, …)`, sets `route` on it next to the existing `setRoute()` call so the span and the access line carry the same value from the same place, and ends it with `.finally(() => span.end())` on the handler's promise. This is load-bearing: root spans carry no `http.route`, only `url.path`, whose cardinality is unbounded — one cell per game id. Every D1 and R2 span nests under the wrapper, and `cloudflare.colo` is a **resource** attribute present on all spans, so "p95 by `route` × `colo`" is a query over the wrapper span alone, not a join back to the access line on `ray_id`.

**Why `startActiveSpan` and an explicit `end()` rather than `enterSpan`.** The callback returns a *pending* promise, and the two APIs differ precisely there: if `enterSpan` closes its span when the callback returns rather than when that promise settles, the wrapper span has ~0ms duration and nothing nests inside it. That is a silent failure — the `route` attribute would still be correct, so the sink would show the right cells with the wrong numbers, and it takes out both halves of the paragraph above, not just the nesting half. The explicit form is right under either semantics. `cloud/test/integration/tracing.test.ts` pins `end()` at exactly once and after the handler's storage work, which is what moves the span's duration from the platform's side of the line to ours.

Two things were verified rather than assumed, because the docs are contradictory on both:

- **No `compatibility_date` bump is needed.** The compatibility-flags page gates only the *implicit* form — `enable_workers_observability_tracing`, which makes `[observability] enabled` imply tracing. The explicit `[observability.traces] enabled = true` works at any date. The `startActiveSpan` changelog says custom spans need "an updated compatibility_date"; `ctx.tracing.enterSpan` was checked against workerd at our `2024-12-01` and works, which means the `Tracing` object itself is exposed to us ungated. `startActiveSpan` is the method we actually call and has *not* been exercised at that date: the installed workerd (`1.20260722.1`) carries both methods on the same interface and defines no `enable_*observability*` flag to gate either, so they are expected to arrive together — but "expected" is why `dispatch()` guards on the method rather than the object. If the expectation is wrong the API serves untraced and logs `tracing_unavailable`, instead of 500ing every route. §6.1.5 item 5 is where that gets settled.
- **`cloudflare.colo` is on every span**, not just the root — it is listed under resource attributes. The old text asserted it was a root-span attribute, which would have made the wrapper useless for the `colo` half of the grouping.

**`db.query.text` does not carry bound values — settled from workerd, not inferred.** Every D1 span carries the attribute and Cloudflare's docs don't describe its contents, which matters because spans bypass `scrubPii` (§6.1) and go to a third party. The runtime is open source and answers it three ways:

- `src/cloudflare/internal/d1-api.ts` sets `span.setAttribute('db.query.text', this.statement)`. `D1PreparedStatement` holds `statement` and `params` as separate fields, and `params` is passed to no span attribute.
- There is no `db.query.parameter.*` anywhere in workerd. That attribute is opt-in under the OTel spec and Cloudflare simply doesn't implement it, so there is no configuration that would turn values on.
- `src/cloudflare/internal/test/d1/d1-api-instrumentation-test.js` pins the bound case: a query executed with a real binding (`rows_read: 1`) expects `db.query.text` of exactly `SELECT * FROM users WHERE user_id = ?;`. The placeholder survives; the value never appears.

The transport span underneath doesn't leak them either — the `fetch` to the D1 backend records `http.request.body.size` but not the body, and the params live in that body. This also matches the OTel convention, which says parameterized query text should *not* be sanitized precisely because parameters ride separately.

**What does still reach the provider unfiltered is the request URL — and it is more than the access line has ever carried.** `url.path`/`url.full` on the fetch handler span carry game and user ids, which the access line's `path` field already exports (`cloud/src/log.ts` sets `path: url.pathname`). `url.full` also carries the **query string**, which `path` has never included, so this is a widening of the field set and not just of the path it travels. `scrubPii` sees none of it — spans are the platform's, not `log.ts`'s.

Concretely new to Honeycomb:

- `q=` on `GET /v1/users/search` and `GET /v1/games`. User-typed, and on the users search it is frequently a username — a value `PII_KEYS` redacts when a handler puts it in a log field.
- `discord_id`/`username` on `GET /v1/auth/dev/login`. Dark in production (the route requires `env.DEV_LOGIN` and a non-secure request), but a crafted request is spanned before it 404s, so the values ride out on the span regardless.

**This is accepted, not mitigated.** There is no filter to apply: the attribute is set by the platform on a span this repo does not create, so the only alternative to accepting it is not tracing at all. The root `CLAUDE.md` guardrail no longer asserts that PII is never logged, because with tracing on that would be false. What still holds, and is still enforced in code, is the lane rule: `online_id` stripped from the share blob for anonymous viewers, `discord_id`/`username` in D1 metadata only, `PII_KEYS` redaction on every log line. Revisit if the search endpoints ever carry something more sensitive than a username, or if Honeycomb stops being the destination.

Tracing is still in early beta, and its known-limitations page states that span and attribute names may change to align with OpenTelemetry conventions. Our own `route` attribute is unaffected by that churn; the `cloudflare.*` ones are not.

Still true: if spans plus the route attribute prove they cover it, the `d1_*`/`r2_ms` block in `log.ts` becomes a deletion candidate rather than something to maintain. Don't delete it until the tail-colo cells have actually filled from spans.

#### 6.1.5 First-deploy verification

Everything above is vendor documentation until this is run once (§6.1 status note). It is a ten-minute pass on the first deploy that carries these blocks, and it wants doing **before** the multi-week measurement window starts — a window that turns out to be measuring an opaque string is a window spent twice. Record answers inline in the sections named; delete a checkbox only by replacing it with what you saw.

**1. Is the access line indexed as fields, or one opaque string?** The highest-stakes item, because §6.1's Workers Logs bullet — "Cloudflare parses and indexes our custom fields automatically" — and the entire issue #150 query plan rest on it. In the Workers Logs dashboard, try `groupBy route` and a `p95` of `d1_wall_ms`.

- If `route`, `colo`, `d1_wall_ms` appear as filterable fields → the claim holds, strike this item.
- If the line arrives as a single `message` string → **`emit()` in `cloud/src/log.ts` is the cause.** It calls `console.log(JSON.stringify(line, replacer))`, so it logs a *string*; Cloudflare's structured-logging examples all pass an *object*, and the documented behavior for a string argument is `{message: "…"}`. The fix is passing the object, but the replacer exists to coerce stray `Error`s to `{name, message}` — so apply it before logging rather than dropping it. Fixing this later means discarding the data collected until then.

**2. Do both destinations actually receive?** A destination name with no match, or a typo, exports nothing forever with no error on either side (§6.1.2). Confirm in Honeycomb that log records *and* spans arrive — separately; one working does not imply the other, they are different destinations.

**3. Which dataset(s) appear, and do prod and staging split?** Depends on what Cloudflare sets `service.name` to (§6.1.2). Note the actual dataset name(s). If prod and staging share one, every prod percentile needs a `cloudflare.script_name` filter and that should be stated wherever those queries get written down.

**4. What is the exported log record's body encoding?** The open question in §6.1.3 — string, nested object, or double-encoded JSON. Not answerable from source: unlike the D1 spans, the log exporter is Cloudflare infrastructure, not workerd. Look at one raw record and write the answer into §6.1.3.

**5. Do the wrapper spans arrive, with a duration and with children?** Three things, in this order, because each is meaningless if the one before it failed (§6.1.4):

- **Are there wrapper spans at all?** `startActiveSpan` has never run at our `compatibility_date`. If it isn't exposed there, `dispatch()` serves untraced by design and logs a `tracing_unavailable` warn — so check the log sink for that event before concluding anything about the spans. The fix would be a `compatibility_date` bump, not a code change.
- **Is `route` present and groupable alongside `cloudflare.colo`?** The grouping key the whole section exists for.
- **Do the spans have a real duration, and do D1/R2 spans nest under them?** A wrapper span with a correct `route` and a ~0ms duration is the silent failure the `.finally(() => span.end())` form exists to prevent; a p95 built on it would be wrong rather than absent. Ours is pinned by the integration tests, but only against a stand-in — the platform's half has still never run against the real exporter.

**6. Sanity-check the event burn.** §6.1.4 estimates ~900k spans + ~90k log lines/month against Honeycomb's 20M. Check the actual rate after a day against Honeycomb's usage view. `head_sampling_rate` is 1 on both sinks precisely because the estimate says there is room; if the real number is an order of magnitude off, that is the setting to revisit.

## 7. Explicitly NOT doing

So future-Claude doesn't try to reintroduce these.

- **Bake stages.** No solo bake, no cohort bake, no ≥50 uploads / ≥5 users
  / ≥7 days criteria, no parser-version freeze. Real test users arrive
  with the next feature, which is the right time to find and fix issues.
- **Atlas migration to R2.** Old plan §6. Content-hashed paths under
  `static/` (§3.4) give us the same versioning + cache-bust win that R2
  versioning would have, without new infra. R2 was also hedging against
  an SSR Worker CPU cost that doesn't apply to static assets served via
  the adapter-cloudflare static asset handler.
- **Conservative-then-tuned rate limits.** Spec values stay; we don't have
  the abuse-rate signal to justify halving them. Tighten reactively if
  needed.
- **Desktop preservation work.** Done — v0.2.0 GitHub Release is the
  desktop-final artifact. No new tag, no new binaries.
- **Tauri sweep PRs (F1/F2).** Done — see commits 27427db, f97c09a, b4f279b.

## 8. Parked follow-ups

Ship after deploy when there's a reason to. None block launch.

| Item                                 | Notes                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account-deletion path                | Privacy compliance. No UI today to delete user record + cascade to games + R2.                                                                                     |
| Unlink-Discord                       | Intentionally not offered — Discord is the only auth provider. Add when a second provider exists.                                                                  |
| Dynamic per-game OG image            | satori + resvg-wasm Worker route. Replaces static `og-default.png`.                                                                                                |
| Mobile-width header layout           | `/games/[id]` may need a collapse menu on narrow screens.                                                                                                          |
| `_routes.json` tuning                | adapter-cloudflare warns about dropped exclude rules; static asset paths invoke the SSR Worker unnecessarily.                                                      |

## 9. Staging environment (issue #41)

A parallel deployment — `staging.per-ankh.app` (frontend) + `api-staging.per-ankh.app` (API) — defined by the `[env.staging]` blocks in both wrangler.tomls, with fully separate D1/KV/R2 and a separate Discord OAuth app. Deploys run through `./per-ankh staging <preflight|deploy|migrate|smoke|status>` (same pipeline as `prod`, minus the changelog/version/tag step). The `secrets.parity` preflight check enforces that `[env.staging.vars]` and the staging binding names stay in lockstep with the top level, because wrangler does not inherit either into named envs.

### 9.1 One-time provisioning (operator)

All commands from `cloud/` unless noted. Each authenticates via `wrangler login` (1Password-gated on the dev machine).

1. **Create the staging resources**, then paste the returned IDs over the `__STAGING_*__` placeholders in `cloud/wrangler.toml`:

   ```bash
   npx wrangler d1 create per-ankh-share-index-staging
   npx wrangler kv namespace create SESSIONS_KV --env staging
   npx wrangler kv namespace create SESSIONS_KV --env staging --preview
   npx wrangler r2 bucket create per-ankh-shares-staging
   ```

2. **Register the staging Discord application** at <https://discord.com/developers/applications> with OAuth2 redirect `https://staging.per-ankh.app/auth/callback`. Paste its client ID over `__STAGING_DISCORD_CLIENT_ID__` in `[env.staging.vars]`, then:

   ```bash
   npx wrangler secret put DISCORD_CLIENT_SECRET --env staging
   npx wrangler secret put ADMIN_DISCORD_ID --env staging   # optional: staging site-admin
   npx wrangler secret put SSR_TRUSTED_KEY --env staging    # same value on both staging Workers
   ```

   `SSR_TRUSTED_KEY` also goes on the staging *frontend* Worker
   (`npx wrangler secret put SSR_TRUSTED_KEY --env staging` from the repo root)
   — its own value, not prod's. See §3.2 for what it does.

   Wrangler stores secrets on a worker, and the staging worker doesn't exist before the first deploy — so the first `secret put` asks *"There doesn't seem to be a Worker called per-ankh-share-api-staging — create it?"*. Answer **yes**: it creates an empty worker shell that the real deploy then overwrites. (Declining silently discards the secret, and staging preflight then blocks on `secrets.required`.)

3. **Cloudflare Access** (Zero Trust dashboard): create an Access application covering `staging.per-ankh.app` **only**. Do not put `api-staging.per-ankh.app` behind Access — the staging frontend's browser `fetch()` calls and SSR fetches can't carry an Access session, so gating the API hostname breaks the app; the API protects itself with Discord sessions exactly like prod. Two policies:
   - **Allow** — your identity (interactive login).
   - **Service Auth** — a new service token (Access → Service auth → create). Paste its credentials into a gitignored `.staging.vars` at the repo root:

     ```
     CF_ACCESS_CLIENT_ID=<token client id>
     CF_ACCESS_CLIENT_SECRET=<token client secret>
     ```

     `./per-ankh staging smoke` sends these as `CF-Access-Client-Id`/`CF-Access-Client-Secret` headers; without them the frontend probe only asserts the Access login redirect (degraded, warned).

4. **First boot:**

   ```bash
   ./per-ankh staging deploy   # migrations → worker → frontend → smoke
   ```

   The deploy applies all pending migrations itself (they're listed in the confirm summary); `npm run migrate:staging` exists for standalone use but isn't a required pre-step. Then log in once via the staging Discord app. Tournament *creation* is the one surviving beta gate — grant it only if needed: `./per-ankh admin --staging tournament beta-grant <discord_id>`.

### 9.2 Notes

- **Custom domains:** wrangler attaches `staging.per-ankh.app` / `api-staging.per-ankh.app` and creates DNS automatically on first deploy, same as prod (§3.8).
- **Session cookies:** both envs set `Domain=per-ankh.app` (sibling subdomains' only shared ancestor), so the cookie *name* is per-env (`SESSION_COOKIE_NAME` var: `session` / `session_staging`) — a staging login would otherwise clobber the prod session in the same browser.
- **Frontend builds:** `./per-ankh staging deploy` injects `VITE_API_URL` / `VITE_PUBLIC_ORIGIN`; CSP `connect-src` and the report endpoints follow `VITE_API_URL` via the SSR-time rewrite in `src/hooks.server.ts`. A bare `npm run build` stays a correct prod build.
- **No staging legacy viewer:** `web/` is frozen and prod-only; staging smoke has no legacy probe.
- **routes inheritance footgun:** wrangler *does* inherit `routes` into named envs — never delete the `routes` line from an `[env.staging]` block, or a staging deploy will attach the prod custom domain (the toml comments call this out).

### 9.3 Recloning staging from prod (issue #64)

`./per-ankh staging reclone` destroys all staging data and replaces it with production's: D1 via a fresh `./per-ankh backup` export imported over a dropped schema, R2 via `rclone sync` (staging-only objects are deleted). The import file is re-emitted in FK dependency order first — wrangler's raw dump orders tables by creation, and the schema's forward FK reference (`games` → `collections`) makes it unreplayable under D1's FK enforcement. Staging data is **disposable by design** — never curate it, re-clone it. KV is never synced: sessions and OAuth state are per-environment, and a stale staging session 401s and clears itself on the next request (log in again).

The migration-rehearsal ordering is the point. The dump carries prod's `d1_migrations` bookkeeping, so right after a reclone, staging reports exactly the migrations prod hasn't applied yet — `./per-ankh staging migrate` (or `staging deploy`) then rehearses them against real-shaped data. When a rehearsal fails, fix the migration and re-run cheaply against the same artifact instead of re-exporting:

```bash
./per-ankh staging reclone                                  # fresh prod export (default)
./per-ankh staging reclone --from backups/<dump>.sql        # retry loop after a failed rehearsal
./per-ankh staging migrate                                  # rehearse the pending migrations
```

**One-time provisioning.** `rclone` and `sqlite3` on PATH (`brew install rclone`; macOS ships sqlite3), plus two R2 API tokens (dashboard → R2 → Manage API tokens). R2 tokens carry a single permission level across their bucket scope, so least privilege requires two:

- **Object Read only**, scoped to `per-ankh-shares` (prod source).
- **Object Read & Write**, scoped to `per-ankh-shares-staging` (staging destination).

Add their credentials — plus the account id for the S3 endpoint (`<id>.r2.cloudflarestorage.com`) — to the gitignored `.staging.vars`, alongside the Access service token:

```
CF_ACCOUNT_ID=<cloudflare account id>
R2_PROD_RO_ACCESS_KEY_ID=<prod read-only token key id>
R2_PROD_RO_SECRET_ACCESS_KEY=<prod read-only token secret>
R2_STAGING_RW_ACCESS_KEY_ID=<staging read-write token key id>
R2_STAGING_RW_SECRET_ACCESS_KEY=<staging read-write token secret>
```

The command synthesizes both rclone remotes from env vars — no rclone config file. Missing credentials fail the reclone preflight (listing the keys) before anything is touched.

**PII / lifecycle.** A reclone copies production user data (Discord ids, usernames, game blobs) into staging — a copy that `nuke-user` and any future account-deletion path don't know about. The policy that makes this acceptable: staging is disposable and periodically re-cloned, never curated, so prod deletions propagate at the next reclone. The legacy share viewer is prod-only and unaffected.
