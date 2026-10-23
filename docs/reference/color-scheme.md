# Color Scheme Reference

This document defines the color palettes used throughout the Per-Ankh application.

## UI Color Palette

The UI color scheme is defined in `src/app.css` (`:root`) as the single source of truth; `tailwind.config.js` references these variables. Colors are stored as **space-separated RGB channels** (e.g. `--color-tan: 210 180 140`) and wired into Tailwind as `rgb(var(--color-x) / <alpha-value>)`, so every token takes opacity modifiers (`bg-tan/15`).

> Because the variables hold channels, not hex, a **direct** CSS use must wrap them in `rgb()`: `color: rgb(var(--color-tan));` or `rgb(var(--color-tan) / 0.4)`. Plain `var(--color-tan)` will not resolve to a color.

### Base palette

| Color           | RGB           | CSS Variable          | Tailwind Class                              | Usage                    |
| --------------- | ------------- | --------------------- | ------------------------------------------- | ------------------------ |
| **Black**       | `0 0 0`       | `--color-black`       | `bg-black`, `text-black`, `border-black`    | Borders, outlines, text  |
| **Brown**       | `165 42 42`   | `--color-brown`       | `bg-brown`, `text-brown`, `border-brown`    | Labels, accents          |
| **Dark Brown**  | `121 38 29`   | `--color-dark-brown`  | `bg-dark-brown`                             | Accents                  |
| **Orange**      | `255 165 0`   | `--color-orange`      | `bg-orange`, `text-orange`, `border-orange` | Highlights, borders      |
| **Tan**         | `210 180 140` | `--color-tan`         | `bg-tan`, `text-tan`, `border-tan`          | Tabs, primary text       |
| **Tan Hover**   | `210 180 140` | `--color-tan-hover`   | `bg-tan-hover`, `hover:bg-tan-hover`        | Hover states             |
| **White**       | `255 255 255` | `--color-white`       | `bg-white`, `text-white`, `border-white`    | Text on dark backgrounds |
| **Yellow**      | `255 255 0`   | `--color-yellow`      | `bg-yellow`, `text-yellow`, `border-yellow` | Reserved for future use  |
| **Blue-Gray**   | `33 26 18`    | `--color-blue-gray`   | `bg-blue-gray`                              | Main background          |
| **Border Gray** | `28 22 15`    | `--color-border-gray` | `bg-border-gray`, `border-border-gray`      | Alternative borders      |
| **Gray 200**    | `238 238 238` | `--color-gray-200`    | `bg-gray-200`, `text-gray-200`              | Skeletons, light text    |

### Surface ramp & semantic tokens

Dark-brown chrome consolidated from drift during fast iteration. The `surface-*`
ramp goes darkest → lightest, each base with its hover step.

| Token                  | RGB           | (was)     | Tailwind                       | Usage                                    |
| ---------------------- | ------------- | --------- | ------------------------------ | ---------------------------------------- |
| `surface-deep`         | `26 21 16`    | `#1a1510` | `bg-surface-deep`              | Deepest inset (sprite-map backdrop)      |
| `surface-sunken`       | `36 31 27`    | `#241f1b` | `bg-surface-sunken`            | Recessed: dropdowns, calendars, fields   |
| `surface-sunken-hover` | `50 44 38`    | `#322c26` | `bg-surface-sunken-hover`      | Hover on sunken                          |
| `surface`              | `42 38 34`    | `#2a2622` | `bg-surface`                   | Cards, sections, stat tiles              |
| `surface-hover`        | `62 56 51`    | `#3e3833` | `bg-surface-hover`             | Row/cell/card hover                      |
| `surface-raised`       | `53 48 43`    | `#35302b` | `bg-surface-raised`            | Inputs, raised cards, menus, popovers    |
| `surface-raised-hover` | `64 58 51`    | `#403a33` | `bg-surface-raised-hover`      | Hover on raised                          |
| `bright`               | `219 222 227` | `#DBDEE3` | `text-bright`                  | Bright value / title text                |
| `muted`                | `122 106 85`  | `#7a6a55` | `text-muted`                   | Muted labels                             |
| `placeholder`          | `197 195 194` | `#c5c3c2` | `placeholder:text-placeholder` | Input placeholders                       |
| `input`                | `74 67 59`    | `#4a433b` | `border-input`                 | Input borders                            |
| `input-focus`          | `90 82 74`    | `#5a524a` | `focus:border-input-focus`     | Input focus / selected                   |
| `border-subtle`        | `58 53 47`    | `#3a352f` | `border-border-subtle`         | Subtle dividers                          |
| `border-tooltip`       | `58 47 36`    | `#3a2f24` | `border-border-tooltip`        | Tooltip header border                    |
| `track`                | `74 69 64`    | `#4a4540` | `bg-track`                     | Slider track                             |
| `tan-light`            | `232 216 184` | `#e8d8b8` | `text-tan-light`, `bg-tan-light` | Bracket strokes/borders (low opacity)  |
| `success`              | `140 200 120` | —         | `text-success`, `bg-success`   | Advance / win                            |
| `success-surface`      | `42 58 36`    | `#2a3a24` | `bg-success-surface`           | Success badge background                 |
| `danger`               | `200 110 90`  | —         | `text-danger`, `bg-danger`     | Eliminate / loss                         |
| `danger-surface`       | `58 38 34`    | `#3a2622` | `bg-danger-surface`            | Danger badge background                  |

### Default Theme

- **Background**: Blue-Gray (`var(--color-blue-gray)`)
- **Text**: White (`var(--color-white)`)
- **Native controls**: `color-scheme: dark` — the tokens above only reach what the app paints, so this is what keeps anything the browser draws itself (a `<progress>` track, the calendar glyph inside `<input type="date">`) from coming back light.

### Using UI Colors

**Best Practice**: Use Tailwind classes in your Svelte components for consistency:

```svelte
<!-- Example: Using Tailwind classes -->
<div class="border-2 border-black bg-surface text-tan">Content here</div>
```

For custom CSS where Tailwind isn't available — an SVG stroke, a pseudo-element — wrap the channel variable in `rgb()`. The bracket connectors (`SwissFlowBracket.svelte`) are the shape:

```css
.connector {
	fill: none;
	stroke: rgb(var(--color-tan-light) / 0.25);
	stroke-width: 1.5;
}
```

> **Chart/canvas colors are not these tokens.** ECharts renders to `<canvas>`,
> which cannot resolve CSS variables, so the chart palette (below) and the
> terrain / nation color maps in `src/lib/config/` stay literal hex.

---

## Chart Color Palette

`src/lib/config/charts.ts` holds two chart palettes with different jobs. They are not interchangeable — reaching for the wrong one is the usual way a chart ends up with six near-identical browns where it needed six categories.

### `CHART_COLORS` — the civilization fallback ramp

Six warm tones, indexed by series ordinal. This is what a **civilization** falls back to when it has no color of its own: an unrecognized nation or family, or a mirror match where two players field the same nation and still need telling apart. `getNationChartColor` and `getFamilyChartColor` are its real callers.

| Color Name         | Hex Code  | Export            |
| ------------------ | --------- | ----------------- |
| **Copper**         | `#C87941` | `CHART_COLORS[0]` |
| **Saddle Brown**   | `#8B4513` | `CHART_COLORS[1]` |
| **Peru**           | `#CD853F` | `CHART_COLORS[2]` |
| **Sienna**         | `#A0522D` | `CHART_COLORS[3]` |
| **Chocolate**      | `#D2691E` | `CHART_COLORS[4]` |
| **Dark Goldenrod** | `#B8860B` | `CHART_COLORS[5]` |

All six sit inside a 37-degree hue arc, which is what makes them read as one family of browns rather than six categories. Their closest pair is Chocolate/Dark Goldenrod at **0.017** in OKLab under deuteranopic simulation — close enough to read as a repeat. That is acceptable for a fallback nobody is asked to decode, and disqualifying for a rotation.

### `SERIES_COLORS` — the categorical rotation

Eight colors for a chart that needs its rows told apart — one per bar on the laws, tech and cities charts, one per person on the tournament standings and caster bars. Drawn from `YIELD_COLORS`, so the rotation is still the game's own palette.

| Index | Yield          | Hex       |
| ----- | -------------- | --------- |
| 0     | Happiness      | `#f2c95e` |
| 1     | Wood           | `#9b7d63` |
| 2     | Iron           | `#DBDCDB` |
| 3     | Stone          | `#78839a` |
| 4     | Civics         | `#d78d46` |
| 5     | Science        | `#a16ad1` |
| 6     | Food           | `#739600` |
| 7     | Discontent     | `#8f8fb3` |

The eight are the yields that survive a pairwise separation floor where **each pair is scored on the worse of normal and deuteranopic vision**, so a red-green viewer sees the same eight categories rather than a collapsed subset. Closest survivor pair is Stone/Discontent at 0.056; the seven dropped (Culture, Growth, Legitimacy, Maintenance, Money, Orders, Training) each collided with a survivor below that.

The **order is cyclic and load-bearing**. It maximizes the distance between neighboring indices *including the wrap from index 7 back to 0*, so consecutive rows contrast even where a chart outruns the palette and it repeats — adjacent separation never drops below 0.187. Reordering the array is a design change, not a cosmetic one.

### Using Chart Colors

Import chart colors and theme from the config module:

```typescript
import {
	CHART_COLORS,
	CHART_THEME,
	getChartColor,
	getSeriesColor,
} from "$lib/config";

// Use individual colors directly
const color = CHART_COLORS[0]; // "#C87941"

// A civilization with no color of its own — the fallback ramp, wrapping
const fallback = getChartColor(7); // Wraps to CHART_COLORS[1]

// One row per person / per category — the categorical rotation, wrapping
const series = getSeriesColor(9); // Wraps to SERIES_COLORS[1] (Wood)

// Apply the theme to chart options (RECOMMENDED)
const chartOption: EChartsOption = {
	...CHART_THEME, // Includes colors, title styling, tooltip defaults
	title: {
		...CHART_THEME.title,
		text: "My Chart Title", // Override specific properties
	},
	// ... rest of chart config
};
```

### Design Rationale: Why Separate Palettes?

The application maintains distinct color palettes for different purposes:

1. **UI Palette** (CSS Variables + Tailwind)
   - For interface elements (backgrounds, borders, text)
   - Fixed set of colors with semantic meaning
   - Defined in CSS for maximum flexibility
   - Optimized for UI consistency and branding
   - Runtime themeable if needed

2. **Chart Palette** (TypeScript Constants)
   - For data visualization in ECharts
   - Optimized for visual distinction between data series
   - Higher contrast requirements for readability
   - Needs more variation for multi-player scenarios (6+ colors)
   - Color selection based on perceptual difference rather than branding
   - Type-safe with helper functions

---

## Nation and Tribe Colors

Each nation and tribe renders in **the game's own color for it**. The tables live in `src/lib/generated/civilization-colors.ts`, baked from the reference XML — do not edit that file by hand; run `npm run bake:civilization-colors` to refresh it. `src/lib/config/nations.ts` holds the accessors over them.

The two chains are not the same chain, because the game resolves a tribe's color differently from a nation's:

- **Nations** — `nation.xml` `TeamColor` → `teamColor.xml` `TeamPlayerColor` → `playerColor.xml` `AssetColor` → `color.xml` hex. `Game.getNationColor` (`Game.cs:21765`) resolves through the live `Player`, so it has no static answer; this is the nation's own team color, which is what the map, banners and crests paint.
- **Tribes** — `tribe.xml` `TeamColor` → `teamColor.xml` `aePlayerColors[0]` → `playerColor.xml` `CrestColor` → `color.xml` hex, the chain `InfoHelpers.getTribeColor` (`InfoHelpers.cs:3214`) reads. **Not** `TeamPlayerColor`, which is `PLAYERCOLOR_BARBARIANS` for every tribe — one shared near-black, not the per-tribe color the game shows.

Both tables are keyed by full zType (`NATION_EGYPT`, `TRIBE_GAULS`) and cover the campaign civs as well as the base roster below. Campaign civs reuse base colors, so duplicate hexes across civs are expected — that is what the game does. `BASE_NATIONS`, from the same module, is the base roster alone, and is what the `/stats` nation facet offers.

### Nations

The 13 the base game defines. A campaign nation (`NATION_PTOLEMY`, `NATION_THEBES`, …) resolves too; see the generated file for the full list.

| Nation        | Hex Code  | Color Description | Key                |
| ------------- | --------- | ----------------- | ------------------ |
| **Aksum**     | `#F8A3B4` | Pink/Rose         | `NATION_AKSUM`     |
| **Assyria**   | `#fadc3b` | Yellow            | `NATION_ASSYRIA`   |
| **Babylonia** | `#82C83E` | Green             | `NATION_BABYLONIA` |
| **Carthage**  | `#f6efe1` | Beige/Off-white   | `NATION_CARTHAGE`  |
| **Egypt**     | `#bc6304` | Dark Orange/Brown | `NATION_EGYPT`     |
| **Greece**    | `#2360bc` | Dark Blue         | `NATION_GREECE`    |
| **Hittite**   | `#80e3e8` | Cyan              | `NATION_HITTITE`   |
| **Kush**      | `#FFFFB6` | Light Yellow      | `NATION_KUSH`      |
| **Maurya**    | `#A749FF` | Purple            | `NATION_MAURYA`    |
| **Persia**    | `#c04e4a` | Red               | `NATION_PERSIA`    |
| **Rome**      | `#880d56` | Purple/Burgundy   | `NATION_ROME`      |
| **Tamil**     | `#00B281` | Teal/Green        | `NATION_TAMIL`     |
| **Yuezhi**    | `#AD7E00` | Mustard/Gold      | `NATION_YUEZHI`    |

### Tribes

The 11 the base game defines. The four hostile pseudo-tribes share one red, which the game gives them.

| Tribe          | Hex Code  | Color Description | Key                |
| -------------- | --------- | ----------------- | ------------------ |
| **Gauls**      | `#87db40` | Lime Green        | `TRIBE_GAULS`      |
| **Vandals**    | `#9c5dff` | Purple            | `TRIBE_VANDALS`    |
| **Danes**      | `#3ccdc2` | Teal              | `TRIBE_DANES`      |
| **Thracians**  | `#d89a18` | Orange/Gold       | `TRIBE_THRACIANS`  |
| **Scythians**  | `#e6e1ca` | Beige/Light Tan   | `TRIBE_SCYTHIANS`  |
| **Numidians**  | `#ffdd67` | Light Yellow      | `TRIBE_NUMIDIANS`  |
| **Huns**       | `#AB3157` | Dark Pink/Magenta | `TRIBE_HUNS`       |
| **Barbarians** | `#c84732` | Red               | `TRIBE_BARBARIANS` |
| **Rebels**     | `#c84732` | Red               | `TRIBE_REBELS`     |
| **Raiders**    | `#c84732` | Red               | `TRIBE_RAIDERS`    |
| **Anarchy**    | `#c84732` | Red               | `TRIBE_ANARCHY`    |

Hex case is whatever `color.xml` holds — the bake passes the value through rather than normalizing it, as `bake:family-colors` does.

### Using Nation and Tribe Colors

Go through the accessors, re-exported from the central config module. Each takes the raw enum value the backend stores or a bare key, so a caller never has to know which form it has:

```typescript
import {
	getNationColor,
	getTribeColor,
	getCivilizationColor,
	getNationChartColor,
} from "$lib/config";

const egypt = getNationColor("NATION_EGYPT"); // "#bc6304" ("EGYPT" also works)
const gauls = getTribeColor("TRIBE_GAULS"); // "#87db40"

// getCivilizationColor checks both tables, so a caller holding one of the two
// without knowing which passes it straight through.
const either = getCivilizationColor("TRIBE_GAULS"); // "#87db40"

// Chart series: getNationChartColor is the canonical helper — the nation's
// color, or a palette color by index when the nation is unknown/missing.
// Single source of truth shared by game-detail and aggregate-stats charts.
series: playerHistory.map((player, i) => ({
	name: player.player_name,
	type: "line",
	data: player.history.map((h) => h.points),
	itemStyle: { color: getNationChartColor(player.nation, i) },
}));
```

---

## Yield Colors

The sixteen series on the aggregate yields panel are colored from **Old World's own yield palette** rather than the chart palette above. They live in `src/lib/generated/yield-colors.ts`, baked from the reference XML — do not edit that file by hand; run `npm run bake:yield-colors` to refresh it.

Before this, every yield chart drew in `getChartColor(0)`, so color carried no information down a stack of sixteen charts. Coloring each series the way the game colors it makes the hue identify the yield.

| Series | Color | Source | On `#211A12` |
| --- | --- | --- | --- |
| Science | `#a16ad1` | `color.xml` `#733b9f`, lifted | 4.50:1 |
| Money | `#b4935e` | sprite (xml `#ffffff`) | 5.96:1 |
| Training | `#d15f5c` | `color.xml` `#a93b3b`, lifted | 4.51:1 |
| Civics | `#d78d46` | `color.xml` | 6.38:1 |
| Culture | `#639aad` | `color.xml` | 5.53:1 |
| Orders | `#bd976c` | sprite (xml `#ffffff`) | 6.39:1 |
| Food | `#739600` | `color.xml` | 4.99:1 |
| Growth | `#3d9f70` | `color.xml` | 5.23:1 |
| Happiness | `#f2c95e` | `color.xml` | 10.88:1 |
| Discontent | `#8f8fb3` | `color.xml` `#555475`, lifted | 5.53:1 |
| Iron | `#DBDCDB` | `color.xml` | 12.51:1 |
| Stone | `#78839a` | `color.xml` `#6B758C`, lifted | 4.51:1 |
| Wood | `#9b7d63` | `color.xml` `#80634A`, lifted | 4.51:1 |
| Maintenance | `#ee433e` | sprite (xml `#ffffff`), lifted | 4.51:1 |
| Military Power | `#dc5a43` | `COLOR_RATING_COURAGE` | 4.57:1 |
| Legitimacy | `#a7a164` | sprite (no `yield.xml` entry) | 6.49:1 |

Three rules decide that table, and each covers a case the XML alone cannot:

**The lift.** The game paints yields on its own UI, not on the chart ground. Six of its colors could not carry a 2px line there — Science at 2.34:1 and Discontent at 2.38:1 were close to invisible — so each is raised in OKLCh **lightness only**, holding hue exactly and clamping chroma only where the sRGB gamut demands it (it never has: every lift retained 100% chroma). Ten of the sixteen clear the floor untouched and are the game's colors verbatim. The floor is 4.5:1, except Discontent at 5.5:1 — at 4.5 it lands 0.022 from Stone in OKLab, effectively one color on two charts that sit two apart in the stack.

**`#ffffff` means "no color of its own."** `color.xml` gives Money, Orders and Maintenance all white, which would ship as three identical white charts. Those fall through to their icon art, which does distinguish them and carries the meaning the table drops — Maintenance is a cost, and the game draws it red. The test is exactly `#ffffff`, **not** near-white: Iron is `#DBDCDB`, a deliberate light-metal grey whose sprite is achromatic enough that sampling would replace it with a muddy dark grey.

**Military Power is not a yield.** It has no `yield.xml` entry, no sprite, and no `COLORCLASS_YIELDS` color; the token appears nowhere in the game XML. It is a per-ankh series over a derived stat, so it borrows `COLOR_RATING_COURAGE` and is exported separately as `MILITARY_POWER_COLOR` — keeping `YIELD_COLORS` keyed only by tokens the game actually has.

### Where yield colors apply

The yield palette colors **every chart on the three aggregate-stats surfaces** — the profile stats tab, `/stats`, and tournament stats — not just the yields panel. What varies is what a color is being asked to say.

**Color names the yield.** The pooled median line and its P25–P75 band on `YieldsStatsPanel`, one color per series. This is the original case: sixteen charts in a stack, and the hue tells you which yield you are looking at.

**Color names the outcome.** A wins-vs-losses split takes `WIN_COLOR` / `LOSS_COLOR` — Growth against `COLOR_RATING_COURAGE`, the red the bake exports as `MILITARY_POWER_COLOR`. Green-against-red is the split readers already know, and it is 0.256 apart in OKLab, but hue is where it spends that distance: 0.073 deuteranopic and 0.125 protanopic, under the 0.140 floor the palette holds elsewhere. Position and text carry the reading there — wins are always the first stack segment, and every one of these charts names the cohort in its tooltip. That pair is shared by every chart that splits by outcome, so the cohorts mean the same thing everywhere: the nation win-rate bar, the leader archetype and trait bars, both family bars, and the yields panel's own split mode. The wonders chart buckets an outcome three ways instead of two, and takes the same pair for the outer two — a bucket meaning "mostly won" is the same claim as a wins segment, so it is the same green — with Culture as the middle fill (`OUTCOME_MIXED`) for the bucket that is neither. That triple is tighter than the pair it extends: worst pair 0.107 in OKLab (Growth/Culture), and deuteranopic the worst is still green-to-red at 0.073. Fixed order and text carry it there too — the wonders chart is the one chart with its legend on, and its tooltip spells the rate out with its sample.

**Color names the nation.** The nation average-points bar gives every bar its own nation color via `getNationChartColor`, the same helper the game-detail and tournament charts use, so a nation looks the same everywhere. It is the one chart on that tab where a row is only ever itself — the win-rate bar above it splits by outcome instead. These are the game's faction colors and were never held to the yield bake's contrast floor: five sit under 4.5:1 on the chart ground, Rome (`#880D56`) lowest at 1.83:1.

**Color keeps the rows apart.** Where a chart is a list of categories rather than a split or a single series, every bar takes its own `SERIES_COLORS` entry: both Laws charts (adoption, opening sequences), both Tech charts (first tech, tech timing), the Cities expansion chart, and the tournament standings and caster bars. This replaced a `getChartColor(i)` rotation of six near-identical browns, whose closest pair was indistinguishable.

Cities is the only one of these that fits inside the palette — seven buckets against eight colors. The rest lap it: a 25-row tech or law chart goes round three times. That is what the cyclic ordering is for. Because adjacent indices are maximally far apart *including the wrap from 7 back to 0*, a bar never sits beside a near-twin of itself and the seam where the rotation restarts contrasts as hard as any other step.

One place deliberately opts out:

- **The game-detail Yields tab** draws one line per player and colors by nation (`getPlayerColor`). Color already means player there.

And one place deliberately keeps a palette color: the **sample-size overlay** on `YieldsStatsPanel` draws in `getChartColor(5)`. It counts games, not a yield, so staying outside the yield palette is the point.

```typescript
import { MILITARY_POWER_COLOR, YIELD_COLORS } from "$lib/generated/yield-colors";

const science = YIELD_COLORS.YIELD_SCIENCE; // "#a16ad1"
```

`YIELD_COLORS` is emitted `as const satisfies Readonly<Record<string, string>>`, so a mistyped `YIELD_*` key is a compile error rather than an `undefined` that silently falls back to the theme palette. (`FAMILY_COLORS` keeps a plain `Record` shape — it is indexed by a runtime zType, where an index signature is what you want.)

## Design Notes

The overall color scheme combines warm, earthy tones (browns, oranges, tans) with a cool blue-gray background. This palette is fitting for an application themed around Old World game analytics, evoking ancient Egyptian aesthetics where "Per-Ankh" means "House of Life" in ancient Egyptian.

Nation and tribe colors are chosen to:

- Provide clear visual distinction between civilizations in multi-player charts
- Balance aesthetic appeal with functional readability
- Avoid colors that are too similar when displayed together
