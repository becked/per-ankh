# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working with this repository.

## Project Overview

Per-Ankh is a web app at <https://per-ankh.app> for analyzing Old World save files. Saves are parsed in the browser, persisted to Cloudflare, and visualized through interactive charts and a hex-tile map.

The app also hosts **tournaments** — a Swiss-into-championship competition system (slots, rounds, matches, standings) layered on top of the save-analysis core. It is the largest and most actively developed subsystem; see [Tournament subsystem](#tournament-subsystem).

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
│   ├── lib/                  # parser/, game-detail/, tournament/, stats/, users/,
│   │                         #   ui/, config/, stores/, generated/, api-cloud client
│   ├── routes/               # /, /auth/callback, /dashboard, /upload, /games/[id],
│   │                         #   /account, /admin (+/reparse), /tournaments
│   │                         #   (+/[slug], /guide), /users/[user_id] (+/stats)
│   └── hooks.server.ts       # SSR security headers
├── cloud/                    # Cloudflare Worker (API)
│   ├── src/                  # Domain handlers (games, users, auth, admin, …) +
│   │                         #   tournament/, stats/, routes/, schemas/, lib/
│   ├── test/                 # Vitest: unit/ (Node) + integration/ (Miniflare)
│   ├── migrations/           # D1 migrations (numbered, forward-only)
│   └── wrangler.toml         # Worker config
├── web/                      # Legacy share viewer (static SvelteKit, frozen)
├── scripts/                  # Asset bake scripts + ./per-ankh CLI (admin/, prod/, backup)
├── static/                   # Static assets, including baked atlases/sprites
└── docs/                     # Specs, ADRs, deploy plan (see Key docs below)
```

## Environment

This is a web app deployed to Cloudflare. There is no desktop runtime, no DuckDB, no Rust. Assume browser semantics for the frontend and Cloudflare Worker semantics for the API.

The `./per-ankh` script at repo root is the project CLI (`scripts/per-ankh.ts`). It has five top-level subcommands:

- `./per-ankh dev` — spawns SvelteKit dev (port 1420) and Wrangler dev (port 8787) together.
- `./per-ankh admin` — operator CLI for the live app (see [Cloud Admin CLI](#cloud-admin-cli)).
- `./per-ankh prod` — deploy runbook automation (see [Deploy CLI](#deploy-cli)).
- `./per-ankh staging` — same deploy automation targeting the staging environment (see [Deploy CLI](#deploy-cli)).
- `./per-ankh backup [--local]` — snapshots D1 to portable `.sql` + `.sqlite` artifacts under `backups/`. **Defaults to remote/production D1** (operator-run, wrangler/1Password-gated); `--local` exports dev `.wrangler` state. The default remote path is covered by the prod-command rule in [Deploy CLI](#deploy-cli).

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

### Worker tests

`cloud/` has a two-project Vitest setup (`cloud/vitest.config.mts`):

- **unit** — pure-function `*.test.ts` beside source, on the default Node pool (~ms per test).
- **integration** — handler tests inside a Miniflare Worker isolate with real D1/KV/R2 bindings (`@cloudflare/vitest-pool-workers`). Migrations are applied per-file in `beforeAll`. Lives under `cloud/test/integration/` (mostly tournament: flow, round generation, championship transition, signup, beta-gate, rate-limit, audit-log). Request helpers in `cloud/test/helpers/` (`requests.ts` wraps `SELF.fetch` with auth conventions; `builders.ts` seeds users/tournaments).

Run from `cloud/`: `npm test` (both projects), or filter with `--project unit` / `--project integration`. `npm run test:watch` for watch mode.

### D1 migrations

- `cloud/migrations/` is numbered (`0001_*.sql`, `0002_*.sql`, …) and forward-only. There is no `down`.
- Apply locally: `(cd cloud && npm run migrate:local)`.
- Apply to staging: `(cd cloud && npm run migrate:staging)`.
- Apply remote: `(cd cloud && npm run migrate:remote)`.
- Always rehearse a new migration on staging (or a `./per-ankh staging deploy`, which applies pending migrations itself) before running it on production.

### Investigating tournament data locally

Dev tournament data lives in the local D1 (`.wrangler/state`). A tournament URL is `/tournaments/<slug>` — the path segment is the `slug`, not `tournament_id`. Query it read-only (local only — `--remote` is prod and gated, see Admin/Deploy CLI notes):

To test account-specific behavior (slot claims, account switching, re-login) without a Discord round-trip, use the local Discord-free login bypass — see `docs/dev-login.md`.

```bash
DB="per-ankh-share-index"
# slug → tournament_id + map_pool
npx wrangler d1 execute $DB --local --command \
  "SELECT tournament_id, slug, status, map_pool FROM tournaments WHERE slug='<slug>';"
# matches by round, with maps and outcomes
npx wrangler d1 execute $DB --local --command \
  "SELECT r.round_number, r.division, m.match_index, m.slot_a_id, m.slot_b_id,
          m.map_pool_id, m.map_script, m.status, m.winner_slot_id
   FROM tournament_matches m JOIN tournament_rounds r ON m.round_id=r.round_id
   WHERE r.tournament_id='<id>' ORDER BY r.division, r.round_number, m.match_index;"
# slot_id → player
npx wrangler d1 execute $DB --local --command \
  "SELECT slot_id, division, swiss_seed, discord_username FROM tournament_slots
   WHERE tournament_id='<id>' AND phase='swiss' ORDER BY division, swiss_seed;"
```

Shape: `tournaments` (1) → `tournament_rounds` → `tournament_matches`; matches reference `tournament_slots` by id; `map_pool` is JSON on the tournament. Most `./per-ankh admin` subcommands target **remote/prod** and stay gated — use these `--local` queries for read-only dev investigation. The exceptions are `admin tournament seed` and `admin dev-login`, which are hard-gated local-only (require `--local`) and exist specifically for dev; see [Tournament subsystem](#tournament-subsystem).

### Bumping `PARSER_VERSION`

When you bump `PARSER_VERSION` in `src/lib/parser/types.ts`, also add the new string to `KNOWN_PARSER_VERSIONS` in `cloud/src/schemas/game.ts` with a one-line changelog entry above the set. The Worker rejects unknown versions with `INVALID_BLOB: Unknown parser_version`, so a frontend that ships ahead of the Worker breaks all uploads. Deploy ordering: Worker first, frontend second.

### Cloud Admin CLI

`./per-ankh admin` is the operator CLI for the live app — covers both the cloud-rewrite world (users, games, events) and the frozen legacy share world. Implementation lives under `scripts/admin/`. Calls `wrangler` directly (no API key — relies on `wrangler login`). Run `./per-ankh admin --help` for the full list. Common usage:

The list below is illustrative, not exhaustive — `./per-ankh admin --help` groups the full surface (Stats, Users, Games, Events, Shares, Security, Tournaments, Dev).

```bash
./per-ankh admin stats                       # Global counts + recent activity
./per-ankh admin users [--limit N] [--sort recent|uploads|created]
./per-ankh admin user <user_id>              # Detail (games, collections, online_ids)
./per-ankh admin games [--limit N] [--user U]
./per-ankh admin events [--type T] [--user U]
./per-ankh admin shares list [--limit N]     # Legacy shares
./per-ankh admin block-key <key> [reason]
./per-ankh admin nuke-key <key>              # Block + delete all legacy shares (type "nuke")
./per-ankh admin nuke-user <user_id>         # Delete cloud user + games + R2 blobs (type "nuke")
```

**Tournaments** — `./per-ankh admin tournament <sub>` (create, list, show, delete, grant-admin, revoke-admin, seed, beta-grant, beta-revoke, beta-list):

```bash
./per-ankh admin tournament beta-grant <discord_id>   # Add to private-beta allowlist (CLI-only)
./per-ankh admin tournament beta-list                 # Show the beta allowlist
./per-ankh admin --local tournament seed <slug> [name] # Build a full local fixture (see Tournament subsystem)
```

**Dev** — `./per-ankh admin --local dev-login [--username NAME]` provisions a fake local user + 30-day session cookie (and beta-grants them) for testing a second account. Both `tournament seed` and `dev-login` are **local-only** and refuse to run against remote.

Add `--json` to any read command for pipeable output; add `--yes` to skip confirmation on destructive ops. `--local` targets the local `.wrangler` state; `--staging` targets the staging D1/R2 (remote, mutually exclusive with `--local`); the default is production. The dev-only commands (`dev-login`, `tournament seed`) refuse both remote targets, staging included.

### Deploy CLI

`./per-ankh prod` automates the deploy runbook (`docs/cloud-deploy-plan.md` §4). Implementation under `scripts/prod/`. Subcommands:

```bash
./per-ankh prod preflight   # All safety checks (git, lint, check, format, audit, secret leak scan,
                            #   [vars] vs secrets hygiene, required-secret presence, pending migrations)
./per-ankh prod deploy      # preflight → changelog → migrate → worker → frontend → smoke (with confirm)
./per-ankh prod migrate     # Apply pending D1 migrations (with confirm + preview)
./per-ankh prod smoke       # GET probes against per-ankh.app, api.per-ankh.app/v1/auth/me, legacy
./per-ankh prod status      # Local git, deployed worker versions, secrets, pending migrations
./per-ankh prod changelog   # Preview the next changelog entry; --write to persist + tag
```

Flags: `--dry-run`, `--yes`, `--allow-dirty`, `--allow-branch`, `--skip-checks`, `--skip-worker`, `--skip-frontend`, `--skip-smoke`, `--skip-changelog`, `--edit-changelog`, `--json`. Preflight blocks on uncommitted changes, off-main, behind origin, secret leaks, `[vars]` keys with secret-shaped names, prod/staging wrangler-config drift (vars key sets + binding names — wrangler doesn't inherit either into `[env.staging]`), missing required secrets on the target Worker env, format/lint/typecheck/audit failures. Functional smoke (OAuth flow, upload, share visibility) stays manual — see deploy plan §5.

**Staging** — `./per-ankh staging <sub>` runs the same pipeline against the staging environment (`staging.per-ankh.app` + `api-staging.per-ankh.app`, separate D1/KV/R2, separate Discord app — see `docs/cloud-deploy-plan.md` §9 for one-time provisioning). Same subcommands and flags minus `changelog`: staging deploys never write `CHANGELOG.md`, bump the version, or tag. Preflight blocks on the same checks as prod — staging is a staging environment, not a dev playground. `staging.per-ankh.app` sits behind Cloudflare Access; the smoke frontend probe authenticates with the Access service token from the gitignored `.staging.vars` at repo root (`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`), and degrades to asserting the Access login redirect (with a warning) when the file is absent. The session cookie name is per-environment (`SESSION_COOKIE_NAME` var: `session` prod, `session_staging` staging) because both share `Domain=per-ankh.app` — see `cloud/src/session.ts`.

### Changelog & deploy stamps

Each `prod deploy` generates a new entry in `CHANGELOG.md` from the conventional-commit log since the last `deploy/*` tag, groups it by `feat`/`fix`/`perf`/other, bumps `package.json` `version` to a calver stamp (`YYYY-MM-DD-<shortsha>`), commits as `chore(release): deploy <stamp>`, and tags `deploy/<stamp>`. The deploy script does **not** push to GitHub — the next deploy finds the previous `deploy/*` tag locally via `git describe`, so pushing is optional bookkeeping (handy for a GitHub-visible deploy history, but not load-bearing). Use `--edit-changelog` to open `$EDITOR` on the file before the commit lands, `--skip-changelog` to bypass entirely, or run `./per-ankh prod changelog` standalone to preview without writing. If there are no new commits since the last deploy tag, the changelog step skips silently.

**Never run a prod- or staging-targeting command without a specific ask from the user.** Claude never deploys anywhere unprompted. This covers every `./per-ankh prod <sub>` and `./per-ankh staging <sub>` subcommand (including read-only ones like `preflight`, `status`, and `smoke`), `./per-ankh admin --staging`, and any direct `wrangler` / `npx wrangler` call against a live worker, D1, R2, or KV. These commands authenticate against the user's Cloudflare account — on this machine that triggers a 1Password prompt — and can hit live resources even when nominally read-only. If something appears to need prod or staging state, ask first.

## Tournament subsystem

A Swiss-into-championship competition system layered on the save-analysis core. The largest, most active area of the repo.

**Lifecycle.** A tournament moves through a status machine: `setup → swiss → championship → complete`. Most config (slots, maps) can only change in `setup`; later phases lock it.

**Data model.** `tournaments` (1) → `tournament_rounds` → `tournament_matches`; matches reference `tournament_slots` by id. Supporting tables: `tournament_admins` (per-tournament admin grants — a UI creator auto-becomes admin of their own tournament), `tournament_signups`, `tournament_beta_users` (the private-beta allowlist). `map_pool` is JSON on the tournament. Migrations `0006`–`0025` are largely tournament-specific.

**Code map.**

- Frontend: `src/lib/tournament/` (bracket/standings/match UI) + routes `src/routes/tournaments/` (`/[slug]`, `/guide`).
- Worker: `cloud/src/tournament/` — `admin.ts` (mutations), `public.ts` (reads), `player.ts`, and the engine: `seed.ts`, `pairing.ts`, `standings.ts`, `bracket.ts`, `export.ts`, `authz.ts`.

**Access control (beta gate).** Every tournament endpoint is gated behind the `tournament_beta_users` allowlist. Non-members get **404, not 403** (`cloud/src/tournament/authz.ts`) — deliberate, so the feature's existence stays hidden; this is why tournament endpoints "404 unexpectedly" in local dev. Authz helpers: `requireTournamentBeta` and `requireTournamentAdmin`. Beta grants are **CLI-only** (`./per-ankh admin tournament beta-grant`) — the API doesn't expose them.

**Local dev.** Two distinct dev-auth mechanisms, both local-only and both auto-granting tournament beta:

- The Worker endpoint `/v1/auth/dev/login` (`handleDevLogin` in `cloud/src/auth.ts`), gated on `DEV_LOGIN` in `cloud/.dev.vars` + non-HTTPS, mints a browser session — see `docs/dev-login.md`.
- `./per-ankh admin --local dev-login` mints a session cookie for impersonating a second account from the CLI.

Build a full local fixture (Swiss + championship via the real planner) with `./per-ankh admin --local tournament seed <slug> [name]`, flags `--qualifiers N` (default 6), `--players-per-division N` (default 8), `--fill mid-swiss|swiss-done|mid-championship|complete` (default `mid-championship`).

**Authoritative design docs:** `docs/tournament-feature-spec.md` and `docs/tournament-implementation-notes.md`.

## Asset Bake Pipeline

The sprite map's terrain, hex, resource, and improvement atlases are baked from a local [pinacotheca](https://github.com/becked/pinacotheca) checkout. Both source PNGs (`assets/atlas-sources/`) and outputs (`static/atlases/`, `static/sprites/`) are gitignored — bake locally on demand.

```bash
npm run bake:terrain-3d        # Terrain atlas (terrain-3d.{webp,json})
npm run bake:improvements      # Improvements (base + per-family urban atlases) + nation-asset-aliases.json
npm run bake:resources         # Resource icons
npm run bake:sprites           # Misc sprites (crests, techs, units, laws, religions, yields, icons)
npm run bake:tech-names        # TECH_NAMES override table (in-game display names from Reference/XML)
npm run bake:improvement-names # IMPROVEMENT_NAMES override table from XML
npm run bake:victory-ordering  # Global victory ordering table from XML
npm run bake:map-options       # Map option/script definition tables from XML
npm run bake:law-classes       # Law class table from XML
npm run bake:finalize          # Emits committed manifest TS modules + reconciles orphans
npm run bake:all               # Run them all in order (the nine bakers above, then finalize)
```

Separately, `bake:favicon` / `bake:og` generate site icons and OG images, and `bake:screenshots` / `ux:review` drive Playwright capture for UX review (output under `docs/ux-review/`).

Shared cell geometry / hex masking lives in `scripts/lib/atlas-bake.ts` (`CELL_W=211`, `CELL_H=167`, `HEX_H_SPACING=199`, `HEX_V_SPACING=122`). `src/lib/SpriteMap.svelte` mirrors only the **HEX spacing** constants (`HEX_H_SPACING`/`HEX_V_SPACING`) — keep those two in sync between both sites. Cell dimensions are not mirrored: SpriteMap reads them at runtime from the atlas manifest (`cellWidth`/`cellHeight`, with literal `?? 211` / `?? 167` fallbacks).

### Content-hashed paths

Every baked output (atlas `.webp`/`.json` pair, every sprite PNG, `nation-asset-aliases.json`) is content-hashed. The filename embeds the first 8 hex chars of `sha256(outputBytes)` (e.g. `static/atlases/terrain-3d.a1b2c3d4.webp`). Direct unhashed URLs no longer resolve — `curl http://localhost:1420/atlases/terrain-3d.webp` returns 404.

Resolve URLs at runtime via the generated manifests:

- `ATLAS_MANIFEST` and `NATION_ALIASES_URL` from `$lib/generated/atlas-manifest`
- `SPRITE_MANIFEST` from `$lib/generated/sprite-manifest`
- `TECH_NAMES` from `$lib/generated/tech-names` (tech display-name overrides from `Reference/XML/Infos/text-infos.xml`; use as `TECH_NAMES[t] ?? formatEnum(t, "TECH_")` so non-overridden techs fall through to the generic formatter)

The XML bakers above also emit committed data tables (not URL manifests) under `src/lib/generated/`: `improvement-names.ts`, `victory-ordering.ts`, `map-option-defs.ts`, `map-script-options.ts`, `law-classes.ts`.

All three modules are committed to git and regenerated by `npm run bake:finalize` (which also runs reconcile and asserts every referenced atlas/sprite file exists). The intermediate JSON sidecars live at `.bake/{atlas,sprite}-manifest.json` and `.bake/tech-names.json` (gitignored). Hand-editing the generated TS modules will fail the existence check on the next bake; add a new asset by re-running the appropriate baker.

Hashed paths get `Cache-Control: immutable, max-age=1y` via `_headers` at the repo root (and mirrored in `web/static/_headers` for the legacy share viewer).

### Re-bake when

- Pinacotheca ships refreshed renders.
- `Reference/XML/` is refreshed against a current Old World install (picks up new DLC `zType`s, nation aliases, and tech display-name changes).

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
- Multiplayer games store `online_id` (Steam/GOG/Epic) per human player in the `player_roster` blob. For anonymous share viewers, `online_id` is the only blob field stripped — via a deep walk (`stripOnlineIds`/`stripOnlineIdsDeep` in `cloud/src/games.ts`) before the blob is returned; owners keep it. `discord_id`/`username` live only in D1 metadata, never in the share blob. PII is never logged.

## Key docs

`docs/` holds many historical analyses; these are the current, authoritative references a contributor should trust:

- `docs/tournament-feature-spec.md` + `docs/tournament-implementation-notes.md` — tournament design and build record.
- `docs/c4-model.html` — C4 architecture overview.
- `docs/cloud-deploy-plan.md` — deploy runbook (the [Deploy CLI](#deploy-cli) automates it).
- `docs/dev-login.md` — local Discord-free auth bypass.
- `docs/owreference-data-extraction.md` + `docs/reference-popup-data-approaches.md` — Reference/XML extraction approach.
- `docs/reference/color-scheme.md` — chart/UI color reference.

## Development Principles

- **Optimize for the app, not for developer time.** Dev time and diff size are not constraints. Never recommend an approach on the grounds that it's "less work," "a smaller change," "less refactoring," "faster to ship," or "avoids touching X." When weighing options, evaluate them only on code-quality axes: consistency, conceptual coherence, fewer special cases, fewer mental models, clarity at the point of read. If a cleaner approach takes substantially more work, it is still the recommended approach by default. The goal is a great app, not an efficient implementation session.
- **YAGNI.** Implement what's needed now, not what might be useful later.
- **DRY.** Reuse existing patterns; extract shared logic.
- **Atomic commits.** One logical change per commit. (But be pragmatic, no git jujitsu just to follow this principle.)
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
