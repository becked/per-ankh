# Tournament UI (`src/lib/tournament/`)

Bracket / standings / match components for the tournament subsystem, consumed by routes under `src/routes/tournaments/` (`/[slug]`, `/guide`). This is the most actively developed — and historically the highest-friction — area of the app. Most past contributions worked and had tests but needed cleanup for *fit*. Read the rules below before adding a component.

## Fit before you write

- **Reuse the existing helper — grep first, don't re-inline.** This directory already has one way to do most things:
  - Copy-to-clipboard: `copyToClipboard` from `$lib/utils/clipboard` (don't hand-roll a `$state` flag + `setTimeout` + "Copied!" swap per button).
  - Series / nation colors: `getNationChartColor(nation, i)` and `getChartColor(i)` from `$lib/config` — never a `?? '#888888'` gray literal.
  - Color + alpha: `toRgba(color, alpha)` from `$lib/utils/color` — don't add a third alpha mechanism.
  - Enum display: `formatEnum()` from `$lib/utils/formatting`.
  - URL sync: `goto(resolve(...))` — the app navigates this way everywhere; don't introduce shallow `replaceState`.
  - Matchup / label formatting ("A v B", `phaseLabel`, `bracketLabel`): these have been duplicated across `CastView`, the matches page, and `MatchPopover` with *different* missing-side fallbacks (`?` / `—` / `Bye`). Use the shared helper; if one doesn't exist yet for your case, add one and point all sites at it — don't paste a fourth copy.
- **Wire all N parallel surfaces.** The most-repeated defect here was uneven coverage: a prop passed by only 1 of 3 `MatchPopover` call sites; a "Match N" badge on Swiss cards but not championship cards; a gate on one block but not its sibling. When a prop/badge/gate/value lives on multiple sibling surfaces, update **every** one.
- **Authoritative, user-visible handles are persisted server-side, not computed client-side per render.** A value an admin pastes into Discord (e.g. a stable match number) must come from the DB and be append-only by construction — not recomputed per render where "it must never change" is only a comment.
- **No dead/speculative code** — no exported helper or prop without a consumer, no unused branches, no no-op `eslint-disable`.

## Lifecycle & data model

A tournament moves `setup → swiss → championship → complete`. Most config (slots, maps) can only change in `setup`; later phases lock it. Data model: `tournaments` (1) → `tournament_rounds` → `tournament_matches`; matches reference `tournament_slots` by id; `map_pool` is JSON on the tournament. Worker engine is in `cloud/src/tournament/` (see that dir's `CLAUDE.md`).

## Rules are documented, not folk knowledge

For how tournaments actually behave — Swiss pairing, byes, divisions/sizing, advancement, tiebreakers/seeding, championship bracket, maps, reporting, withdrawals — the source of truth is `docs/tournament-rules.md` and the `tournament-rules` skill. Our Swiss differs from generic Swiss; don't infer mechanics.

## Investigating tournament data locally

Prefer the project CLI over raw wrangler: `./per-ankh admin --local tournament show <slug>` (and `list`, plus `seed` to build a fixture). For ad-hoc queries the CLI doesn't cover, the local D1 is fine to read directly (**local only** — `--remote` is prod and gated). A tournament URL is `/tournaments/<slug>` — the path segment is the `slug`, not `tournament_id`:

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

**Setup-gate 404 gotcha:** `public.ts` (`setupGateHides`) hides setup-phase tournaments with signups closed from non-admins — this is why a freshly-seeded tournament can "404 unexpectedly" in local dev. To act as a specific account (slot claims, admin), use the local Discord-free login bypass — see `docs/dev-login.md` — or `./per-ankh admin --local dev-login`.
