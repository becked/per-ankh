# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository — including external contributors' Claude Code. Read the **Guardrails** and **Contributing** sections before making changes; they're what keep a PR easy to merge.

Domain-specific detail lives in **nested `CLAUDE.md` files** (loaded automatically when you work in that directory) and in **skills** (loaded on demand). See [Key docs & skills](#key-docs--skills). Keep this root file small.

## Guardrails

- **Never touch prod or staging by default.** Never run any `prod`, `staging`, or `--remote` command — or any direct `wrangler`/`npx wrangler` call against a live Worker/D1/R2/KV, including read-only ones like `preflight`, `status`, and `smoke` — unless the user's current message explicitly names that exact command. Anything touching `prod`, `staging`, or `--remote` is off-limits by default; ask first. These authenticate against the user's Cloudflare account (a 1Password prompt on this machine) and can hit live resources even when nominally read-only. Local (`--local`, `.wrangler` state) is fine.
- **Never deploy unprompted.** Deploys happen only on a specific ask. The `deploy` skill covers the runbook.
- **PII never leaves its lane.** `online_id` is stripped from the share blob for anonymous viewers; `discord_id`/`username` live only in D1 metadata, never in the blob. Details in `cloud/src/CLAUDE.md`.

## Project Overview

Per-Ankh is a web app at <https://per-ankh.app> for analyzing Old World save files. Saves are parsed in the browser, persisted to Cloudflare, and visualized through interactive charts and a hex-tile map. It also hosts **tournaments** — a Swiss-into-championship competition system — the largest, most active subsystem (see [Tournament subsystem](#tournament-subsystem)).

## Environment

A web app deployed to Cloudflare. There is no desktop runtime, no DuckDB, no Rust — assume browser semantics for the frontend and Cloudflare Worker semantics for the API.

The `./per-ankh` script at repo root is the project CLI (`scripts/per-ankh.ts`):

- `./per-ankh dev` — spawns SvelteKit dev (:1420) and Wrangler dev (:8787) together. (The `run` skill can drive the app for you.)
- `./per-ankh admin` — operator CLI for the live app → **`admin-cli` skill**.
- `./per-ankh prod` / `./per-ankh staging` — deploy runbook automation → **`deploy` skill**.
- `./per-ankh backup [--local]` — snapshots D1. **Defaults to remote/production** (operator-run, gated — see Guardrails); `--local` exports dev state.

## Contributing — making PRs that merge cleanly

Past contributions consistently *worked and had tests* but needed cleanup for **fit**: they built in isolation from the repo's existing patterns and parallel surfaces. Follow these, in priority order:

1. **Reuse before you invent.** Grep the whole repo (and `main`) for an existing helper, component, or idiom before writing a new one — don't add a second or third way to do the same thing. Already present: `copyToClipboard` (`$lib/utils/clipboard`), `toRgba` (`$lib/utils/color`), `getSeriesColor`/`getNationChartColor`/`getChartColor` (`$lib/config`), `formatEnum` (`$lib/utils/formatting`), `goto(resolve(...))` for URL sync, and an annotate-then-filter idiom for request shaping.
2. **Speak the game's vocabulary.** Name domain things what Old World names them — `Reference/XML` (baked into `src/lib/generated/`) is the authority, and a term that appears nowhere else in the repo is a red flag.
3. **Answer game rules from the game.** `Reference/XML` names things; `Reference/Source` — the game's own C# — decides what they *do*. Before modelling a yield, adjacency, activation or eligibility rule, read the method that computes it and cite it in a comment (`Tile.cs:5167`), as `src/lib/parser/parsers/tiles.ts` and `scripts/bake-science-yields.ts` already do. A rule inferred from XML tag names instead is a defect that ships green: `<Pillaged/>` and `<ImprovementBuildTurnsLeft>` were read under names the game never writes, and an unfinished improvement paid its neighbours a bonus `getActiveImprovement` denies it.
4. **Measure claims about the data.** Anything asserted about what saves or the database contain — in code, a comment, a tooltip, or the PR body — gets counted first, against `test-data/saves/` (see its README) or a D1 snapshot, and the count goes in the commit message. Corollary: never write a guard, filter, or caveat the data can't support. `PlayerLaw.law` is non-nullable and `removedTurn` is hardcoded `null`, so an "active only" filter over them enforces nothing while promising something real. Where the blob genuinely can't answer, say so on screen — a band, an "uncertain" row — rather than silently picking a side.
5. **Wire all N parallel surfaces.** When a prop/badge/gate/value lives on multiple sibling call sites or cards, update **every** one — uneven coverage is the single most-repeated defect, and `svelte-check` won't find it for you: sibling surfaces read shared rows through structural subset types, so a field you forgot to thread is a narrower type, not an error.
6. **Extract, don't copy-paste.** Duplicated SQL fragments and label/format helpers drift into divergent fallbacks and dropped guards. One shared helper.
7. **No dead or speculative code.** No exported API without a consumer, no unused params/props/branches, no no-op `eslint-disable`. But a shared helper or a new component prop ships in the same PR as its first call site — splitting them makes the first PR speculative and the second one a revert.
8. **Authoritative, user-visible values are persisted server-side**, not computed client-side per render.
9. **Guards apply to every writer/reader of a shared field** — CAS/`_rev` on all writers, rate-limit budget recorded by all readers.
10. **Use project helpers over literals** — series-color / enum / color helpers; the null-handling operators below. Never a hardcoded hex or a gray fallback where a helper exists.
11. **PR hygiene.** Keep PRs small and split by risk profile; rebase on current `main` (a stale branch fails a since-tightened lint); run `npm run lint`, `svelte-check`/`tsc`, and `npm test` (in `cloud/`) before pushing. When the change touches them, also: a `cloud/migrations/` number nobody else has claimed (rebasing is what collides them), any new `scripts/bake-*.ts` added to `bake:all` in run order, and `npm run bake:<yours> && npm run bake:finalize` re-run so `src/lib/generated/` reproduces byte-for-byte.
12. **Verify before you claim.** Don't assert a convention exists — or doesn't — from partial reading. Grep the whole repo and `main` first.

Underlying principles: **optimize for the app, not developer time** (evaluate options on consistency, conceptual coherence, fewer special cases — never on "less work" or "smaller diff"); **YAGNI**; **DRY**; **atomic commits** (one logical change each, pragmatically); **comments explain WHY** (the code shows what).

## Reviewing contributor PRs

Review correctness as normal, then check **fit** — contributions here work and have tests, and still diverge from established patterns or miss sibling call sites. Fit defects pass a correctness review by construction, so they need explicit checks: those, and how to run them against a diff, live in the **`pr-review` skill**; the section above is the policy they test against.

## Coding Standards

**Documentation & Markdown.** Prose in Markdown (`*.md`, including `docs/`) is **soft-wrapped: one paragraph per line.** Never hard-wrap prose to a fixed column width — that's a code convention and wrong for prose. Lists/table rows still break per item; fenced code keeps its own formatting. (Prettier is disabled for `*.md`/`docs/`, so nothing reflows these — don't introduce the wrapping.)

**TypeScript / Svelte.** Display backend enums with `formatEnum()` from `$lib/utils/formatting`.

**Svelte 5 (runes).** Runes throughout — don't mix Svelte 4 patterns (they compile but cause silent rendering failures).

```typescript
let count = $state(0);
let doubled = $derived(count * 2);
let { name, age = 0 }: { name: string; age?: number } = $props();
$effect(() => { console.log("count changed:", count); });
```

`$effect` only tracks values it actually **reads at runtime** — read reactive values unconditionally if you want them tracked even when an early-return branch is taken:

```typescript
// Correct — both `chart` and `option` read every run.
$effect(() => { const o = option; if (chart && o) chart.setOption(o); });
// Bug — `option` is only read when `chart` is truthy; if chart starts null,
// `option` is never tracked, so updates to it don't rerun the effect.
$effect(() => { if (chart) chart.setOption(option); });
```

For stores, convert to `$state` and subscribe **inside an effect** (returning the unsubscribe), not at module top level — top-level subscription breaks component init.

**Null/Undefined handling.** Domain/data layer (strict): `??` for null/undefined, `!= null` when `0`/`""` are valid; **never** `||` for data computation. UI rendering (pragmatic): `||` is fine for display fallbacks (`{game.name || "Unknown Game"}`).

**Colors.** UI: Tailwind classes / CSS variables, don't hardcode hex. Charts: `import { CHART_THEME, getSeriesColor } from "$lib/config"` and color categorical series via `getSeriesColor(i)` — `getChartColor(i)` is the *civilization fallback* ramp, not a rotation. Nation/civ: `getNationColor` / `getCivilizationColor` / `getNationChartColor` from `$lib/config` (e.g. `getCivilizationColor(player.nation) ?? getChartColor(i)`). Reference: `docs/reference/color-scheme.md`.

**Design system.** The app has one, in code rather than prose: `Panel` / `PanelInset` (`$lib/ui`) for the titled-panel-over-raised-subpanel shape, and the `--color-surface-{deep,sunken,raised}` ladder in `src/app.css`, whose comments say what each level is for. Match the surfaces around you before inventing a layout — an `<h2>` in game detail is `text-lg`; a disclosure is the chevron-with-`rotate-90` idiom; a page scrolls with `cloud-scroll` + `autohideScroll`; a profile link goes through `ProfileLink`; a two-way switch is the segmented control the tournament and stats pages share. Reserve the slot for an icon that may not resolve and the height for a row count that varies, so a table stays aligned and a panel doesn't resize under the pointer. Prefer Old World's own glyph to a hand-rolled SVG or an emoji.

**Copy.** A heading names what is on screen, not the machinery behind it — "Turn summary", not "Logged this window". Use the game's own string where it has one (`TEXT_UI_*`). Don't caption an interaction the UI already affords. A tooltip claims only what the data supports. A confirm dialog for something irreversible says so.

**API layer.** All Worker calls go through `src/lib/api-cloud.ts` (`cloudApi`) — a thin fetch wrapper handling auth, JSON parsing, and typed error classes (`UnauthorizedError`, …). Add endpoints by extending the `cloudApi` object; keep request/response types adjacent to the function.

## Tournament subsystem

A Swiss-into-championship competition system layered on the save-analysis core — the largest, most active area. Lifecycle: `setup → swiss → championship → complete` (config locks after `setup`).

Code map: frontend `src/lib/tournament/` + routes `src/routes/tournaments/`; worker engine `cloud/src/tournament/`. Each of those dirs has its own `CLAUDE.md` with the how-to and reuse rules.

**Rules & mechanics** — Swiss pairing, byes, divisions/sizing, advancement, tiebreakers, championship bracket, maps, reporting, withdrawals — are documented in `docs/tournament-rules.md` (the source of truth) and the `tournament-rules` skill. Our Swiss differs from generic Swiss; answer from the doc, not from general knowledge. Keep the doc in sync with the engine; **code wins on conflict.** As-built history: `docs/tournament-implementation-notes.md`.

## Commit Messages

Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `perf:`, `chore:`. Do **not** add `🤖 Generated with …` or `Co-Authored-By: Claude …` trailers.

## Key docs & skills

Authoritative references in `docs/` (it also holds historical analyses — trust these):

- `docs/tournament-rules.md` — tournament rules & mechanics (source of truth).
- `docs/tournament-implementation-notes.md` — tournament as-built record (design history archived at `docs/archive/tournament-feature-spec.md`).
- `docs/c4-model.html` — C4 architecture overview.
- `docs/api-reference.md` — the Worker's HTTP API: base URLs, every endpoint, auth, response shapes.
- `docs/cloud-deploy-plan.md` — deploy runbook (the `deploy` skill automates it).
- `docs/security-events.md` — `security_events` tee + Skiff drain (dedicated `SECURITY_DB`, retention).
- `docs/dev-login.md` — local Discord-free auth bypass.
- `docs/owreference-data-extraction.md` + `docs/reference-popup-data-approaches.md` — Reference/XML extraction.
- `docs/reference/color-scheme.md` — chart/UI color reference.

**Skills** (`.claude/skills/`, loaded on demand): `deploy` (prod/staging runbook), `admin-cli` (`./per-ankh admin` operator surface), `bake` (asset bake pipeline), `tournament-rules` (answering rules questions), `pr-review` (contributor-PR fit checks), `doc-audit` (docs staleness pass).

**Nested `CLAUDE.md`** (loaded when you work there): `cloud/src/` (Worker), `src/lib/tournament/` (tournament UI), `src/lib/game-detail/` (game detail view).
