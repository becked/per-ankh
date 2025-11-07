# Color Scheme Reference

This document defines the color palettes used throughout the Per-Ankh application.

## UI Color Palette

The application's UI color scheme is defined in `src/app.css:6-14` using CSS custom properties. These colors are used for backgrounds, borders, text, and general interface elements.

| Color | Hex Code | CSS Variable | Usage |
|-------|----------|--------------|-------|
| **Black** | `#000000` | `--color-black` | Borders, outlines |
| **Brown** | `#A52A2A` | `--color-brown` | Labels, accents |
| **Orange** | `#FFA500` | `--color-orange` | Highlights, borders |
| **Tan** | `#D2B48C` | `--color-tan` | Tabs, hover states |
| **White** | `#FFFFFF` | `--color-white` | Text on dark backgrounds |
| **Yellow** | `#FFFF00` | `--color-yellow` | Reserved for future use |
| **Blue-Gray** | `#4A5568` | `--color-blue-gray` | Main background |

### Default Theme

The application uses the following default colors:

- **Background**: Blue-Gray (`#4A5568` / `var(--color-blue-gray)`)
- **Text**: White (`#FFFFFF` / `var(--color-white)`)

### Using UI Colors

To use these colors in your components, reference the CSS variables:

```css
/* Example usage */
.my-element {
  background-color: var(--color-brown);
  color: var(--color-tan);
}
```

---

## Chart Color Palette

The application uses a separate color palette for data visualization in charts. This palette is defined in `src/lib/config/charts.ts` and optimized for multi-series data visualization using Apache ECharts.

| Color Name | Hex Code | Export |
|------------|----------|--------|
| **Copper** | `#C87941` | `CHART_COLORS[0]` |
| **Saddle Brown** | `#8B4513` | `CHART_COLORS[1]` |
| **Peru** | `#CD853F` | `CHART_COLORS[2]` |
| **Sienna** | `#A0522D` | `CHART_COLORS[3]` |
| **Chocolate** | `#D2691E` | `CHART_COLORS[4]` |
| **Dark Goldenrod** | `#B8860B` | `CHART_COLORS[5]` |

### Using Chart Colors

Import the chart colors in your TypeScript/Svelte components:

```typescript
import { CHART_COLORS, getChartColor } from "$lib/config/charts";

// Use directly
const color = CHART_COLORS[0]; // "#C87941"

// Or use the helper function for automatic wrapping
const color = getChartColor(7); // Wraps to CHART_COLORS[1]
```

### Design Rationale: Why Separate Palettes?

The application maintains two distinct color palettes for different purposes:

1. **UI Palette** - For interface elements (backgrounds, borders, text)
   - Fixed set of 7 colors with semantic meaning
   - Optimized for UI consistency and branding

2. **Chart Palette** - For data visualization
   - Optimized for visual distinction between data series
   - Higher contrast requirements for readability
   - Needs more variation for multi-player scenarios (6+ colors)
   - Color selection based on perceptual difference rather than branding

---

## Nation and Tribe Colors

The application uses specific colors for each Old World nation and tribe. These colors are defined in `src/lib/config/nations.ts` and are used in charts and visualizations to represent different civilizations.

### Nations

| Nation | Hex Code | Color Description | Export |
|--------|----------|-------------------|--------|
| **Aksum** | `#F8A3B4` | Pink/Rose | `NATION_COLORS.AKSUM` |
| **Assyria** | `#FADC3B` | Yellow | `NATION_COLORS.ASSYRIA` |
| **Babylon** | `#82C83E` | Green | `NATION_COLORS.BABYLON` |
| **Carthage** | `#F6EFE1` | Beige/Off-white | `NATION_COLORS.CARTHAGE` |
| **Egypt** | `#BC6304` | Dark Orange/Brown | `NATION_COLORS.EGYPT` |
| **Greece** | `#2360BC` | Dark Blue | `NATION_COLORS.GREECE` |
| **Hittite** | `#80E3E8` | Cyan | `NATION_COLORS.HITTITE` |
| **Kush** | `#FFFFB6` | Light Yellow | `NATION_COLORS.KUSH` |
| **Persia** | `#C04E4A` | Red | `NATION_COLORS.PERSIA` |
| **Rome** | `#880D56` | Purple/Burgundy | `NATION_COLORS.ROME` |

### Tribes

| Tribe | Hex Code | Color Description | Export |
|-------|----------|-------------------|--------|
| **Gauls** | `#C84732` | Red-Orange | `TRIBE_COLORS.GAULS` |
| **Vandals** | `#87DB40` | Lime Green | `TRIBE_COLORS.VANDALS` |
| **Danes** | `#9C5DFF` | Purple | `TRIBE_COLORS.DANES` |
| **Thracians** | `#3CCDC2` | Teal | `TRIBE_COLORS.THRACIANS` |
| **Scythians** | `#D89A18` | Orange/Gold | `TRIBE_COLORS.SCYTHIANS` |
| **Numidians** | `#E6E1CA` | Beige/Light Tan | `TRIBE_COLORS.NUMIDIANS` |

### Using Nation and Tribe Colors

Import the colors in your TypeScript/Svelte components:

```typescript
import { NATION_COLORS, TRIBE_COLORS, getNationColor, getCivilizationColor } from "$lib/config/nations";

// Use directly
const egyptColor = NATION_COLORS.EGYPT; // "#BC6304"
const gaulsColor = TRIBE_COLORS.GAULS; // "#C84732"

// Or use helper functions
const color = getNationColor("EGYPT"); // "#BC6304"
const color2 = getCivilizationColor("GAULS"); // "#C84732" (checks both nations and tribes)
```

---

## Design Notes

The overall color scheme combines warm, earthy tones (browns, oranges, tans) with a cool blue-gray background. This palette is fitting for an application themed around Old World game analytics, evoking ancient Egyptian aesthetics where "Per-Ankh" means "House of Life" in ancient Egyptian.

Nation and tribe colors are chosen to:
- Provide clear visual distinction between civilizations in multi-player charts
- Balance aesthetic appeal with functional readability
- Avoid colors that are too similar when displayed together
