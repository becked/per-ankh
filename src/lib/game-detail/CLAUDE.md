# Game Detail View (`src/lib/game-detail/`)

Builds the `/games/[id]` page. **Shared with the legacy share viewer:** `web/src/routes/share/[id]/` symlinks back into `src/lib/` (specifically `game-detail/`, `types/`, `config/`, `generated/`, plus top-level shared components like `SpriteMap`, `Chart`, `MapTooltip`). So UI-only changes here propagate to the legacy share viewer automatically when `web/` redeploys.

## Adding to the view

- **Adding a yield chart:** add one entry to `YIELD_CHART_CONFIG` in `helpers.ts`, and add the new key to `ChartFilterKey` and `PLAYER_CHART_KEYS` in the same file.
- **Adding a tab:** create `FooTab.svelte` here, then add a `Tabs.Trigger` and `Tabs.Content` in `GameDetailView.svelte`.

## Changes that need new backend data

UI-only changes work without touching the backend. But if a new chart/tab needs data not in the existing share blob, you must update both:

1. The cloud Worker (`cloud/src/`) — add the field to the share blob shape and to the validation schemas (see `cloud/src/CLAUDE.md`).
2. The `web/` viewer's `webApi` if the new field needs to be sliced from the cached blob.

Deploy the Worker schema change **before** releasing the frontend that depends on it.

## Per-player vs whole-game data (a correctness trap)

Stats bugs here have come from conflating whole-game state with the current player's. Gate on the **player's own** data, not "any player": e.g. a naval/tech-unlock marker should key off the player's own units, not any player's — otherwise player A's boat lights up player B's markers in an FFA. Watch for mixing a fog-limited roster count with a complete power stat. Use `getNationChartColor(player.nation, i)` from `$lib/config` for per-player series color, never a gray literal.
