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

Past contributions consistently *worked and had tests* but needed cleanup for **fit**: they built in isolation from the repo's existing patterns and parallel surfaces. `main` throughout means `becked/per-ankh`'s `main` — `upstream/main` in the fork clone [`CONTRIBUTING.md`](CONTRIBUTING.md#fork-and-pr-workflow) sets up, where `origin` is your own fork. Follow these, in priority order:

1. **Reuse before you invent.** Grep the whole repo (and `main`) for an existing helper, component, or idiom before writing a new one — don't add a second or third way to do the same thing. Already present: `copyToClipboard` (`$lib/utils/clipboard`), `toRgba` (`$lib/utils/color`), `getSeriesColor`/`getNationChartColor`/`getChartColor` (`$lib/config`), `formatEnum` (`$lib/utils/formatting`), `goto(resolve(...))` for URL sync, and an annotate-then-filter idiom for request shaping.
2. **Speak the game's vocabulary.** Name domain things what Old World names them — `Reference/XML` (baked into `src/lib/generated/`) is the authority, and a term that appears nowhere else in the repo is a red flag.
3. **Answer game rules from the game.** `Reference/XML` names things; `Reference/Source` — the game's own C# — decides what they *do*. Before modelling a yield, adjacency, activation or eligibility rule, read the method that computes it and cite it by **method and line** — `Tile.getActiveImprovement` (`Tile.cs:5167`), the form `src/lib/parser/parsers/tiles.ts:30` and `src/lib/game-detail/science-techs.ts:326` already use. A bare line number is pinned to one game build and moves on the next patch; the method name is what survives it. The same goes for a save element: read it under the name the game's `writeGameXML` actually writes, not the name the field carries here. A rule inferred from XML tag names instead is a defect that ships green: `<Pillaged/>` and `<ImprovementBuildTurnsLeft>` were read under names the game never writes, and an unfinished improvement paid its neighbours a bonus `getActiveImprovement` denies it. Note that `Reference/` is gitignored (`.gitignore:82`) and usually a symlink into a local game install, and that `OLD_WORLD_REFERENCE_DIR` resolves `Reference/XML` for the bakers but nothing for `Source` — so a checkout without it, the `@claude` Action included, cannot run this check: say in the PR which rule went uncited and leave the citation to review, rather than inferring the rule from tag names.
4. **Measure claims about the data.** A join or match key, a filter predicate, an aggregate that picks between rows, and any sentence in a comment, tooltip or PR body about what saves and the database contain — count it first, and put the count in the commit message. A column the PR itself introduces has nothing to count yet — what gets measured there is the claim about the *source* it is derived from. Count against `test-data/saves/` (see its README) or your own local D1, snapshotted by `./per-ankh backup --local` and queried as the `.sqlite` it writes; remote snapshots are operator-only. Corollary: never a guard, filter, or caveat the data can't support — which is settled by reading the type rather than by counting, because `PlayerLaw.law` (`src/lib/types/PlayerLaw.ts`) is non-nullable and the character-trait `removedTurn` (`src/lib/parser/parsers/character-data.ts`) is hardcoded `null`, so an "active only" filter over either enforces nothing while promising something real. Two limits on the count itself: stored blobs were written by older parsers, so "never null across the corpus" is a claim about the current `PARSER_VERSION` and not about what D1 holds; and both sources carry PII — other players' names and `online_id` in a save, `email` in `users` — so what travels into a commit message is the number, never the rows. Where the blob genuinely can't answer, say so where the number is, the way `TechsTab`'s uncertain rows do (`UNCERTAIN_NOTE`) — a row or a band next to the value, not a chart subtitle, which is explanatory text that gets removed again.
5. **Wire all N parallel surfaces.** When a prop/badge/gate/value lives on multiple sibling call sites or cards, update **every** one — uneven coverage is the single most-repeated defect, and `svelte-check` won't find it for you: sibling surfaces read shared rows through structural subset types, so a field you forgot to thread is a narrower type, not an error. Enumerate the siblings from the accessor, not from a directory listing — `matchSlotNation`'s four callers are the four surfaces that render a nation, and the per-surface `*Like` subset types in `src/lib/tournament/match-occupant.ts` are the record of what each one reads.
6. **Extract, don't copy-paste.** Duplicated SQL fragments and label/format helpers drift into divergent fallbacks and dropped guards. One shared helper.
7. **No dead or speculative code.** No exported API without a consumer, no unused params/props/branches, no no-op `eslint-disable`. But a shared helper or a new component prop ships in the same PR as its first call site — splitting them makes the first PR speculative and the second one a revert.
8. **Authoritative, user-visible values are persisted server-side**, not computed client-side per render.
9. **Guards apply to every writer/reader of a shared field** — CAS/`_rev` on all writers, rate-limit budget recorded by all readers.
10. **Use project helpers over literals** — series-color / enum / color helpers; the null-handling operators below. Never a hardcoded hex or a gray fallback where a helper exists.
11. **PR hygiene.** Keep PRs small and split by risk profile; rebase on current `main` (a stale branch fails a since-tightened lint); run the checks in [`CONTRIBUTING.md`](CONTRIBUTING.md#fork-and-pr-workflow) — that block is the one list, and the only one that includes `cloud`'s type check. When the change touches them, also: a `cloud/migrations/` number nobody else has claimed (rebasing is what collides them); a new `scripts/bake-*.ts` recorded in the `bake` skill, and wired into `bake:all` in run order unless it is meant to be run by hand — membership doesn't follow from what a baker reads (`bake:atlas-pool` needs an owtournamentatlas checkout and is in `bake:all`; `bake:owtt` needs one of its own and isn't), so record the choice either way; and `src/lib/generated/` reproducing byte-for-byte after a re-bake, which means running your baker and `bake:finalize` against a complete `.bake/` sidecar set — `.bake/` is gitignored, and a missing data sidecar makes `finalize` emit an *empty* table rather than fail.
12. **Verify before you claim.** Don't assert a convention exists — or doesn't — from partial reading. Grep the whole repo and `main` first.

Underlying principles: **optimize for the app, not developer time** (evaluate options on consistency, conceptual coherence, fewer special cases — never on "less work" or "smaller diff"); **YAGNI**; **DRY**; **atomic commits** (one logical change each, pragmatically); **comments explain WHY** (the code shows what — the test and the three defects are under **Comments** in Coding Standards).

## Reviewing contributor PRs

Review correctness as normal, then check **fit** — contributions here work and have tests, and still diverge from established patterns or miss sibling call sites. Fit defects pass a correctness review by construction, so they need explicit checks: those, and how to run them against a diff, live in the **`pr-review` skill**; the section above is the policy they test against.

## Coding Standards

**Documentation & Markdown.** Prose in Markdown (`*.md`, including `docs/`) is **soft-wrapped: one paragraph per line.** Never hard-wrap prose to a fixed column width — that's a code convention and wrong for prose. Lists/table rows still break per item; fenced code keeps its own formatting. (Prettier is disabled for `*.md`/`docs/`, so nothing reflows these — don't introduce the wrapping.)

**Comments.** Explain WHY — the code shows what. A comment earns its place by saying something the code cannot: a measured bound with the observation that sets it, an incident (`cloud/src/tournament/limits.ts`, on why three read budgets are separate, citing the 2026-08-05 outage), a rejected alternative (`cloud/src/d1.ts`, on why sessions take `first-primary` over `first-unconstrained`), a cross-file invariant. Length is not the defect and density is not a target — those two files are among the most heavily commented here and are the pattern, not the problem. Three things are defects: a comment restating the line under it (`// Techs completed` over `const completedTechs`, `cloud/src/derive-player-summary.ts:281`); the same fact stated twice in one file, often in different words so no grep finds it, where the copy a reader hits first may be the stale one; and a comment narrating its own past ("this comment used to claim…"), which belongs in git. Scope a measured claim to what it was measured on ("on the 2026 tournament") or it silently becomes false when the next one differs. The asymmetry is the reason for all of it: a stale comment reads as current and steers the next change, so it is worse than no comment at all — the same reason `docs/` is governed by the `doc-audit` skill.

**TypeScript / Svelte.** Display backend enums with `formatEnum()` from `$lib/utils/formatting` — except where a baked display name exists, which is what the `nationName` / `characterName` / `cognomenName` / `techName` / `improvementDisplayName` / `projectDisplayName` wrappers are for (see **Copy** below).

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

**Colors.** UI: Tailwind classes / CSS variables, don't hardcode hex — and an arbitrary-value class is the same hex under another spelling: `bg-[#35302b]` *is* `bg-surface-raised`, and the `src/app.css` ramp exists to end exactly that drift (its comment lists the near-identical shades it absorbed). A brand color the palette can't express — Discord blurple — is the standing exception, and carries its reason in a comment. Charts: `import { CHART_THEME, getSeriesColor } from "$lib/config"` and color categorical series via `getSeriesColor(i)` — `getChartColor(i)` is the *civilization fallback* ramp, not a rotation. Nation/civ: `getNationColor` / `getCivilizationColor` / `getNationChartColor` from `$lib/config` (e.g. `getCivilizationColor(player.nation) ?? getChartColor(i)`). Reference: `docs/reference/color-scheme.md`.

**Design system.** The app has one, in code rather than prose: the `--color-surface` ladder in `src/app.css` — `surface-deep`, `surface-sunken`, the base `surface` a `Panel` sits on, `surface-raised`, each with its `-hover` step — whose comments say what every level is for. `Panel` (`$lib/ui/Panel.svelte`) is a `bg-surface` card with an `h2` title at `text-base`; `PanelInset` (`$lib/ui/PanelInset.svelte`) is the *recessed* `bg-surface-deep` box inside it, the step below the panel's surface, with an optional `h3` label. (`$lib/ui` is a directory — import the component file.) That pair is the home page's shape. Match the surfaces around you before inventing a layout — an `<h2>` in game detail is `text-lg`, while `Panel`'s own title is `text-base`; a disclosure is the chevron-with-`rotate-90` idiom; a page-level scroll container pairs `cloud-scroll` with the `autohideScroll` action — both or neither, while an inner overflow container (popover, select, tab body) takes neither; a profile link goes through `ProfileLink`. A segmented switch has two shapes here and the neighbouring surface decides which: the lit-thumb control — an equal-column grid with a raised-surface thumb translated by the active index — hand-rolled in seven files and shared from none (game detail's science (`TechsTab.svelte`) and empire (`EconomyTab.svelte`) switches, `TournamentViewTabs.svelte`, the tournament overview's championship and per-division toggles, the matches and stats pages, and the `/players` board switch), and a thumbless bits-ui `ToggleGroup` styled with `data-[state=on]:bg-surface-raised` (`SpecialistsTab.svelte`, and the Yields toggle in `YieldsStatsPanel.svelte` it was copied from). Match whichever one is beside you, and make the next copy of either the extraction instead. An on/off *preference* is a third thing and not a segmented switch at all — `role="switch"` with `aria-checked`, rendered through one shared row, as the account page does. Reserve the slot for an icon that may not resolve: `SpriteIcon` renders *nothing* when `getSpritePath` returns null, which is every sprite, so the glyph goes in a fixed-size wrapper the way `BuildComparison.svelte` does (`<span class="flex w-3.5 flex-none">`) or the row unaligns. Reserve the height for a row count that varies, so a panel doesn't resize under the pointer. Prefer Old World's own glyph to a hand-rolled SVG or an emoji — `SPRITE_MANIFEST` (`$lib/generated/sprite-manifest`), through `getSpritePath`, is what says whether the game ships one.

**Copy.** A heading names what is on screen, not the machinery behind it — "Turn summary", not "Logged this window". Use the game's own string where it has one, and note there are two different sources: UI strings live in `Reference/XML/Infos/text-ui.xml` ("Turn summary" is its `TEXT_UI_EVENT_LOG_TURN_SUMMARY`), while the baked tables in `src/lib/generated/` hold *entity* names. Reach for a baked name through the wrapper that already does the lookup rather than writing another `?? formatEnum(...)` inline: `nationName`, `characterName`, `cognomenName` (`$lib/utils/formatting`), `techName`, `improvementDisplayName`, `projectDisplayName` (`$lib/game-detail/helpers`), `specialistName` (`$lib/game-detail/specialists`). Where no wrapper exists the table may not either — units, resources and families have no name table at all and still differ from the enum — and a wrapper can live outside both modules above: `specialistName` wraps a `name` field in `generated/specialists.ts`, which is not a `*-names` module, and `formatEnum()` over the same zType silently collapses the three urban tiers into one name. Check before asserting `formatEnum()` is correct for a noun. Don't caption an interaction the UI already affords. A tooltip claims only what the data supports. A confirm dialog for something irreversible says so.

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
