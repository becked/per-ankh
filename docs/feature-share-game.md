# Feature Design: Share Game

## 1. Problem Statement

Per-Ankh is a desktop-only application. When a user finishes an Old World game and wants to share their analytics with friends, forum posts, or the community, they have no way to do so. Screenshots lose interactivity. The raw DuckDB database is not portable.

A "Share Game" feature lets users click a button, upload a snapshot of one game's analytics, and receive a URL that opens a fully interactive web viewer — the same 9-tab experience (Events, Laws, Techs, Yields, Military, Cities, Improvements, Map, Settings) rendered in a browser, with no install required for the recipient.

## 2. User Experience Flow

```
Desktop App                     Cloud Storage              Web Viewer
───────────                     ─────────────              ──────────

User views game detail page
         │
         ▼
  Clicks "Share" button
         │
         ▼
  Rust backend queries all
  12 data endpoints, assembles
  into single JSON blob,
  gzip-compresses it
         │
         ▼
  HTTP POST to storage ────────▶ Blob stored at
         │                       {share_id}.json.gz
         ▼                              │
  App shows URL in a modal              │
  (with copy-to-clipboard)              │
                                        │
  Recipient opens URL  ◀───────────────┘
         │
         ▼
  per-ankh.pages.dev/share/{id}
         │
         ▼
  SvelteKit web app fetches
  the blob, decompresses,
  renders the full 9-tab
  game detail UI
```

**Desktop UX details:**

- Share button appears on the game detail page near the game title
- On click: modal with a spinner ("Uploading..."), then the URL + a "Copy Link" button
- Error state: error message inline with a "Try Again" button

## 3. Architecture

```
┌──────────────────────────────────────────────┐
│  Desktop App (Tauri)                         │
│                                              │
│  ┌────────┐   ┌────────┐   ┌─────────────┐  │
│  │ Svelte │◄─▶│ api.ts │◄─▶│ Rust cmds   │  │
│  │ Game   │   │        │   │ (DuckDB)    │  │
│  │ Detail │   └────────┘   └──────┬──────┘  │
│  │ Page   │                       │         │
│  │   +    │               share_game()      │
│  │ Share  │               assembles JSON,   │
│  │ Button │               gzips, uploads    │
│  └────────┘                       │         │
└───────────────────────────────────┼─────────┘
                                    │
                              HTTP POST
                              (gzipped JSON)
                                    │
                      ┌─────────────▼─────────────┐
                      │   Cloudflare               │
                      │     Worker (upload API)     │
                      │     R2 (blob storage)       │
                      └─────────────┬─────────────┘
                                    │
                              HTTP GET
                              (gzipped JSON)
                                    │
                      ┌─────────────▼─────────────┐
                      │   Web Viewer               │
                      │   per-ankh.pages.dev       │
                      │                            │
                      │   SvelteKit static app     │
                      │   ~90% shared frontend     │
                      │   code with desktop app    │
                      │                            │
                      │   api-web.ts replaces      │
                      │   api.ts (fetch vs invoke) │
                      └───────────────────────────┘
```

## 4. Data Model

### 4.1 Shared Game JSON Schema

The export bundles the output of all 12 API calls made by the game detail page into a single JSON object:

```typescript
interface SharedGameData {
  // Metadata
  version: 1;                                      // Schema version for forward compat
  created_at: string;                              // ISO 8601 timestamp
  app_version: string;                             // Per-Ankh version that created this

  // Game data (mirrors the 12 parallel API calls on the game detail page)
  game_details: GameDetails;                       // ~2 KB
  player_history: PlayerHistory[];                 // 40-80 KB
  yield_history: YieldHistory[];                   // 100-200 KB
  event_logs: EventLog[];                          // 50-150 KB
  law_adoption_history: LawAdoptionHistory[];      // 20-40 KB
  current_laws: PlayerLaw[];                       // 5-10 KB
  tech_discovery_history: TechDiscoveryHistory[];  // 20-40 KB
  completed_techs: PlayerTech[];                   // 15-30 KB
  units_produced: PlayerUnitProduced[];            // 5-10 KB
  city_statistics: CityStatistics;                 // 15-30 KB
  improvement_data: ImprovementData;               // 70-155 KB
  map_tiles: MapTile[];                            // 200-600 KB (final turn only)
}
```

All TypeScript types already exist in `src/lib/types/` (auto-generated from Rust via ts-rs). The web viewer reuses them unchanged.

### 4.2 Size Estimates

Estimates are for a typical game (~200 turns, 4-8 players):

| Component | Uncompressed | Notes |
|-----------|-------------|-------|
| game_details | 1-2 KB | Match metadata + player info |
| player_history | 40-80 KB | ~200 turns × 4-8 players × 3 metrics |
| yield_history | 100-200 KB | ~200 turns × 4-8 players × 10+ yield types |
| event_logs | 50-150 KB | Variable; string descriptions are bulky |
| law/tech history | 60-120 KB | Step functions, sparser than per-turn |
| units/cities/improvements | 90-185 KB | City count varies; improvements can be dense |
| map_tiles (final turn) | 200-600 KB | Map-size dependent; each tile has ~15 fields |
| **Total** | **~600 KB - 1.5 MB** | |
| **Gzipped** | **~100 - 300 KB** | JSON compresses ~80% (repetitive field names, forward-filled data) |

### 4.3 Share ID Format

Random URL-safe ID (nanoid-style, 21 chars, 64-char alphabet = ~126 bits of entropy). Sufficient to prevent brute-force enumeration.

```
Example: per-ankh.pages.dev/share/V1StGXR8_Z5jdHi6B-myT
```

## 5. Backend: Cloudflare R2 + Workers

### 5.1 How It Works

- Cloudflare Worker provides a small API: `POST /share` (upload) and `GET /share/{id}` (download)
- R2 bucket stores the gzipped JSON blobs
- Cloudflare Pages hosts the web viewer (SvelteKit static build)
- Worker code is ~100-200 lines of JS/TS, deployed via Wrangler CLI

### 5.2 Free Tier Limits

| Resource | Free Allowance | Per-Ankh Usage |
|----------|---------------|----------------|
| R2 storage | 10 GB/month | ~300 KB/game → **~33,000 games** |
| R2 writes (PUT) | 1M/month | 1 per share |
| R2 reads (GET) | 10M/month | 1 per view |
| Workers requests | 100K/day | Upload + download combined |
| Pages bandwidth | Unlimited | Static site hosting |
| Egress | Free (no bandwidth charges) | — |

### 5.3 Performance

- Upload latency: <500ms (Cloudflare edge network)
- Download latency: <100ms (served from nearest edge PoP)
- Compression: full control. Upload pre-gzipped data, set `Content-Encoding: gzip`. Browser decompresses transparently on download.

### 5.4 Secure Upload Without Embedded Secrets

A key design goal is that the desktop app binary contains **no secrets** — no API keys, no tokens, nothing that could be extracted by decompiling. The upload endpoint is "open" but protected by multiple layers.

#### Why No Secret Is Needed

The Worker URL (e.g., `https://share-api.per-ankh.workers.dev/share`) is public by design — the web viewer also fetches from it. There is no secret to protect. Instead, the Worker itself enforces safety through validation and rate limiting. This is the same model used by services like paste sites and image hosts: the upload endpoint is open, but abuse is controlled server-side.

#### Worker-Side Protections

The Cloudflare Worker acts as a gatekeeper. Before storing anything in R2, it validates:

1. **Content-Type check**: Reject requests that aren't `application/json` or `application/gzip`
2. **Payload size limit**: Reject payloads > 5 MB (typical share is ~300 KB gzipped)
3. **Schema validation**: Decompress and parse the JSON. Verify it has the expected top-level fields (`version`, `game_details`, `player_history`, etc.) and that `game_details` contains a valid `match_id`. Reject anything that doesn't match. This prevents the endpoint from being used as generic file storage.
4. **Rate limiting by IP**: Cloudflare Workers can read `CF-Connecting-IP`. Limit to ~10 uploads per hour per IP. Store rate limit counters in Workers KV (free tier: 100K reads/day) or use Cloudflare's built-in Rate Limiting rules.
5. **Request size via Cloudflare WAF**: Cloudflare's free tier includes basic WAF rules. A rule can reject requests over a certain size before they even reach the Worker.

#### Upload Flow (Desktop → Worker → R2)

```
Desktop App (Rust)                    Cloudflare Worker                   R2 Bucket
──────────────────                    ─────────────────                   ─────────

1. Serialize SharedGameData to JSON
2. Gzip compress
3. Generate share ID (nanoid)
4. POST to Worker endpoint
   Content-Type: application/gzip
   Body: gzipped JSON
         │
         ▼
                                 5. Check Content-Type
                                 6. Check payload size ≤ 5 MB
                                 7. Check IP rate limit
                                 8. Decompress, parse JSON
                                 9. Validate schema fields
                                10. If all pass:
                                    PUT to R2 with key = {id}.json.gz
                                    Set metadata: content-type, timestamp
                                                                    ──▶  11. Blob stored
                                12. Return { url, id } to client
         │
         ▼
5. Rust receives share URL
6. Returns URL to Svelte frontend
7. Frontend shows URL in modal
```

#### Why This Is Sufficient for MVP

- **Spam/abuse**: Rate limiting + size limits make bulk abuse impractical. Worst case, someone uploads garbage JSON that passes schema validation — this wastes R2 storage but at ~300 KB per upload and 10/hr rate limit, it would take years to exhaust the 10 GB free tier.
- **Data integrity**: Schema validation ensures only valid game data is stored. The web viewer won't crash on malformed data.
- **No privilege escalation**: The Worker can only write to R2 (no database, no user accounts). There is nothing to escalate to.
- **Enumeration**: Share IDs are 21-char nanoids (~126 bits entropy). Brute-forcing is infeasible even at millions of requests per second.

#### Future: Adding Authentication

If abuse becomes a problem or access control is needed, authentication can be layered on without changing the desktop app:

1. **App-level API key**: Generate a per-installation key on first launch, register it with the Worker. Worker rejects uploads without a valid key. The key is not a secret per se (it identifies the installation, not authorizes it), but it enables per-user rate limiting and ban lists.
2. **Challenge-response**: Worker issues a challenge (e.g., proof-of-work or CAPTCHA token) that the desktop app must solve before uploading. Prevents automated abuse without requiring user accounts.
3. **OAuth**: For gallery/public shares, users could authenticate with a GitHub or Discord account. The Worker validates the OAuth token and associates shares with an identity.

## 6. Desktop App Changes

### 6.1 New Rust Dependencies

Add to `src-tauri/Cargo.toml`:

```toml
reqwest = { version = "0.12", features = ["json", "gzip"] }  # HTTP client
flate2 = "1.0"    # gzip compression
```

Note: `reqwest` adds ~2-3 MB to binary size. Alternative: `ureq` is lighter (~500 KB) and blocking (simpler for a single upload). Either works; `reqwest` is more widely used.

### 6.2 New Rust Structs and Command

New struct in `src-tauri/src/types.rs`:

```rust
#[derive(Serialize)]
pub struct SharedGameData {
    pub version: u32,
    pub created_at: String,
    pub app_version: String,
    pub game_details: GameDetails,
    pub player_history: Vec<PlayerHistory>,
    pub yield_history: Vec<YieldHistory>,
    pub event_logs: Vec<EventLog>,
    pub law_adoption_history: Vec<LawAdoptionHistory>,
    pub current_laws: Vec<PlayerLaw>,
    pub tech_discovery_history: Vec<TechDiscoveryHistory>,
    pub completed_techs: Vec<PlayerTech>,
    pub units_produced: Vec<PlayerUnitProduced>,
    pub city_statistics: CityStatistics,
    pub improvement_data: ImprovementData,
    pub map_tiles: Vec<MapTile>,
}
```

This struct does NOT need `#[derive(TS)]` since it's not exposed to the desktop frontend — it's only serialized to JSON for upload.

New command in `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
async fn share_game(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<String, String> {
    // 1. Query all 12 data endpoints (reuse existing query functions)
    // 2. Assemble into SharedGameData
    // 3. Serialize to JSON, gzip compress
    // 4. HTTP POST to Cloudflare Worker
    // 5. Return share URL string
}
```

The command reuses existing query functions in `src-tauri/src/db/queries/` — no new database queries needed.

### 6.3 CSP

No CSP changes needed. The HTTP upload happens in Rust (not from the webview), bypassing the webview's CSP entirely.

### 6.4 Frontend Changes

New method in `src/lib/api.ts`:

```typescript
shareGame: (matchId: number) => invoke<string>("share_game", { matchId }),
```

In `src/routes/game/[id]/+page.svelte`:

- Add a share button in the game header area (near the game title)
- Add a small modal showing: spinner during upload, URL + copy button on success, error on failure
- Estimated: ~50-80 lines in the page + ~60-line modal component

## 7. Web Viewer App

### 7.1 Code Reuse Inventory

**Reused directly (zero changes):**

| Category | Files |
|----------|-------|
| Types | `src/lib/types/*.ts` (all 35 files) |
| Config | `src/lib/config/charts.ts`, `nations.ts`, `terrain.ts`, `index.ts` |
| Utils | `src/lib/utils/formatting.ts` |
| Charts | `Chart.svelte`, `ChartContainer.svelte`, `ChartSeriesFilter.svelte` |
| Map | `HexMap.svelte` |
| UI | `SearchInput.svelte`, `GamePageSkeleton.svelte` |
| Styles | `app.css`, `tailwind.config.js` |

**Replaced with web-specific versions:**

| Desktop File | Web Replacement | Reason |
|-------------|----------------|--------|
| `src/lib/api.ts` | `api-web.ts` | `fetch()` instead of `invoke()` |
| `src/lib/utils/dialogs.ts` | Remove or no-op | No native dialogs in browser |
| `src/routes/+layout.svelte` | Simplified layout | No Header, Sidebar, modals |
| `src/routes/game/[id]/+page.svelte` | `share/[id]/+page.svelte` | Same rendering, different data source |

**Removed entirely:**

- Header.svelte (menu, import, navigation)
- GameSidebar.svelte (game list)
- ImportModal.svelte, SettingsModal.svelte, CollectionsModal.svelte
- UpdateModal.svelte, UpdateNotification.svelte
- `src/lib/utils/updater.ts`

### 7.2 The Key Substitution: `api-web.ts`

The web viewer fetches the entire shared JSON blob once, then serves slices of it to the rendering code:

```typescript
let cachedData: SharedGameData | null = null;

async function getSharedData(shareId: string): Promise<SharedGameData> {
  if (cachedData) return cachedData;
  const res = await fetch(`https://share-api.per-ankh.pages.dev/${shareId}`);
  cachedData = await res.json();  // Browser handles gzip decompression
  return cachedData;
}

export const api = {
  getGameDetails: async (shareId: string) => {
    const data = await getSharedData(shareId);
    return data.game_details;
  },
  getPlayerHistory: async (shareId: string) => {
    const data = await getSharedData(shareId);
    return data.player_history;
  },
  // ... etc for all 12 endpoints
};
```

This means the game detail page template needs minimal changes: replace `api.getXxx(matchId)` calls with `api.getXxx(shareId)`, and the rest of the rendering code (3000+ lines of chart configs, tables, filtering) works identically.

### 7.3 Project Structure

For MVP, a `web/` directory at the repo root containing a standalone SvelteKit project. Shared files can be symlinked or copied during build:

```
per-ankh/
  src/                          # Desktop app (unchanged)
  src-tauri/                    # Rust backend (minor additions)
  web/                          # Web viewer (new)
    src/
      lib/
        api-web.ts              # Fetch-based API layer
        types/ → ../../src/lib/types/     # Symlink to shared types
        config/ → ../../src/lib/config/   # Symlink to shared config
        utils/formatting.ts → ...         # Symlink to shared utils
        Chart.svelte → ...                # Symlink to shared components
        ChartContainer.svelte → ...
        ChartSeriesFilter.svelte → ...
        HexMap.svelte → ...
        SearchInput.svelte → ...
        GamePageSkeleton.svelte → ...
      routes/
        +layout.svelte          # Minimal layout (no sidebar, no header)
        share/[id]/+page.svelte # Adapted game detail page
      app.html
      app.css → ../../src/app.css
    svelte.config.js            # adapter-static for Cloudflare Pages
    package.json
    tailwind.config.js
```

An alternative to symlinks is a monorepo with shared packages (pnpm workspaces, turborepo), but that adds complexity better deferred until the web viewer is proven out.

### 7.4 Build and Deploy

The web viewer deploys to Cloudflare Pages (free tier: unlimited bandwidth, 500 deploys/month):

```bash
cd web/
npm run build       # SvelteKit adapter-static → web/build/
npx wrangler pages deploy build --project-name=per-ankh
```

Or configure Cloudflare Pages to auto-deploy from the `web/` directory on push to main.

**Domain:** `per-ankh.pages.dev` (free) or a custom domain via Cloudflare DNS.

### 7.5 What the Web Viewer Does NOT Include

- No game list sidebar or navigation between games
- No import functionality
- No database
- No settings, collections, or update system
- No historical map turn slider (MVP: final turn only)

The web viewer renders a single shared game. One URL = one game.

## 8. Access Control (Future)

### 8.1 Visibility Levels

Three levels:

1. **Public** — listed in gallery, indexed, anyone can view
2. **Unlisted** — accessible via direct URL only, not in gallery
3. **Private** — requires authentication to view

### 8.2 Implementation

- Store visibility as R2 object custom metadata (`x-visibility: public|unlisted|private`)
- Worker gallery endpoint only returns objects marked `public`
- Worker download endpoint checks visibility and enforces auth for `private`
- For private shares: signed URLs with expiration, or viewer login via OAuth
- Cloudflare D1 (serverless SQLite) can store a gallery index with filtering

### 8.3 MVP Decision

MVP uses unlisted only. No access control, no gallery. The 126-bit entropy share ID provides sufficient security-through-obscurity for unlisted links.

## 9. Discoverability / Public Gallery (Future)

A gallery page at `per-ankh.pages.dev/gallery` could show:

- Recently shared public games
- Filters: nation, player count, game length, victory type, difficulty
- Sort: date, popularity (view count)
- Thumbnail: minimap image (generated client-side from map data)

**Technical requirements:**

- An index database (Cloudflare D1 or KV) storing metadata for each public share
- Gallery API endpoint on the Worker
- Gallery page in the web viewer
- Opt-in: users explicitly choose "Share to Gallery" vs "Share Link Only"
- View count tracking (Worker increments on each GET)

**Relationship to access control:** Discoverability requires a public/unlisted distinction. Users who share to the gallery are opting into public visibility. This is the primary motivation for adding access control.

## 10. Map Data Strategy

### 10.1 MVP: Final Turn Only

Include the output of `getMapTiles(matchId)` — the final-turn map state. Size: 200-600 KB per game.

The web viewer renders this using the existing `HexMap.svelte` component. The historical turn slider is hidden since the shared data only includes final-turn tiles.

### 10.2 Future: All-Turn History

Including ownership history for every turn would enable the historical map slider in the web viewer.

**Naive approach:** Store full tile arrays for every turn. For a 200-turn game with 8,000 tiles, this is 1.6M records — potentially tens of megabytes. Too large.

**Delta approach:** Store the final-turn tiles plus a compact change log:

```typescript
interface SharedGameData {
  // ... existing fields ...
  map_tiles: MapTile[];                      // Final turn state (base)
  map_ownership_changes?: OwnershipChange[]; // Delta log for historical playback
}

interface OwnershipChange {
  x: number;
  y: number;
  turn: number;
  owner_nation: string | null;
}
```

The web viewer reconstructs any historical turn by starting from the final state and reversing changes. This keeps the shared blob compact (estimated 50-200 KB additional for the change log, compresses well) while enabling full historical playback.

## 11. MVP Scope

### In Scope

1. Cloudflare infrastructure: R2 bucket + Worker (upload/download API)
2. Rust `share_game` command: queries all data, assembles JSON, gzips, uploads
3. Desktop UI: share button on game detail page, modal with URL/copy/error states
4. Web viewer: SvelteKit static site on Cloudflare Pages, single route (`/share/[id]`)
5. Web viewer renders all 9 tabs with the same charts, tables, and map
6. `api-web.ts`: fetch single blob, serve slices to existing rendering code
7. Final-turn map only (no historical turn slider)
8. All shares are unlisted (URL-only access, no gallery)
9. Player names shared openly

### Out of Scope (Future)

- Access control (public/private/unlisted toggle)
- Public gallery with search/filter
- Historical map turn slider in web viewer
- Delete/expire shared games
- Comments or reactions
- Embedding in iframes
- Rate limiting beyond Cloudflare's built-in protections
- Share analytics (view counts)

### Implementation Order

1. Cloudflare infrastructure (R2 bucket + Worker) — blocks everything else
2. Rust `share_game` command + HTTP dependencies
3. Desktop UI (share button + modal)
4. Web viewer project scaffold (SvelteKit + shared code)
5. Web viewer game detail page (port/adapt from desktop)
6. Deploy web viewer to Cloudflare Pages
7. End-to-end testing

## 12. Security Considerations

### What Data is Exposed

A shared game contains: player names (in-game display names), game settings (difficulty, map type, mods, DLC), full gameplay history (points, yields, events, laws, techs, cities, improvements), and final-turn map state. This is equivalent to what any player can see in the in-game replay. No personally identifiable information beyond display names.

### No Authentication on MVP

- **Uploads:** The Worker accepts any well-formed request. Rate limiting is handled by Cloudflare's built-in DDoS protection plus a simple size limit.
- **Downloads:** Anyone with the URL can view. The 126-bit share ID entropy makes brute-force enumeration infeasible.
- **No embedded secrets:** The Worker endpoint URL is public (the web viewer also fetches from it). No API keys in the desktop app binary.

### Abuse Prevention (Worker-Level)

Even without auth, the Worker should enforce:

- **Max payload size:** 5 MB (well above the ~300 KB typical; catches abuse)
- **Rate limit by IP:** 10 uploads per minute per IP (via `CF-Connecting-IP` header)
- **Content validation:** Parse the JSON and verify it matches the expected schema before storing
- **No executable content:** The blob is JSON data, not HTML/JS, so XSS via stored content is not possible as long as the web viewer treats it as data (never `innerHTML`)

### Share Immutability

Once uploaded, a share cannot be modified or deleted in MVP. This simplifies the security model — no ownership tracking needed. If deletion is needed later, it can be added with a signed delete token returned at upload time.

### Desktop App HTTP Client

The Rust backend makes the HTTP upload, not the webview. This means:

- No CORS concerns (not a browser-to-server request)
- No CSP changes needed in `tauri.conf.json`
- No secrets in the frontend JavaScript
