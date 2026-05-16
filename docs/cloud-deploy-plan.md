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
- Sign-up is gated by a single shared invite-code passphrase, the
  `INVITE_CODE` Worker secret. Only new accounts are checked (existing
  `discord_id` in `users` bypasses); failed attempts are per-IP rate-limited.
  Rotate by `wrangler secret put INVITE_CODE` with a new value — no
  redeploy, new logins pick it up immediately.
- Legacy `/v1/share/*` endpoints stay live on the API Worker (desktop
  v0.2.0 still mints share URLs against it). At cutover, deploy moved
  `per-ankh.app` from the Pages project to the new SSR Worker,
  reattached the legacy SPA to `legacy.per-ankh.app`, and added a
  `/share/*` 302 from `per-ankh.app` to `legacy.per-ankh.app` to keep old
  share URLs resolving (see §3.8 + §4 step 5).

Real test users arrived with the next feature, providing live feedback;
that's why this plan deliberately skipped formal bake stages.

## 2. UI polish backlog (deploy-blocking)

Fill in as items surface. Empty this list before running §4.

- [ ] _(add items here)_

## 3. Cloudflare provisioning checklist

> **Status: completed.** Historical reference for the one-time setup. Re-run any of these if a fresh environment ever needs provisioning.

One-time setup. Everything below blocked the original deploy.

### 3.1. Sessions KV namespace

`cloud/wrangler.toml:39-40` currently has `REPLACE_WITH_PROD_KV_ID` placeholders.

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
npx wrangler secret put INVITE_CODE             # sign-up passphrase, share OOB
```

`./per-ankh prod preflight` will fail if either is unset on the production
Worker. Rotate `INVITE_CODE` later with the same command — new value, no
redeploy.

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
   SPA. `curl -I https://api.per-ankh.app/v1/stats` should return `200`.
8. **Run §5 smoke test against prod.** Do not announce until it passes.

## 5. Smoke test

> **Status: now automated.** A 3-probe subset (anonymous home, auth/me, legacy share host) runs as part of `./per-ankh prod deploy`. The full functional smoke (OAuth, upload, download, reparse, delete, share-redirect) remains manual and is the authoritative checklist below.

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
   (`src/lib/ReimportButton.svelte`) only appears when the stored
   `parser_version` is older than the frontend's `PARSER_VERSION`; if
   they're equal, bump `PARSER_VERSION` locally to surface the button.
   The bulk equivalent is the dashboard's `BulkReparseModal`.
7. Delete the test game.
8. Load an old `https://per-ankh.app/share/[id]` URL in a browser —
   confirms the SSR Worker 302-redirects to `legacy.per-ankh.app/share/[id]`
   and the Pages deployment still serves the page. Also confirms
   `/v1/share/*` legacy API endpoints (which the page calls under the
   hood) still work — these stay live for desktop v0.2.0 users.

If any step fails, do not announce. Fix and re-deploy.

## 6. First-week monitoring

The floor for "is it broken right now". Polish comes after the next
feature surfaces real query patterns.

- **Error tracking.** Sentry or Baselime (Cloudflare-acquired). Free tier
  covers solo-launch volume. Wire it into the API Worker first; SSR
  Worker second. Skip until week one is uneventful if it slows the deploy.
- **Logpush sink.** The structured JSON logging from commit 06e88b6 emits
  via `console.log`. Logpush picks it up if a destination is configured.
  Default if undecided: R2 bucket, query later with DuckDB. Cheap and
  Cloudflare-native.
- **Synthetic uptime check.** Cloudflare Health Checks on `/v1/stats`
  every 1–5 min. Catches DNS/cert/whole-site-down failures that
  handler-level alerts miss.
- **Audit-log spot check** at the end of week one. Grep `audit_events`
  for unexpected patterns (mass deletes, high-frequency reimports,
  PATCHes from unfamiliar IPs).

SLOs and dashboards explicitly deferred until usage patterns emerge with
the next feature.

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
| Prune `anon_read` rows from `events` | Scheduled Worker cron: `DELETE FROM events WHERE event_type = 'anon_read' AND created_at < datetime('now', '-2 hours')` daily. Other event types stay (audit log). |
| `_routes.json` tuning                | adapter-cloudflare warns about dropped exclude rules; static asset paths invoke the SSR Worker unnecessarily.                                                      |
