# Color Scheme Reference

This document defines the color palettes used throughout the Per-Ankh application.

## UI Color Palette

The application's UI color scheme is defined in `src/app.css:6-17` using CSS custom properties (the single source of truth). Tailwind CSS is configured to reference these variables in `tailwind.config.js`.

| Color           | Hex Code  | CSS Variable          | Tailwind Class                              | Usage                    |
| --------------- | --------- | --------------------- | ------------------------------------------- | ------------------------ |
| **Black**       | `#000000` | `--color-black`       | `bg-black`, `text-black`, `border-black`    | Borders, outlines, text  |
| **Brown**       | `#A52A2A` | `--color-brown`       | `bg-brown`, `text-brown`, `border-brown`    | Labels, accents          |
| **Orange**      | `#FFA500` | `--color-orange`      | `bg-orange`, `text-orange`, `border-orange` | Highlights, borders      |
| **Tan**         | `#D2B48C` | `--color-tan`         | `bg-tan`, `text-tan`, `border-tan`          | Tabs, backgrounds        |
| **Tan Hover**   | `#dfcaae` | `--color-tan-hover`   | `bg-tan-hover`, `hover:bg-tan-hover`        | Hover states             |
| **White**       | `#FFFFFF` | `--color-white`       | `bg-white`, `text-white`, `border-white`    | Text on dark backgrounds |
| **Yellow**      | `#FFFF00` | `--color-yellow`      | `bg-yellow`, `text-yellow`, `border-yellow` | Reserved for future use  |
| **Blue-Gray**   | `#211A12` | `--color-blue-gray`   | `bg-blue-gray`                              | Main background          |
| **Border Gray** | `#1C160F` | `--color-border-gray` | `bg-border-gray`, `border-border-gray`      | Alternative borders      |
| **Gray 200**    | `#eeeeee` | `--color-gray-200`    | `bg-gray-200`, `text-gray-200`              | Light backgrounds        |

### Default Theme

The application uses the following default colors:

- **Background**: Blue-Gray (`#211A12` / `var(--color-blue-gray)`)
- **Text**: White (`#FFFFFF` / `var(--color-white)`)

### Using UI Colors

**Best Practice**: Use Tailwind classes in your Svelte components for consistency:

```svelte
<!-- Example: Using Tailwind classes -->
<div class="border-2 border-black bg-brown text-tan">Content here</div>
```

For custom CSS where Tailwind isn't available, reference the CSS variables directly:

```css
/* Example: Custom scrollbar styling */
.custom-scrollbar::-webkit-scrollbar-thumb {
	background: var(--color-tan);
}
```

---

## Chart Color Palette

The application uses a separate color palette for data visualization in charts. This palette is defined in `src/lib/config/charts.ts` and optimized for multi-series data visualization using Apache ECharts.

| Color Name         | Hex Code  | Export            |
| ------------------ | --------- | ----------------- |
| **Copper**         | `#C87941` | `CHART_COLORS[0]` |
| **Saddle Brown**   | `#8B4513` | `CHART_COLORS[1]` |
| **Peru**           | `#CD853F` | `CHART_COLORS[2]` |
| **Sienna**         | `#A0522D` | `CHART_COLORS[3]` |
| **Chocolate**      | `#D2691E` | `CHART_COLORS[4]` |
| **Dark Goldenrod** | `#B8860B` | `CHART_COLORS[5]` |

### Using Chart Colors

Import chart colors and theme from the config module:

```typescript
import { CHART_COLORS, CHART_THEME, getChartColor } from "$lib/config";

// Use individual colors directly
const color = CHART_COLORS[0]; // "#C87941"

// Use the helper function for automatic wrapping (RECOMMENDED)
const color = getChartColor(7); // Wraps to CHART_COLORS[1]

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

The application maintains two distinct color palettes for different purposes:

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

The application uses specific colors for each Old World nation and tribe. These colors are defined in `src/lib/config/nations.ts` and are used in charts and visualizations to represent different civilizations.

### Nations

| Nation        | Hex Code  | Color Description | Export                    |
| ------------- | --------- | ----------------- | ------------------------- |
| **Aksum**     | `#F8A3B4` | Pink/Rose         | `NATION_COLORS.AKSUM`     |
| **Assyria**   | `#FADC3B` | Yellow            | `NATION_COLORS.ASSYRIA`   |
| **Babylonia** | `#82C83E` | Green             | `NATION_COLORS.BABYLONIA` |
| **Carthage**  | `#F6EFE1` | Beige/Off-white   | `NATION_COLORS.CARTHAGE`  |
| **Egypt**     | `#BC6304` | Dark Orange/Brown | `NATION_COLORS.EGYPT`     |
| **Greece**    | `#2360BC` | Dark Blue         | `NATION_COLORS.GREECE`    |
| **Hittite**   | `#80E3E8` | Cyan              | `NATION_COLORS.HITTITE`   |
| **Kush**      | `#FFFFB6` | Light Yellow      | `NATION_COLORS.KUSH`      |
| **Persia**    | `#C04E4A` | Red               | `NATION_COLORS.PERSIA`    |
| **Rome**      | `#880D56` | Purple/Burgundy   | `NATION_COLORS.ROME`      |

### Tribes

| Tribe         | Hex Code  | Color Description | Export                   |
| ------------- | --------- | ----------------- | ------------------------ |
| **Gauls**     | `#C84732` | Red-Orange        | `TRIBE_COLORS.GAULS`     |
| **Vandals**   | `#87DB40` | Lime Green        | `TRIBE_COLORS.VANDALS`   |
| **Danes**     | `#9C5DFF` | Purple            | `TRIBE_COLORS.DANES`     |
| **Thracians** | `#3CCDC2` | Teal              | `TRIBE_COLORS.THRACIANS` |
| **Scythians** | `#D89A18` | Orange/Gold       | `TRIBE_COLORS.SCYTHIANS` |
| **Numidians** | `#E6E1CA` | Beige/Light Tan   | `TRIBE_COLORS.NUMIDIANS` |

### Using Nation and Tribe Colors

Import from the central config module:

```typescript
import {
	NATION_COLORS,
	TRIBE_COLORS,
	getNationColor,
	getCivilizationColor,
} from "$lib/config";

// Use directly with type safety
const egyptColor = NATION_COLORS.EGYPT; // "#BC6304"
const gaulsColor = TRIBE_COLORS.GAULS; // "#C84732"

// Use helper functions (handles string conversion and lookup)
const color = getNationColor("EGYPT"); // "#BC6304"
const color2 = getCivilizationColor("GAULS"); // "#C84732" (checks both nations and tribes)

// Example: Use in chart series
series: playerHistory.map((player, i) => ({
	name: player.player_name,
	type: "line",
	data: player.history.map((h) => h.points),
	itemStyle: { color: getCivilizationColor(player.nation) ?? getChartColor(i) },
}));
```

---

## Design Notes

The overall color scheme combines warm, earthy tones (browns, oranges, tans) with a cool blue-gray background. This palette is fitting for an application themed around Old World game analytics, evoking ancient Egyptian aesthetics where "Per-Ankh" means "House of Life" in ancient Egyptian.

Nation and tribe colors are chosen to:

- Provide clear visual distinction between civilizations in multi-player charts
- Balance aesthetic appeal with functional readability
- Avoid colors that are too similar when displayed together
