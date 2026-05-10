# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working with this repository.

## Project Overview

Per-Ankh is a web app at <https://per-ankh.app> for analyzing Old World save files. Saves are parsed in the browser, persisted to Cloudflare, and visualized through interactive charts and a hex-tile map.

## Technology Stack

- **Frontend:** SvelteKit 2 + Svelte 5 + TypeScript, deployed via `@sveltejs/adapter-cloudflare`. Source under `src/`.
- **API Worker:** Cloudflare Worker under `cloud/` (TypeScript, Valibot for validation, nanoid for IDs).
- **Backing services:** D1 (relational metadata), R2 (raw save ZIPs + parsed game blobs), KV (sessions).
- **Parser:** TypeScript, running in a Web Worker on the upload page. Source under `src/lib/parser/`.
- **Charts:** Apache ECharts.
- **Legacy share viewer:** static SvelteKit app under `web/`, serving `per-ankh.app/share/[id]` for share links created by the (now-removed) desktop app. Frozen.

## Repo layout

```
per-ankh/
├── src/                      # SvelteKit app (cloud routes + shared components)
│   ├── lib/                  # Components, stores, parser, api-cloud client
│   ├── routes/               # /, /login, /auth/callback, /dashboard, /upload,
│   │                         #   /games, /games/[id], /account
│   └── hooks.server.ts       # SSR security headers
├── cloud/                    # Cloudflare Worker (API)
│   ├── src/                  # Handlers, validation, util
│   ├── migrations/           # D1 migrations (numbered, forward-only)
│   └── wrangler.toml         # Worker config
├── web/                      # Legacy share viewer (static SvelteKit, frozen)
├── scripts/                  # Asset bake scripts + ./per-ankh CLI (incl. admin/)
├── static/                   # Static assets, including baked atlases/sprites
└── docs/                     # Spec, productionization plan, ADRs
```

## Environment

This is a web app deployed to Cloudflare. There is no desktop runtime, no DuckDB, no Rust. Assume browser semantics for the frontend and Cloudflare Worker semantics for the API.

The `./per-ankh` script at repo root spawns SvelteKit dev (port 1420) and Wrangler dev (port 8787) together. See `scripts/per-ankh.ts`.

## Coding Standards

### TypeScript / Svelte

- Use TypeScript with strict mode.
- ESLint + Prettier enforced (`npm run lint`, `npm run format`).
- Naming: camelCase for functions/variables, PascalCase for components.
- Prefer `const` over `let`.
- When displaying XML/backend enum values in UI, use `formatEnum()` from `$lib/utils/formatting`.

### Svelte 5 (runes)

This project uses Svelte 5 runes throughout. Don't mix Svelte 4 patterns — they compile but cause silent rendering failures.

```typescript
// Reactive state
let count = $state(0);
let doubled = $derived(count * 2);

// Props
let { name, age = 0 }: { name: string; age?: number } = $props();

// Effects
$effect(() => {
	console.log("count changed:", count);
});
```

**Effect dependency tracking.** `$effect` only tracks values it actually reads at runtime. Read reactive values unconditionally if you want them tracked even when an early-return branch is taken:

```typescript
// Tracked correctly — both `chart` and `option` read every run
$effect(() => {
	const currentOption = option;
	if (chart && currentOption) chart.setOption(currentOption);
});

// Bug: `option` is only read when `chart` is truthy. If chart is initially
// null, `option` is never tracked, so updates to it don't trigger reruns.
$effect(() => {
	if (chart) chart.setOption(option);
});
```

**Stores with runes.** Convert store values to `$state` and subscribe inside an effect rather than subscribing at module top-level (which breaks component initialization):

```typescript
import { myStore } from "./stores";

let storeValue = $state(0);
$effect(() => {
	const unsubscribe = myStore.subscribe((v) => {
		storeValue = v;
	});
	return unsubscribe;
});
```

### Frontend: Null/Undefined Handling

Use different operators based on context to prevent bugs from falsy coercion.

**Domain/data layer (strict):** use `??` for null/undefined; use `!= null` when `0` or `""` are valid; **never** use `||` for data computation.

```typescript
const chartData = playerData.map((p) => p.points ?? 0);
const filteredGames = games.filter((g) => g.turn_number != null);
```

**UI rendering (pragmatic):** `||` is fine for display fallbacks where falsy values should show the fallback.

```typescript
<h1>{game.name || "Unknown Game"}</h1>
<span>{score != null ? score : "N/A"}</span>
```

### Frontend: Enum Formatting

Use `formatEnum()` from `$lib/utils/formatting` for consistent formatting of backend enum values (handles `NATION_*`, `RELIGION_*`, `MAPSIZE_*`, `LEVEL_*` prefix removal, title casing, multi-word, null safety).

```typescript
import { formatEnum } from "$lib/utils/formatting";
const nationName = formatEnum(game.nation, "NATION_");
```

### Frontend: Color Usage

**UI colors** — use Tailwind classes / CSS variables; don't hardcode hex.

```svelte
<div class="bg-brown text-tan border-black">
```

**Chart colors** — use the centralized constants:

```typescript
import { CHART_COLORS, CHART_THEME, getChartColor } from "$lib/config";

const chartOption: EChartsOption = {
	...CHART_THEME,
	series: data.map((d, i) => ({
		...d,
		itemStyle: { color: getChartColor(i) },
	})),
};
```

**Nation/civilization colors** — use the helpers:

```typescript
import { getNationColor, getCivilizationColor } from "$lib/config";
const color = getCivilizationColor(player.nation) ?? getChartColor(i);
```

Reference: `docs/reference/color-scheme.md`.

### Frontend: API Layer

All Worker calls go through `src/lib/api-cloud.ts` (`cloudApi`). It's a thin fetch wrapper that handles auth, JSON parsing, and typed error classes (e.g. `UnauthorizedError`).

```typescript
import { cloudApi } from "$lib/api-cloud";
const games = await cloudApi.listGames();
```

Adding new endpoints: extend the `cloudApi` object in `api-cloud.ts`. Keep request/response types adjacent to the function for now; split into per-domain modules once the file outgrows it.

## Cloud Worker

Lives under `cloud/`. Handlers in `cloud/src/`, validation via Valibot in `cloud/src/schemas/` and `cloud/src/validation.ts`. Routing is hand-rolled (URL pattern matching) — no router library.

### D1 migrations

- `cloud/migrations/` is numbered (`0001_*.sql`, `0002_*.sql`, …) and forward-only. There is no `down`.
- Apply locally: `(cd cloud && npm run migrate:local)`.
- Apply remote: `(cd cloud && npm run migrate:remote)`.
- Always rehearse a new migration on a throwaway D1 before running it on production.

### Cloud Admin CLI

`./per-ankh admin` is the operator CLI for the live app — covers both the cloud-rewrite world (users, games, events) and the frozen legacy share world. Implementation lives under `scripts/admin/`. Calls `wrangler` directly (no API key — relies on `wrangler login`). Run `./per-ankh admin --help` for the full list. Common usage:

```bash
./per-ankh admin stats                       # Global counts + recent activity
./per-ankh admin users [--sort recent|uploads|created]
./per-ankh admin user <user_id>              # Detail (games, collections, online_ids)
./per-ankh admin games [--limit N] [--user U]
./per-ankh admin events [--type T] [--user U]
./per-ankh admin shares list [--limit N]     # Legacy shares
./per-ankh admin block-key <key> [reason]
./per-ankh admin nuke-key <key>              # Block + delete all legacy shares (type "nuke")
./per-ankh admin nuke-user <user_id>         # Delete cloud user + games + R2 blobs (type "nuke")
```

Add `--json` to any read command for pipeable output; add `--yes` to skip confirmation on destructive ops.

## Asset Bake Pipeline

The sprite map's terrain, hex, resource, and improvement atlases are baked from a local [pinacotheca](https://github.com/becked/pinacotheca) checkout. Both source PNGs (`assets/atlas-sources/`) and outputs (`static/atlases/`, `static/sprites/`) are gitignored — bake locally on demand.

```bash
npm run bake:terrain-3d   # Terrain atlas (terrain-3d.{webp,json})
npm run bake:improvements # Improvements (base + per-family urban atlases) + nation-asset-aliases.json
npm run bake:resources    # Resource icons
npm run bake:sprites      # Misc sprites (crests, techs, units, laws, religions, yields, icons)
npm run bake:finalize     # Emits committed manifest TS modules + reconciles orphans
npm run bake:all          # Run them all in order
```

Shared cell geometry / hex masking lives in `scripts/lib/atlas-bake.ts`. Constants `CELL_W=211`, `CELL_H=167`, `HEX_H_SPACING=199`, `HEX_V_SPACING=122` are mirrored in `src/lib/SpriteMap.svelte` — keep both sites in sync if either changes.

### Content-hashed paths

Every baked output (atlas `.webp`/`.json` pair, every sprite PNG, `nation-asset-aliases.json`) is content-hashed. The filename embeds the first 8 hex chars of `sha256(outputBytes)` (e.g. `static/atlases/terrain-3d.a1b2c3d4.webp`). Direct unhashed URLs no longer resolve — `curl http://localhost:1420/atlases/terrain-3d.webp` returns 404.

Resolve URLs at runtime via the generated manifests:

- `ATLAS_MANIFEST` and `NATION_ALIASES_URL` from `$lib/generated/atlas-manifest`
- `SPRITE_MANIFEST` from `$lib/generated/sprite-manifest`

Both modules are committed to git and regenerated by `npm run bake:finalize` (which also runs reconcile and asserts every referenced file exists). The intermediate JSON sidecars live at `.bake/{atlas,sprite}-manifest.json` (gitignored). Hand-editing the generated TS modules will fail the existence check on the next bake; add a new asset by re-running the appropriate baker.

Hashed paths get `Cache-Control: immutable, max-age=1y` via `_headers` at the repo root (and mirrored in `web/static/_headers` for the legacy share viewer).

### Re-bake when

- Pinacotheca ships refreshed renders.
- `Reference/XML/` is refreshed against a current Old World install (picks up new DLC `zType`s and nation aliases).

`zType`s present in saves but absent from `Reference/XML/` silently won't render until Reference is updated. The bake logs any `zType → zIconName` whose target is missing and falls those `zType`s back to a generic city sprite.

Visually inspect `Map` tab in the dev server after re-baking. Bakes are deterministic: re-running with no source changes should produce byte-identical generated TS modules (`git diff src/lib/generated/` shows nothing).

## Game Detail View (shared with legacy `web/`)

The `/games/[id]` page is built from `src/lib/game-detail/`. The legacy share viewer at `web/src/routes/share/[id]/` symlinks back into `src/lib/` (specifically `game-detail/`, `types/`, `config/`, `generated/`, plus several top-level shared components like `SpriteMap`, `Chart`, `MapTooltip`).

This means UI-only changes propagate to the legacy share viewer automatically when `web/` redeploys.

**Adding a yield chart:** add one entry to `YIELD_CHART_CONFIG` in `src/lib/game-detail/helpers.ts`. Also add the new key to `ChartFilterKey` and `PLAYER_CHART_KEYS` in the same file.

**Adding a tab:** create `FooTab.svelte` in `src/lib/game-detail/`, then add a `Tabs.Trigger` and `Tabs.Content` in `GameDetailView.svelte`.

**Changes that need new backend data:**

UI-only changes work without touching the backend. But if a new chart/tab needs data not in the existing share blob, you must update both:

1. The cloud Worker (`cloud/src/`) — add the field to the share blob shape and to validation schemas.
2. The web/ viewer's `webApi` if the new field needs to be sliced from the cached blob.

Deploy the Worker schema change before releasing the frontend that depends on it.

## Game / User Identity Notes

- Each game records the uploader's nation (`user_nation`) and win flag (`user_won`) at upload time. Re-uploads from a different perspective produce a new game record.
- Upload supports an "observer" mode (`uploaderIndex === null`) for tournament admins archiving matches or users uploading a friend's save. Server records nation and won as NULL, no `is_uploader=TRUE` rows, no online_id captured.
- Multiplayer games store `online_id` (Steam/GOG/Epic) for each human player; PII (`online_id`, `discord_id`, `username` outside the player roster) is stripped from share blobs and never logged.

## Development Principles

- **YAGNI.** Implement what's needed now, not what might be useful later.
- **DRY.** Reuse existing patterns; extract shared logic.
- **Atomic commits.** One logical change per commit.
- **Comments explain WHY.** The code shows WHAT. Document edge cases, business rules, non-obvious decisions.

## Commit Messages

Conventional commits:

- `feat:` new features
- `fix:` bug fixes
- `docs:` documentation
- `test:` tests
- `refactor:` code changes that don't add features or fix bugs
- `perf:` performance
- `chore:` maintenance

Do **not** include the following lines in commit messages:

- `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- `Co-Authored-By: Claude <noreply@anthropic.com>`
