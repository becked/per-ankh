---
name: doc-audit
description: >-
  Audit the project's documentation for staleness and accuracy, then propose a
  cleanup. Use when docs have drifted from the code, when someone asks "which
  docs can we trust?", before a release, or on a periodic cadence. Produces a
  dated, validated verdict report (keep/caveat/archive/extract/delete per doc)
  grounded in the current code — it proposes actions and never deletes, moves,
  or rewrites a doc without an explicit instruction. Not for writing or editing
  a single doc (that's normal work); this is the whole-corpus triage-and-verify
  pass. The worked example is docs/doc-audit-2026-06-30.md.
metadata:
  type: project
  worked-example: docs/doc-audit-2026-06-30.md
---

# Auditing docs/ for staleness

Stale docs are worse than missing docs: they read like current guidance and quietly steer decisions wrong. The goal of this skill is a **trustworthy `docs/`** — every doc either provably matches the code (authoritative), is clearly marked as a historical record, or is gone. The output is a dated verdict report like `docs/doc-audit-2026-06-30.md`; this skill **proposes**, it does not mutate docs without an explicit instruction.

## The three-state model

Drive every verdict toward exactly one of these. There is no governed "just sitting in `docs/`" middle — that ungoverned middle is where staleness hides.

- **Authoritative** — linked from `CLAUDE.md`, claims verified against code; may be used as guidance.
- **Historical** — carries a banner *and* lives in `docs/archive/`; a record, never instruction.
- **Deleted** — adds nothing a git archaeologist couldn't reconstruct.

## Verdict rubric

- **keep** — accurate, useful as current guidance.
- **caveat** — mostly accurate but a specific section is stale; fix it or add a banner on just that part. Name the exact stale claim.
- **archive** — accurate *historical record* (spec/plan/status/point-in-time review) that must not be read as current guidance. Move to `docs/archive/` with a banner.
- **extract** — mostly obsolete but holds a still-true nugget not recorded elsewhere; lift the nugget into `CLAUDE.md` or an authoritative doc, then archive/delete the rest. Name the nugget.
- **delete** — adds nothing beyond git history.

`keep`/`caveat` → authoritative; `archive` → historical; `extract` → salvage then move; `delete` → gone.

## Protocol

The process is **two-phase on purpose**: a triage fan-out that assigns verdicts, then an independent validation pass that re-checks every load-bearing claim against code. Phase 2 is not optional — triage agents are good at classifying but reliably over-confident on specifics (file:line citations, "X doesn't exist" claims). In the worked example, validation caught three confidently-stated sub-claims that didn't survive contact with the code, and a raw grep that *looked* like a contradiction but was the schema's own comment.

1. **Inventory (mechanical).** Enumerate every prose/spec doc under `docs/` (`.md`, `.html`). For each, capture: last-git-touch date (`git log -1 --format=%ai -- <f>`), inbound-reference count (how many files in the repo mention its basename), and whether `CLAUDE.md` links it (the **blessed/authoritative set**). Cluster the docs by subsystem or era so each can be handed to one triage agent.

2. **Triage fan-out.** Dispatch one agent per cluster (parallel). Give each the rubric, the three-state model, and the current-state facts an agent won't infer (see "Project context" below). Require a verdict per doc with: rationale, the specific stale/contradicted claims with code `file:line` evidence, and a concrete recommended action. Scrutinize the **blessed set hardest** — a stale authoritative doc is the most dangerous kind, and the allowlist is *not* self-verifying (in the worked example, a Key-docs entry had rotted).

3. **Validate every load-bearing claim (do this yourself, not via more agents).** For each verdict, re-check the claims that would *flip it* if wrong — re-grep/re-read against the actual code and quote the real line. Apply a sliding bar:
   - **delete** and **authoritative-doc changes** get the strictest bar — confirm the content is truly reconstructible-from-git-only and the cited replacements exist.
   - **archive** is non-destructive but still verify the doc is genuinely dead (heavy dead-stack references) and that any "surviving remnant" it points at still exists.
   - A claim that survives is **CONFIRMED**; one you can't fully trace is **plausible** (say so, don't assert); a refuted claim corrects the verdict.
   - **Check the live value, not a nearby comment, stamp, or doc sentence** — comments and version stamps drift independently of what they describe. (In the worked example a stale `# … placeholder` comment sat directly above a real, provisioned `database_id` and briefly fooled the validation pass itself.)
   - Track this with a task list (one task per verdict-risk bucket: deletes, blessed-doc demotions, the open-finding extractions, caveats, archives, keeps).

4. **Extract before archiving reviews — and mind disclosure.** Security/code-review artifacts mix *still-open* findings with since-fixed ones; verify each against code first, then route by sensitivity **and repo visibility**:
   - **Security findings on a public repo** must not live in a committed doc *or* a public issue — both disclose. Move them to **private** GitHub security advisories (repo → Security → Advisories; or `gh api --method POST /repos/<owner>/<repo>/security-advisories` with a `summary`/`description`/`severity`/`vulnerabilities` payload) and **remove the review docs from HEAD** — archiving in-tree still discloses. Git history retains them, so the durable fix is closing the findings, not rewriting history.
   - **Quality/a11y findings** → public issues.
   - On a **private** repo, a tracked issue is fine for everything.
   (Worked example: 8 confirmed-open security findings became private advisories and the source reviews were pulled from HEAD; one a11y item became a public issue.)

5. **Write the report, don't mutate docs.** Emit `docs/doc-audit-<YYYY-MM-DD>.md`: the verdict summary table, per-bucket verdict lists with validation status, the validation outcome (what got corrected), cross-cutting findings, and a recommended cleanup sequence. **On a public repo, do not write a `file:line` security-findings roadmap into this committed report** — route those to private advisories per step 4 and reference them only abstractly. Stop there: moving, deleting, rewriting docs, and editing `CLAUDE.md`'s Key-docs list are separate actions that need their own explicit go-ahead.

## Project context to hand triage agents

These are the facts an agent won't infer from a doc alone, and the most common staleness sources here:

- The repo was **rewritten from a Tauri desktop app (Rust + DuckDB) into a SvelteKit + Cloudflare-Worker web app.** There is no Tauri/Rust/DuckDB/desktop runtime. Any doc referencing `src-tauri/`, `*.rs`, DuckDB, SQL entity tables, or `match_id` composite keys is describing the **dead pre-rewrite world** — this is the single dominant staleness cause.
- **`CLAUDE.md` is the current authoritative description** and its "Key docs" list is the blessed authoritative set. Re-verify it every audit.
- **Save-file *format* knowledge is durable** even when its surrounding implementation is dead — the XML format didn't change because the parser was rewritten to TypeScript (`src/lib/parser/`). Lean `caveat`/`keep` on the format catalog, `archive` on the DuckDB/Rust framing around it.
- **Some `docs/` files are generated build artifacts**, not hand-maintained prose (e.g. `docs/ux-review/{README,index}.html` from `scripts/capture-ux-review.mjs`). A regenerable artifact is not "stale" — judge it differently.
- **The banner convention already works.** Docs that self-banner as historical are the easiest to adjudicate; the cheap win is applying it consistently and pairing it with a move to `docs/archive/`.

## Going forward: make the next audit a diff

This audit had to be reconstructed by reading ~30k lines because nothing carries machine-readable provenance. Add lightweight frontmatter to each doc — `status: authoritative | historical`, `last-verified: <date>` — so a future run validates only what changed instead of re-reading everything. The three-state rule plus that frontmatter is what turns this from a heroic one-off into a cheap recurring check.
