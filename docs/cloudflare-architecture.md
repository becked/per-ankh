# Cloudflare Infrastructure Architecture

## System Overview

The Cloudflare infrastructure powers the "Share Game" feature, allowing desktop app users to upload game analytics and share them via a public URL. Three Cloudflare services work together:

```
┌─────────────────────────┐
│  Desktop App (Tauri)    │
│  Rust HTTP client       │
└───────────┬─────────────┘
            │
            │  POST /v1/share      (upload gzipped JSON)
            │  DELETE /v1/share/id  (authenticated delete)
            │
┌───────────▼──────────────────────────────────────────┐
│  Cloudflare Worker — api.per-ankh.app                │
│  (per-ankh-share-api)                                │
│                                                      │
│  Validation → Rate Limiting → Blocklist checks       │
│                                                      │
│  ┌────────────────────┐  ┌─────────────────────────┐ │
│  │ R2 Bucket          │  │ D1 Database             │ │
│  │ per-ankh-shares    │  │ per-ankh-share-index    │ │
│  │                    │  │                         │ │
│  │ {id}.json.gz blobs │  │ Share index + metadata  │ │
│  │ Custom metadata    │  │ Event audit log         │ │
│  └────────────────────┘  │ Rate limit counters     │ │
│                          │ Blocklists (keys + IPs) │ │
│                          └─────────────────────────┘ │
└───────────┬──────────────────────────────────────────┘
            │
            │  GET /v1/share/id  (fetch + decompress blob)
            │
┌───────────▼─────────────────────┐
│  Cloudflare Pages               │
│  per-ankh.app                   │
│                                 │
│  Static SvelteKit site          │
│  /share/[id] — game viewer      │
│  Shared components via symlinks │
└─────────────────────────────────┘
```

## Worker API (`cloud/`)

### Source

```
cloud/
├── wrangler.toml       # Worker config, bindings, env vars
├── schema.sql          # D1 database schema
├── package.json        # Scripts: dev, deploy, d1:init, test
├── src/
│   ├── index.ts        # Router + endpoint handlers (~545 lines)
│   └── validation.ts   # Payload schema validation (~199 lines)
└── tsconfig.json
```

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/share` | Upload a shared game blob |
| `GET` | `/v1/share/{id}` | Download a shared game blob |
| `DELETE` | `/v1/share/{id}` | Delete a shared game (authenticated) |
| `OPTIONS` | `*` | CORS preflight |

The share ID in URLs is a 21-character nanoid (`[A-Za-z0-9_-]{21}`, ~126 bits of entropy).

### Upload Flow (17 steps)

1. **Kill switch** — check `UPLOADS_ENABLED` env var
2. **App key validation** — `X-App-Key` header must be UUID v4
3. **IP extraction** — `CF-Connecting-IP` header
4. **Blocklist check** — D1 lookup against `blocked_keys` and `blocked_ips`
5. **Per-key rate limit** — max 10 uploads/hour per app key (D1)
6. **Per-IP rate limit** — max 20 uploads/hour per IP (D1)
7. **Global circuit breaker** — max 200 uploads/hour total (D1)
8. **Content-Type check** — must be `application/gzip`
9. **Content-Length check** — early reject if declared size > 5 MB
10. **Body read + size check** — actual compressed size <= 5 MB
11. **Gzip decompression** — streaming with 20 MB size limit (gzip bomb protection)
12. **JSON parse**
13. **Schema validation** — top-level fields, array bounds, nested structures
14. **ID generation** — 21-char share ID + 32-char delete token (both nanoid)
15. **Metadata extraction** — game name, turns, nation, map size from payload
16. **R2 write** — store gzipped blob with custom metadata
17. **D1 write** — insert share record; on failure, clean up R2 blob

Returns `201` with `{ share_id, url, delete_token }`.

### Download Flow

1. **Per-IP rate limit** — max 200 downloads/hour per IP (Cache API, per-POP)
2. **R2 fetch** — get `{id}.json.gz` from bucket
3. **Decompress in Worker** — necessary because Cloudflare CDN strips `Content-Encoding` from Worker responses
4. **Return JSON** — with `Cache-Control: public, max-age=3600` for CDN caching

### Delete Flow

1. **Header validation** — require `X-Delete-Token` and `X-App-Key`
2. **D1 lookup** — verify share exists and credentials match (timing-safe comparison)
3. **R2 delete** — remove blob
4. **D1 delete** — hard-delete share record
5. **Event log** — record delete event

### Security Layers

**Rate limiting** (three independent layers):

| Layer | Scope | Limit | Storage |
|-------|-------|-------|---------|
| Per-key | Single app installation | 10 uploads/hour | D1 events table |
| Per-IP | Single IP address | 20 uploads/hour | D1 events table |
| Global | All uploads combined | 200 uploads/hour | D1 events table |
| Download | Single IP address | 200 downloads/hour | Cache API (per-POP) |

**Blocklists**: Admin-managed `blocked_keys` and `blocked_ips` tables in D1. Checked before any expensive operation (body buffering, decompression).

**Payload validation** (`validation.ts`):
- Schema version check (currently only version 1)
- 15 required top-level fields
- Array length bounds (e.g., max 20 players, max 50K event logs, max 50K improvements)
- Nested object validation for `game_details` and `city_statistics`

**Timing-safe comparison**: Delete token and app key verified using `crypto.subtle.timingSafeEqual()` to prevent timing attacks.

**CORS**: Only `https://per-ankh.app` origin is allowed (configured via `ALLOWED_ORIGIN` env var). Desktop app bypasses CORS because uploads happen from Rust, not the webview.

## D1 Database

### Tables

**`shares`** — one row per shared game:
- `share_id` (PK) — 21-char nanoid
- `app_key` — UUID from the desktop app installation
- `created_at` — ISO 8601 timestamp
- `blob_version` — schema version from the payload
- `game_name`, `total_turns`, `player_nation`, `map_size` — extracted metadata
- `blob_size_bytes` — compressed blob size in R2
- `delete_token` — 32-char nanoid for authenticated deletion

**`events`** — upload/delete audit log:
- `event_type` — `'upload'` or `'delete'`
- `share_id`, `app_key`, `ip_address`
- `created_at` — auto-defaults to `datetime('now')`
- `metadata` — optional JSON blob

**`blocked_keys`** / **`blocked_ips`** — admin-managed blocklists with reason and timestamp.

### Indexes

```sql
-- Share lookups
idx_shares_app_key          ON shares(app_key)
idx_shares_created_at       ON shares(created_at)

-- Event lookups
idx_events_share_id         ON events(share_id)
idx_events_created_at       ON events(created_at)

-- Rate limit queries (composite)
idx_events_app_key_type_created  ON events(app_key, event_type, created_at)
idx_events_ip_type_created       ON events(ip_address, event_type, created_at)
idx_events_type_created          ON events(event_type, created_at)
```

### Cleanup

Events older than 90 days are pruned via probabilistic cleanup — ~2% of requests trigger a non-blocking `DELETE` query. This avoids the need for scheduled jobs.

## R2 Storage

- **Bucket**: `per-ankh-shares`
- **Key format**: `{share_id}.json.gz` (e.g., `V1StGXR8_Z5jdHi6B-myT.json.gz`)
- **Content**: Gzip-compressed JSON blob of `SharedGameData`
- **Typical size**: ~100-300 KB compressed per game
- **HTTP metadata**: `contentType: application/json`, `contentEncoding: gzip`
- **Custom metadata**: `appKey`, `createdAt`

No lifecycle rules are configured — blobs persist until explicitly deleted via the API.

## Cloudflare Pages (`web/`)

### Source

```
web/
├── svelte.config.js          # adapter-static, fallback: index.html
├── package.json              # Scripts: dev, build, preview, check
├── vite.config.js
├── tailwind.config.js
├── static/
│   └── _headers              # Security headers for all routes
└── src/
    ├── lib/
    │   ├── api-web.ts        # Fetch-based API layer (replaces desktop invoke)
    │   ├── config → ../../../src/lib/config       # Symlink
    │   ├── types → ../../../src/lib/types         # Symlink
    │   ├── game-detail → ../../../src/lib/game-detail  # Symlink
    │   ├── Chart.svelte → ...                     # Symlink
    │   ├── ChartContainer.svelte → ...            # Symlink
    │   ├── HexMap.svelte → ...                    # Symlink
    │   ├── SearchInput.svelte → ...               # Symlink
    │   ├── GamePageSkeleton.svelte → ...          # Symlink
    │   └── utils/                                 # Web-specific utils
    └── routes/
        ├── +layout.svelte    # Minimal layout (no sidebar, header, modals)
        ├── +page.svelte      # Landing page
        └── share/[id]/
            └── +page.svelte  # Game detail viewer
```

### Code Sharing

The web viewer reuses ~90% of the desktop app's frontend code via filesystem symlinks. Shared components, types, chart configs, and the game detail view are all symlinked from `src/lib/` into `web/src/lib/`.

The key substitution is `api-web.ts`, which replaces the desktop `api.ts`:
- Desktop: `invoke()` calls to Rust backend via Tauri IPC
- Web: single `fetch()` to `https://api.per-ankh.app/v1/share/{id}`, then serves cached slices

### Security Headers

Applied to all routes via `static/_headers`:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.per-ankh.app;
  img-src 'self' data:; font-src 'self'; object-src 'none';
  frame-ancestors 'none'; base-uri 'self'
```

The CSP `connect-src` directive allows the web viewer to fetch from the Worker API.

### Build

Uses `@sveltejs/adapter-static` to produce a fully static site. SPA fallback to `index.html` enables client-side routing for `/share/[id]` paths.

```bash
cd web && npm run build    # Output: web/build/
```

## Deployment

### Worker API

Deployed manually via Wrangler CLI. No CI/CD pipeline — deployments are intentional.

```bash
cd cloud
npm run deploy    # → wrangler deploy
```

The Worker is bound to the custom domain `api.per-ankh.app` — Wrangler creates the DNS record automatically.

### D1 Schema

Schema changes are applied manually:

```bash
cd cloud
npm run d1:init   # → wrangler d1 execute per-ankh-share-index --file=schema.sql
```

All `CREATE TABLE` and `CREATE INDEX` statements use `IF NOT EXISTS`, making the script idempotent and safe to re-run.

### Cloudflare Pages (Web Viewer)

Deployed via Cloudflare's GitHub integration — **automatic on push**. The Pages project is connected to the GitHub repository and auto-builds from the `web/` directory. No GitHub Actions workflow is needed for this.

Build command (configured in Cloudflare dashboard):
```
cd web && npm install && npm run build
```

Output directory: `web/build`

### Desktop App Releases

Separate from cloud infrastructure. The GitHub Actions workflow (`.github/workflows/release.yml`) triggers on `v*` tags and builds native binaries for macOS, Windows, and Linux. This does not deploy any Cloudflare resources.

## GitHub Integration

### Cloudflare Pages ↔ GitHub

The Cloudflare Pages project (`per-ankh`) is connected to the GitHub repository. On every push to the main branch, Cloudflare automatically:

1. Clones the repository
2. Runs the build command (`cd web && npm install && npm run build`)
3. Deploys the `web/build/` output to the Pages CDN
4. Makes it available at `per-ankh.app` (custom domain)

Preview deployments are also generated for pull requests, enabling testing before merge.

### GitHub Actions (Desktop Releases)

The release workflow builds and publishes desktop app binaries. It is independent of Cloudflare but included here for completeness.

**Trigger**: Push of a `v*` tag

**Matrix**: macOS (aarch64 + x86_64), Windows, Ubuntu

**Secrets used**:
| Secret | Purpose |
|--------|---------|
| `APPLE_DEVELOPER_CERT` | macOS code signing certificate (base64 .p12) |
| `APPLE_CERT_PASSWORD` | Certificate password |
| `APPLE_ID` | Apple notarization account |
| `APPLE_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri auto-updater signing key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Signing key password |
| `GITHUB_TOKEN` | Auto-provided, used for creating draft releases |

**Output**: Draft GitHub Release with platform-specific installers (.dmg, .exe, .msi, .deb, .rpm).

## Environment & Configuration

### Worker Environment Variables (`cloud/wrangler.toml`)

| Variable | Value | Purpose |
|----------|-------|---------|
| `MAX_COMPRESSED_SIZE` | `5242880` (5 MB) | Max upload size |
| `MAX_DECOMPRESSED_SIZE` | `20971520` (20 MB) | Gzip bomb protection limit |
| `ALLOWED_ORIGIN` | `https://per-ankh.app` | CORS allowed origin |
| `RATE_LIMIT_PER_HOUR` | `10` | Max uploads per app key per hour |
| `IP_RATE_LIMIT_PER_HOUR` | `20` | Max uploads per IP per hour |
| `DOWNLOAD_RATE_LIMIT_PER_HOUR` | `200` | Max downloads per IP per hour |
| `GLOBAL_UPLOAD_LIMIT_PER_HOUR` | `200` | Circuit breaker for all uploads |
| `UPLOADS_ENABLED` | `true` | Kill switch (override via `wrangler secret put`) |

### Kill Switch Pattern

`UPLOADS_ENABLED` is set to `"true"` in `wrangler.toml` but can be overridden to `"false"` via `wrangler secret put UPLOADS_ENABLED` without redeploying the Worker. This provides an emergency off switch for uploads.

### Custom Domain Routing

```toml
routes = [{ pattern = "api.per-ankh.app", custom_domain = true }]
```

Wrangler manages the DNS record automatically. All requests to `api.per-ankh.app` are routed to the Worker.

## Data Flow

### Upload (Desktop → Cloud)

```
Desktop App
  1. User clicks "Share" on game detail page
  2. Rust queries all 12 data endpoints from DuckDB
  3. Assembles SharedGameData JSON, gzip compresses
  4. Gets/creates app_key from local app_state table
  5. POST to https://api.per-ankh.app/v1/share
     Headers: Content-Type: application/gzip, X-App-Key: {uuid}
     Body: gzipped JSON

Worker
  6. Validates, rate-limits, decompresses, validates schema
  7. Generates share_id (nanoid) and delete_token (nanoid)
  8. Writes blob to R2: {share_id}.json.gz
  9. Writes index to D1: shares table
  10. Returns { share_id, url, delete_token }

Desktop App
  11. Stores share_id, url, delete_token in local shared_games table
  12. Shows URL in popover with copy button
```

### Download (Web Viewer)

```
Browser navigates to https://per-ankh.app/share/{id}
  1. Cloudflare Pages serves static SvelteKit app
  2. Client-side JavaScript fetches https://api.per-ankh.app/v1/share/{id}

Worker
  3. Checks download rate limit (Cache API)
  4. Fetches {id}.json.gz from R2
  5. Decompresses in Worker (CDN strips Content-Encoding)
  6. Returns JSON with Cache-Control: public, max-age=3600

Browser
  7. api-web.ts caches blob in memory
  8. GameDetailView renders all tabs from cached data
```

### Delete (Desktop → Cloud)

```
Desktop App
  1. User clicks "Delete" in share popover, confirms
  2. Rust reads share_id, delete_token, app_key from local DB
  3. DELETE to https://api.per-ankh.app/v1/share/{id}
     Headers: X-Delete-Token: {token}, X-App-Key: {uuid}

Worker
  4. Verifies credentials (timing-safe comparison)
  5. Deletes R2 blob
  6. Hard-deletes D1 share record
  7. Logs delete event
  8. Returns 204 No Content

Desktop App
  9. Deletes local shared_games record
  10. UI reverts to "not shared" state
```

## Domains

| Domain | Service | Purpose |
|--------|---------|---------|
| `per-ankh.app` | Cloudflare Pages | Web viewer (static site) |
| `api.per-ankh.app` | Cloudflare Worker | Share API (upload/download/delete) |

## Free Tier Capacity

| Resource | Free Allowance | Estimated Usage |
|----------|---------------|-----------------|
| R2 storage | 10 GB/month | ~300 KB/game = ~33,000 games |
| R2 writes | 1M/month | 1 per share upload |
| R2 reads | 10M/month | 1 per view (cached by CDN for 1 hour) |
| Workers requests | 100K/day | Upload + download combined |
| D1 reads | 5M/day | Rate limit checks per request |
| D1 writes | 100K/day | Share records + event logs |
| Pages bandwidth | Unlimited | Static site hosting |
| Egress | Free | No bandwidth charges on any service |
