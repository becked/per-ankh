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

2. **Grep before every negative claim.** "There's no existing helper for this", "this term isn't used elsewhere", "nothing else reads this field" — each is a claim about the whole repo, and each is wrong often enough to matter. Search the repo *and* `main` before asserting it (`CLAUDE.md` rule 12). An unverified negative is worse than a missed finding: it sends the contributor to rewrite working code.

3. **Report findings, not verdicts.** Cite `file:line` and state the concrete problem — for a fit finding, name the existing pattern it should match instead. Report correctness and fit findings in one list; the contributor shouldn't have to guess which pass produced what. Skip severity rankings and merge/don't-merge calls unless asked.

4. **Judge alternatives on the app, not the diff.** When weighing whether a contributor's approach or the repo's existing one is better, the tiebreakers are consistency, conceptual coherence, and fewer special cases — never "less work" or "smaller diff".

## The checks

Ordered by how often they actually fire here, not by the priority order in `CLAUDE.md`.

- **Parallel surfaces.** The single most-repeated defect. For every prop, badge, gate, field, or value the diff adds to a component, card, or call site, enumerate the siblings and confirm **every** one was updated. Find them by grepping the component name for its other usages and by listing the sibling files in the same directory. The finding is the specific unupdated sibling, with its line.

- **Reuse before invent.** For each new helper, component, or idiom in the diff, grep for an existing equivalent before accepting it. Already present and frequently re-implemented: `copyToClipboard` (`$lib/utils/clipboard`), `toRgba` (`$lib/utils/color`), `getSeriesColor`/`getNationChartColor`/`getChartColor` (`$lib/config`), `formatEnum` (`$lib/utils/formatting`), `goto(resolve(...))` for URL sync, and the annotate-then-filter idiom for request shaping.

- **Project helpers over literals.** A hardcoded hex, or a gray fallback where a helper exists, is a finding. Chart series color via `getSeriesColor(i)` — `getChartColor(i)` is the civilization fallback ramp, and reaching for it as a rotation is itself a finding; nation/civ via `getNationColor`/`getCivilizationColor`/`getNationChartColor` (`getCivilizationColor(player.nation) ?? getChartColor(i)`); UI color via Tailwind classes or CSS variables; backend enums displayed via `formatEnum()`. Reference: `docs/reference/color-scheme.md`.

- **Domain vocabulary.** Every domain noun the diff introduces must be the word Old World uses; `Reference/XML` (baked into `src/lib/generated/`) is the authority. Grep the whole repo for the new term *and* its XML counterpart — a term appearing nowhere else is the finding. Known violation: `building` for `improvement` ([#143](https://github.com/becked/per-ankh/issues/143)).

- **Null handling by layer.** In the domain/data layer, `||` used for data computation is a finding — `??` for null/undefined, `!= null` where `0` or `""` are valid values. In UI rendering, `||` for a display fallback (`{game.name || "Unknown Game"}`) is fine. Check which layer the line is in before flagging it.

- **Svelte 5 runes.** Svelte 4 patterns compile but fail silently at runtime, so they survive tests. Look for: non-rune reactive declarations; `$effect` bodies that read a reactive value only inside a conditional (`if (chart) chart.setOption(option)` never tracks `option` — it must be read unconditionally); store subscriptions at module top level rather than inside an effect returning the unsubscribe.

- **Extract, don't copy-paste.** Duplicated SQL fragments and label/format helpers drift into divergent fallbacks and dropped guards. Compare near-identical blocks both within the diff and against existing code; the finding is the pair, and the fix is one shared helper.

- **Server-authoritative values.** Authoritative, user-visible values must be persisted server-side, not computed client-side per render. A value that renders differently depending on when the client last loaded is the symptom.

- **Guards on every writer and reader.** A guard on a shared field applies to all of them: CAS/`_rev` on every writer, rate-limit budget recorded by every reader. Find the other writers/readers of the field the diff touches and check each — a guard added to one path only is the finding.

- **Dead or speculative code.** Exported API with no consumer, unused params/props/branches, no-op `eslint-disable`. Grep each new export for a call site.

- **Markdown soft-wrap.** Prose in `*.md` is one paragraph per line. Hard-wrapped prose in a diff is a finding — Prettier is disabled for `*.md`/`docs/`, so nothing will reflow it back.

- **PR hygiene.** Branch rebased on current `main` (a stale branch fails a since-tightened lint), PR scoped to one logical change and split by risk profile, `npm run lint` / `svelte-check` / `npm test` (in `cloud/`) clean.

## Where the subsystem rules live

A diff that touches these directories is governed by their nested `CLAUDE.md` too — read it before reviewing files there, since the reuse rules are directory-specific:

- `cloud/src/` — Worker handlers, and the PII lane rules (`online_id` stripped from the share blob for anonymous viewers; `discord_id`/`username` in D1 metadata only, never in the blob, never logged).
- `src/lib/tournament/` — tournament UI. Rules and mechanics questions are answered from `docs/tournament-rules.md` and the `tournament-rules` skill, not from generic Swiss knowledge.
- `src/lib/game-detail/` — game detail view and the frozen legacy `web/` share viewer.

Generated files under `src/lib/generated/` are baked from `Reference/XML` — a hand-edit there is a finding regardless of correctness; the fix is the narrowest `npm run bake:*` command (see the `bake` skill).
