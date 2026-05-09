# Per-Ankh Cloud Deploy Plan

Forward-only checklist for getting the cloud rewrite (currently on
`cloud-rewrite`) deployed to https://per-ankh.app. Replaces the active
parts of [`cloud-productionization-plan.md`](./cloud-productionization-plan.md);
the old doc stays as historical context.

## 1. Status

- Tauri is gone. v0.2.0 GitHub Release is the desktop-final artifact.
- Cloud Worker is feature-complete (auth, upload, games, dashboard, sharing,
  reparse, downloads, observability, audit log, CSP reporting).
- Initial release ships gated to a single Discord ID via `ALLOWED_DISCORD_ID`
  (fail-closed if unset). Allowlist expands when test users join the next
  feature.
- Legacy `/v1/share/*` endpoints and the `web/` viewer are untouched and
  continue to serve `per-ankh.app/share/[id]` for old desktop-app share links.

Real test users will arrive with the next feature, providing live feedback;
that's why this plan deliberately skips formal bake stages.

## 2. UI polish backlog (deploy-blocking)

Fill in as items surface. Empty this list before running §4.

- [ ] _(add items here)_

## 3. Cloudflare provisioning checklist

One-time setup. None of this is in the repo today; everything below blocks deploy.

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
npx wrangler secret put ALLOWED_DISCORD_ID      # your Discord user ID
```

The auth handler is fail-closed if `ALLOWED_DISCORD_ID` is unset, so don't
skip it — login will hard-fail with no helpful diagnostic until it's set.

### 3.3. Discord OAuth app

In the Discord developer portal for client `1500901451034263604`
(value at `cloud/wrangler.toml:68`), add `https://per-ankh.app/auth/callback`
as an authorized redirect URI alongside the existing localhost entry.
The redirect URI is supplied by the frontend at request time
(`cloud/src/auth.ts:164`), but Discord rejects URIs not on its list.

### 3.4. Content-hashed atlas + sprite paths

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

**Frontend change.** `src/lib/SpriteMap.svelte:33-38` currently builds atlas
URLs from a `ATLAS_BASE` constant and hardcoded names. Replace with
manifest lookups:

```typescript
import { ATLAS_MANIFEST } from "$lib/generated/atlas-manifest";

const TERRAIN_3D_ATLAS_URL = ATLAS_MANIFEST["terrain-3d.webp"];
const IMPROVEMENTS_BASE_ATLAS_URL = ATLAS_MANIFEST["improvements-base.webp"];
// ...
const urbanAtlasUrl = (family: string) =>
	ATLAS_MANIFEST[`improvements-urban-${family}.webp`];
```

The same pattern applies to anything else referencing baked atlas/sprite
filenames; grep for `/atlases/` and `/sprites/` to find them.

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

`@sveltejs/adapter-cloudflare` outputs to `.svelte-kit/cloudflare/` and is
deployed via `wrangler deploy` from the repo root. There's no root-level
`wrangler.toml` today — add one, with:

- `name = "per-ankh-frontend"` (or similar — distinct from the API Worker
  name `per-ankh-share-api`)
- `main = ".svelte-kit/cloudflare/_worker.js"` (verify the exact filename
  after a `npm run build`)
- `compatibility_date` matching the API Worker
- `routes = [{ pattern = "per-ankh.app", custom_domain = true }]`
- `assets` block pointing at `.svelte-kit/cloudflare/`

Confirm against current adapter-cloudflare 7.x docs before committing —
the exact `assets` shape evolves between adapter versions.

### 3.6. Build-time env vars

`.env.example` already lists what's needed. For the production build:

```
VITE_API_URL=https://api.per-ankh.app/v1
VITE_PUBLIC_ORIGIN=https://per-ankh.app
```

Wire these in via Cloudflare Worker build settings (preferred) or set in
the local environment when running `npm run build`.

### 3.7. Cloudflare alerts

Cloudflare dashboard → Notifications. Enable:

- Worker error rate (5xx > 1% over 5 min)
- Worker CPU exceeded
- D1 errors

Free, 5-minute setup. No SLOs yet — the next feature's user feedback will
shape what's worth measuring.

## 4. Deploy

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
   # confirm 0001..0004 land cleanly, then:
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
5. **Deploy the frontend Worker.** From the repo root:
   ```bash
   npm run build
   npx wrangler deploy
   ```
6. **Verify custom domains resolve** — `api.per-ankh.app` and
   `per-ankh.app` both serve from Cloudflare. The `routes` blocks in the
   two `wrangler.toml`s create the DNS records automatically; if they
   don't, do it manually in the dashboard.
7. **Run §5 smoke test against prod.** Do not announce until it passes.

## 5. Smoke test

Against the live `https://per-ankh.app`. Run in this order:

1. Anonymous load of `/` — 200, no console errors.
2. `/login` → Discord OAuth → callback → `/dashboard`. Verifies the
   allowlisted Discord ID logs in (and that any other ID is rejected with
   a clean error, not a 500).
3. Upload one save via `/upload` — appears in `/games`.
4. Toggle public on that game, then load `/games/[id]` in a logged-out
   browser. Confirms anonymous read path works and PII is stripped.
5. Download the raw save back via the download endpoint.
6. Reparse — bump `parser_version` locally if needed to trigger the banner.
7. Delete the test game.
8. Load an old `/share/[id]` URL from the legacy share viewer — confirms
   the `web/` deploy and `/v1/share/*` legacy endpoints still work.

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

| Item                                     | Notes                                                                                                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account-deletion path                    | Privacy compliance. No UI today to delete user record + cascade to games + R2.                                                                                                                                                                         |
| Unlink-Discord                           | Intentionally not offered — Discord is the only auth provider. Add when a second provider exists.                                                                                                                                                      |
| Dynamic per-game OG image                | satori + resvg-wasm Worker route. Replaces static `og-default.png`.                                                                                                                                                                                    |
| Mobile-width header layout               | `/games/[id]` may need a collapse menu on narrow screens.                                                                                                                                                                                              |
| Prune `anon_read` rows from `events`     | Scheduled Worker cron: `DELETE FROM events WHERE event_type = 'anon_read' AND created_at < datetime('now', '-2 hours')` daily. Other event types stay (audit log).                                                                                     |
| `_routes.json` tuning                    | adapter-cloudflare warns about dropped exclude rules; static asset paths invoke the SSR Worker unnecessarily.                                                                                                                                          |
| Allowlist expansion                      | When inviting test users, swap `ALLOWED_DISCORD_ID` from a single ID to a comma-separated list + `Set<string>` membership check in `cloud/src/auth.ts` (`handleDiscordCallback` + `handleMe`). `wrangler secret put` the new value.                    |
