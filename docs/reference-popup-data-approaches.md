# Entity reference popups — data approaches

A roadmap feature: clicking a **family, nation, improvement, law, wonder,
specialist, …** opens a popup with general reference info about that thing
(its description, effects, bonuses, and cross-links to related entities).

The save blob does **not** carry this data — per-ankh only extracts the narrow
slices its charts/tabs/tooltips need today. "General reference info" is the same
domain [owreference](https://github.com/alcaras/owreference) covers, so the
question is build-vs-consume. This doc outlines both approaches.

See also `docs/owreference-data-extraction.md` for how owreference's pipeline
works in detail.

---

## 1. What the feature needs (shared by both approaches)

The popup is the **full-reference** tier: not just flavor text, but rendered
**effects** ("+2 Science/City"), **bonuses** (free units/projects/stockpile),
and **cross-links** between entities.

That distinction is the whole cost driver:

- **Description / flavor text** is already plain English in
  `Reference/XML/Infos/text-*.xml`. Looking it up and running `stripMarkup`
  (already in `src/lib/utils/formatting.ts`) is trivial — a direct extension of
  the existing name bakers.
- **Effects and bonuses** are **not** stored as text. The XML holds
  cross-referenced effect trees (`effectCity.xml` → yield-rate pairs →
  `bonus.xml` → conditions → unlock refs, resolved by ID across ~13 files).
  Turning those into one-line human strings is the fiddly 80% of the work, and
  it is exactly what owreference's **humanizer** (`scripts/humanize.py`, ~787
  lines) exists to do.

Either way, the **rendered output text is Mohawk's game content** — same
non-MIT posture as the baked atlases/sprites. What differs between the two
approaches is who writes and maintains the *rendering code*, not the data's
provenance.

### Rights status

owreference is third-party (`alcaras/owreference`) and currently ships **no
LICENSE file**. However, we cooperate with alcaras directly (Discord), so
reuse/permission is **not a blocker**. The only owreference-specific risk that
remains is the **data contract** (its JSON shape has no stability guarantee —
see §3).

---

## 2. Approach A — bake it ourselves

Re-implement the extraction in per-ankh's own bake pipeline, reading the shared
`Reference/XML/` install directly (already symlinked via
`scripts/lib/paths.ts:resolveReferenceXml`).

### Shape

Follows per-ankh's established two-stage pattern, identical to the existing
`bake-tech-names.ts` / `bake-improvement-names.ts` bakers:

```
Reference/XML/Infos/*.xml
   │  scripts/bake-reference-entities.ts   (+ a TS port of the humanizer)
   ▼
.bake/reference-entities.json              (gitignored sidecar)
   │  scripts/build-manifests.ts           (sortedKeys + writeIfChanged)
   ▼
src/lib/generated/reference-entities.ts    (committed, deterministic)
   │  imported at build time
   ▼
popup component
```

### What we'd have to build

1. A **TS port of the effect-tree humanizer** — the 10×-yield rescale,
   link-markup stripping, and the field zoo (`aiYieldRate`,
   `aaiTileYieldRate*`, `aiImprovementClassModifier`, `aiMilitaryKillYield`,
   nested `<EffectPlayer>` → "Unlocks X", …), plus the documented quirks (e.g.
   the `TEAMCOLOR_NATION_YEUZHI` typo).
2. A **builder per clickable domain** (nations, families, improvements, laws,
   wonders, specialists…).
3. A lightweight `zType → entry` lookup so the popup can resolve any click
   target. (We do **not** need owreference's full 367-entity registry or its
   `backlinks.json` PKM graph — a flat lookup plus per-entry cross-link refs is
   enough for a popup.)

### Pros

- **Zero external dependency.** No submodule, no contract risk, no coordination.
- **Bakes against our own symlinked install**, so the reference data tracks the
  same OW patch surface as everything else per-ankh bakes (no version skew —
  cf. §3's residual).
- Fits per-ankh's existing TS-module convention exactly; one mental model.

### Cons

- **We own the humanizer and the patch treadmill forever.** Every patch/DLC
  that adds effect fields is ours to teach the humanizer (this is precisely the
  maintenance owreference absorbs upstream).
- **Largest up-front build** — reproducing ~1500 lines of cross-referenced
  XML-walking that already exists and is already correct elsewhere.

---

## 3. Approach B — bake it through owreference

Consume owreference's already-rendered `src/data/*.json` instead of re-deriving
it, insulated behind an anti-corruption adapter.

### Shape

```
owreference (pinned submodule @ SHA)
   └─ src/data/{nations,families,rural_improvements,laws,…}.json
   │  scripts/bake-reference-entities.ts   (Valibot-validated ADAPTER)
   ▼
.bake/reference-entities.json              (gitignored sidecar)
   │  scripts/build-manifests.ts
   ▼
src/lib/generated/reference-entities.ts    (per-ankh-OWNED stable type + SHA stamp)
   │  imported at build time
   ▼
popup component
```

We read owreference's **committed JSON** — no need to run its Python toolchain.

### The three mechanisms that contain the data-contract risk

owreference's JSON shape is explicitly "an internal build artifact with no
stability contract; keys can change any patch when `make data` regenerates."
That risk is bounded by:

1. **Pin the source.** Bring owreference in as a **git submodule pinned to a
   SHA** (or a vendored snapshot). A patch-time shape change cannot reach
   per-ankh until *we* bump the pin deliberately.
2. **Anti-corruption adapter — the whole game.** owreference's shape never
   touches app code. The adapter reads its JSON and emits a per-ankh-**owned**,
   stable, typed module. When alcaras's keys move, we fix **one adapter file**;
   nothing downstream notices.
3. **Validate at bake time.** Parse owreference's JSON through **Valibot**
   (already used in `cloud/src/`). A renamed/removed key then **fails the bake**
   with a clear error — a loud build break instead of a silently broken popup.

Boundary: `pinned JSON → [Valibot-validated adapter] → per-ankh's stable module
→ popup`. The only thing that ever reacts to upstream churn is the adapter, and
a pin bump is when we choose to absorb it.

### Residual: reference-data version skew

Consuming owreference's committed JSON means the popup data is pinned to
**whatever OW patch alcaras last baked**, independent of the patch a user's save
came from. For "general info about a family" this is almost always harmless, but
to keep a missing/wrong entry diagnosable the generated module should carry a
**provenance stamp** — owreference SHA + (if available) OW patch. The adapter is
the natural place to stamp it. (This is the same patch-tag idea raised for the
asset bake generally.)

### Pros

- **Offloads the humanizer and patch treadmill to alcaras**, who already
  maintains it against every patch — skips ~1500 lines we'd otherwise own.
- **Immediate, broad coverage** — nations, families, improvements, laws,
  wonders, specialists, opinions, etc. already rendered.
- Contract risk costs ~**one adapter + one schema + a pin**, far less than the
  humanizer.
- Social backstop available: we can ask alcaras for a heads-up on shape changes
  (on top of, not instead of, the engineering guardrails).

### Cons

- **External dependency** — a submodule + the discipline of deliberate pin
  bumps; the adapter must be updated when upstream shape drifts.
- **Version skew** between owreference's bake patch and the user's save patch
  (mitigated by the provenance stamp, not eliminated).
- Inherits owreference's coverage gaps (e.g. its YAML-fallback DLC nations) as-is
  rather than being able to fix them at the source.

---

## 4. Side-by-side

| Axis | A — bake ourselves | B — through owreference |
|---|---|---|
| Up-front build | High (port humanizer + N builders) | Low (adapter + schema + pin) |
| Ongoing maintenance | We own the patch treadmill | alcaras owns it; we re-pin |
| External dependency | None | Pinned submodule |
| Contract risk | None | Bounded by adapter + Valibot + pin |
| Patch/version skew | None (our own install) | Possible (stamp it) |
| Coverage | Whatever we build | Broad, immediate |
| Provenance of output text | Mohawk content (non-MIT) | Mohawk content (non-MIT) — same |
| Fits per-ankh conventions | Yes | Yes (same two-stage bake) |

Both paths terminate in the **same** per-ankh-owned
`src/lib/generated/reference-entities.ts` consumed by the popup, so the app code
and the popup component are **identical** either way. The choice is purely about
who produces the rendered effect strings upstream of the adapter — which means
switching approaches later only touches the bake step, not the feature.

---

## 5. Recommendation

Given the rights question is resolved (we cooperate with alcaras), **Approach B**
is the better trade today: it skips the ~1500-line humanizer and its perpetual
patch maintenance, and the only retained risk — shape drift — is fully bounded
by the pin + adapter + bake-time validation. Approach A stays the clean fallback
if the dependency ever becomes undesirable, and because both converge on the
same generated module, the fallback is a localized swap of the bake step.

Scope note for whichever path: a click-popup needs `zType → entry` resolution
plus per-entry cross-link refs, **not** owreference's full entity registry or
`backlinks.json` graph. That trims both approaches.
