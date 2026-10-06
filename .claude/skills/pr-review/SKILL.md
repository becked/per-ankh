---
name: pr-review
description: >-
  Review a contributor PR for fit with this repo's existing patterns — parallel
  surfaces, helper reuse, domain vocabulary, color/enum/null idioms, Svelte 5
  runes, server-authoritative values, shared-field guards, dead code. Use when
  asked to review a PR or diff, when tagged with @claude on a pull request, or
  when judging whether a change "fits" the codebase. Review correctness as you
  normally would; these checks are the addition, because contributions here
  consistently work and have tests yet still diverge from established patterns
  and miss sibling call sites. Reviews and reports — does not apply the fixes.
metadata:
  type: project
  derived-from: CLAUDE.md "Contributing — making PRs that merge cleanly"
---

# Reviewing a contributor PR for fit

Review correctness first, as you would any PR — bugs, broken edge cases, missing or wrong tests, security problems. Nothing here displaces that.

What this skill adds is the axis that gets skipped. Contributions here reliably *work and have tests*, and still need cleanup for **fit**: a second way to do something the repo already does, a value wired into one card but not its three siblings, a hardcoded hex where a helper exists. Fit defects survive a correctness pass by construction — the tests are green — so they need an explicit checklist or they don't get found. Every check below is written to be **verifiable against the diff**; if you can't point at a file and line, you don't have a finding.

The checks derive from `CLAUDE.md` § "Contributing — making PRs that merge cleanly" and § "Coding Standards". Those are the policy; this is how to test a diff against it. If they ever disagree, `CLAUDE.md` wins — and fix this skill.

## Protocol

1. **Read the whole diff first, then the surrounding code.** Correctness you can mostly judge from the diff; fit you cannot — it only shows up against what already exists. So once the correctness read is done, spend the rest of the pass in the files the diff *doesn't* touch.

2. **Look at the surface, not only the diff.** The design-system and copy defects — a heading a size off its neighbours, an off-palette grey, an icon slot that collapses when the glyph doesn't resolve, spacing that doesn't match the panel beside it — are invisible in a diff. With `./per-ankh dev` running, `./per-ankh ux-review` captures the app into `docs/ux-review/` (three breakpoints across an anonymous and a signed-in pass, local D1/R2/KV only, never production) and writes a `manifest.json` to triage from; read the changed surface next to its siblings. It walks a subset of routes, so confirm the diff's surface is in the bundle before leaning on it.

3. **Grep before every negative claim.** "There's no existing helper for this", "this term isn't used elsewhere", "nothing else reads this field" — each is a claim about the whole repo, and each is wrong often enough to matter. Search the repo *and* `main` before asserting it (`CLAUDE.md` rule 12) — `origin/main` here; the contributor's fork clone calls the same branch `upstream/main`, so a claim checked against their `origin/main` was checked against a stale copy. An unverified negative is worse than a missed finding: it sends the contributor to rewrite working code.

4. **Report findings, not verdicts.** Cite `file:line` and state the concrete problem — for a fit finding, name the existing pattern it should match instead. Report correctness and fit findings in one list; the contributor shouldn't have to guess which pass produced what. Skip severity rankings and merge/don't-merge calls unless asked.

5. **Judge alternatives on the app, not the diff.** When weighing whether a contributor's approach or the repo's existing one is better, the tiebreakers are consistency, conceptual coherence, and fewer special cases — never "less work" or "smaller diff".

## The checks

Ordered by how often they actually fire here, not by the priority order in `CLAUDE.md`.

- **Parallel surfaces.** The single most-repeated defect. For every prop, badge, gate, field, or value the diff adds to a component, card, or call site, enumerate the siblings and confirm **every** one was updated. Find them by grepping the component name for its other usages and by listing the sibling files in the same directory. The finding is the specific unupdated sibling, with its line.

- **Design system.** The largest single bucket of fixup work here. For every new layout, panel, heading, disclosure, scroll container, switch, or profile link in the diff, find the surface it sits next to and match it before accepting a new shape. In the repo already: the `--color-surface` ladder in `src/app.css` — `surface-deep`, `surface-sunken`, the base `surface`, `surface-raised`, each with a `-hover` step, comments saying what each is for; `Panel` (`$lib/ui/Panel.svelte`), a `bg-surface` card with an `h2` at `text-base`, over `PanelInset` (`$lib/ui/PanelInset.svelte`), the *recessed* `bg-surface-deep` box inside it — that pair is the home page's shape, so don't raise it against a surface whose neighbours don't use it; `cloud-scroll` paired with the `autohideScroll` action on a page-level scroll container; `ProfileLink` for a profile link; and the chevron-with-`rotate-90` disclosure. A segmented switch has two accepted shapes and the neighbouring surface decides: the lit-thumb control — an equal-column grid with a raised-surface thumb translated by the active index — hand-rolled in `src/lib/game-detail/TechsTab.svelte`, `src/lib/game-detail/EconomyTab.svelte`, `src/lib/tournament/TournamentViewTabs.svelte`, `src/routes/tournaments/[slug]/+page.svelte`, `src/routes/tournaments/[slug]/matches/+page.svelte`, `src/routes/tournaments/[slug]/stats/+page.svelte` and `src/routes/players/+page.svelte`; or the thumbless bits-ui `ToggleGroup` with `data-[state=on]:bg-surface-raised` items in `src/lib/game-detail/SpecialistsTab.svelte` and `src/lib/stats/YieldsStatsPanel.svelte`. A diff that matched the control beside it is **not** a finding; only a third shape is — excepting an on/off preference, which is `role="switch"` with `aria-checked` through the account page's shared row and not a segmented control. One of these greps: every file using `cloud-scroll` also uses `autohideScroll` and the reverse, so a new page-level container carrying one without the other is the finding — inner `overflow-*-auto` containers (popovers, selects, tab bodies) legitimately carry neither, so check it's a page shell first. Two layout misses recur: `SpriteIcon` renders nothing when `getSpritePath` returns null — true of every sprite — so a glyph outside a fixed-size wrapper (`BuildComparison.svelte`'s `<span class="flex w-3.5 flex-none">`) is a row that unaligns, and a varying row count without a reserved height is a panel that resizes under the pointer. A hand-rolled SVG or an emoji where `SPRITE_MANIFEST` has a glyph is a finding.

- **Copy.** The next largest. A heading that names the machinery rather than what's on screen ("Logged this window" for a turn summary) is a finding, as is a caption explaining an interaction the UI already affords, a tooltip claiming more than the save records, and a confirm dialog for something irreversible that doesn't say so. Two sources for the game's own wording, and they aren't interchangeable: UI strings are in `Reference/XML/Infos/text-ui.xml` ("Turn summary" is `TEXT_UI_EVENT_LOG_TURN_SUMMARY`), entity names are in the baked `src/lib/generated/` tables. A new inline `TABLE[x] ?? formatEnum(x, ...)` is a finding when a wrapper exists — `nationName`, `characterName`, `cognomenName` (`$lib/utils/formatting`), `techName`, `improvementDisplayName`, `projectDisplayName` (`$lib/game-detail/helpers`), `specialistName` (`$lib/game-detail/specialists`). Don't assume the inverse, though: units, resources and families have no name table and still differ from the enum, and a wrapper can sit outside both modules in that list — `specialistName` wraps a `name` field in `generated/specialists.ts`, which is not a `*-names` module, and `formatEnum()` over the same zType drops the urban tier — so "`formatEnum` handles the rest" is a claim to check, not a default.

- **Game rules answered from the game.** Any yield, adjacency, activation, or eligibility rule the diff models must cite the C# that computes it — `Reference/Source/`, in a comment, naming **method and line** as `src/lib/parser/parsers/tiles.ts:30`, `src/lib/game-detail/science-techs.ts:326` and `scripts/bake-science-yields.ts:760` do (`Tile.getActiveImprovement` (`Tile.cs:5167`)); a bare line number is pinned to one game build, so a citation without the method name is itself worth raising. Open the cited method and check it says what the code assumes; check that the element names the parser reads are the ones the game's `writeGameXML` actually writes. A rule inferred from XML tag names is a defect that ships green — the tests pass because nothing on either side of the test knows the name is wrong. `Reference/` is gitignored and often absent — the `@claude` Action never has it — so when you can't open the file, say the citation went unverified instead of asserting either way, and check that the PR said the same.

- **Measured data claims.** A join or match key, a filter predicate, an aggregate choosing between rows, or any assertion about what saves or the database contain — in code, a comment, a tooltip, or the PR body — needs a count behind it, taken against `test-data/saves/` or a local D1 snapshot (`./per-ankh backup --local`). The uncounted claim is the finding; the shapes above are where it hides, since none of them reads like an assertion. Related but settled differently: a guard the data can't support — a filter or caveat over a field that is non-nullable or hardcoded (`PlayerLaw.law`, the character-trait `removedTurn`) — enforces nothing while promising something real, and that one is checked by reading the type, not by counting, so don't ask for a count where the schema already answers. Two limits on a count the PR offers: it was taken at the current `PARSER_VERSION` and stored blobs were written by older ones, and neither source may be quoted row-wise into a commit message (saves carry other players' names and `online_id`, `users` carries `email`) — the number travels, the rows don't. Where the blob genuinely can't answer, the UI should say so next to the value, as `TechsTab`'s uncertain rows do — a chart subtitle isn't the instrument.

- **Reuse before invent.** For each new helper, component, or idiom in the diff, grep for an existing equivalent before accepting it. Already present and frequently re-implemented: `copyToClipboard` (`$lib/utils/clipboard`), `toRgba` (`$lib/utils/color`), `getSeriesColor`/`getNationChartColor`/`getChartColor` (`$lib/config`), `formatEnum` (`$lib/utils/formatting`), `goto(resolve(...))` for URL sync, and the annotate-then-filter idiom for request shaping.

- **Project helpers over literals.** A hardcoded hex, or a gray fallback where a helper exists, is a finding. Grep the diff for `-[#` as well as bare hex — an arbitrary-value Tailwind class is the same finding, and is usually a surface token written longhand (`bg-[#35302b]` is `bg-surface-raised`; `src/app.css`'s ramp comment names the near-identical shades the ramp was introduced to absorb), the standing exception being a brand color the palette can't express (Discord blurple) with its reason in a comment. Worth raising even though no rule bans it yet: `tailwind.config.js` only `extend`s `colors`, so Tailwind's default families stay live alongside ours — a new `amber-700` or `red-400` is a question (is there a token for this?) rather than a violation. Chart series color via `getSeriesColor(i)` — `getChartColor(i)` is the civilization fallback ramp, and reaching for it as a rotation is itself a finding; nation/civ via `getNationColor`/`getCivilizationColor`/`getNationChartColor` (`getCivilizationColor(player.nation) ?? getChartColor(i)`); UI color via Tailwind classes or CSS variables; backend enums displayed via `formatEnum()`. Reference: `docs/reference/color-scheme.md`.

- **Domain vocabulary.** Every domain noun the diff introduces must be the word Old World uses; `Reference/XML` (baked into `src/lib/generated/`) is the authority on what a thing is *called* — what it *does* is the game-rules check above. Grep the whole repo for the new term *and* its XML counterpart — a term appearing nowhere else is the finding. Known violation: `building` for `improvement` ([#143](https://github.com/becked/per-ankh/issues/143)).

- **Null handling by layer.** In the domain/data layer, `||` used for data computation is a finding — `??` for null/undefined, `!= null` where `0` or `""` are valid values. In UI rendering, `||` for a display fallback (`{game.name || "Unknown Game"}`) is fine. Check which layer the line is in before flagging it.

- **Svelte 5 runes.** Svelte 4 patterns compile but fail silently at runtime, so they survive tests. Look for: non-rune reactive declarations; `$effect` bodies that read a reactive value only inside a conditional (`if (chart) chart.setOption(option)` never tracks `option` — it must be read unconditionally); store subscriptions at module top level rather than inside an effect returning the unsubscribe.

- **Extract, don't copy-paste.** Duplicated SQL fragments and label/format helpers drift into divergent fallbacks and dropped guards. Compare near-identical blocks both within the diff and against existing code; the finding is the pair, and the fix is one shared helper.

- **Server-authoritative values.** Authoritative, user-visible values must be persisted server-side, not computed client-side per render. A value that renders differently depending on when the client last loaded is the symptom.

- **Guards on every writer and reader.** A guard on a shared field applies to all of them: CAS/`_rev` on every writer, rate-limit budget recorded by every reader. Find the other writers/readers of the field the diff touches and check each — a guard added to one path only is the finding.

- **Dead or speculative code.** Exported API with no consumer, unused params/props/branches, no-op `eslint-disable`. Grep each new export for a call site.

- **Markdown soft-wrap.** Prose in `*.md` is one paragraph per line. Hard-wrapped prose in a diff is a finding — Prettier is disabled for `*.md`/`docs/`, so nothing will reflow it back.

- **PR hygiene.** Branch rebased on current `main` (a stale branch fails a since-tightened lint), PR scoped to one logical change and split by risk profile, and the checks in `CONTRIBUTING.md` clean — `npm run lint && npm run check` at the root, `npm run typecheck && npm test` in `cloud/`. That block is the canonical list; don't re-derive a different one. When the diff touches them: a `cloud/migrations/` number nobody else has claimed, a new `scripts/bake-*.ts` either wired into `bake:all` in run order or recorded in the `bake` skill as hand-run, and `src/lib/generated/` reproducing byte-for-byte after a re-bake.

## Where the subsystem rules live

A diff that touches these directories is governed by their nested `CLAUDE.md` too — read it before reviewing files there, since the reuse rules are directory-specific:

- `cloud/src/` — Worker handlers, and the PII lane rules (`online_id` stripped from the share blob for anonymous viewers; `discord_id`/`username` in D1 metadata only, never in the blob, never logged).
- `src/lib/tournament/` — tournament UI. Rules and mechanics questions are answered from `docs/tournament-rules.md` and the `tournament-rules` skill, not from generic Swiss knowledge.
- `src/lib/game-detail/` — game detail view and the frozen legacy `web/` share viewer.

Generated files under `src/lib/generated/` are baked from `Reference/XML` — a hand-edit there is a finding regardless of correctness; the fix is the narrowest `npm run bake:*` command (see the `bake` skill).
