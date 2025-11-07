# Color Scheme Reference

This document defines the color palette used throughout the Per-Ankh application.

## Color Palette

The application's color scheme is defined in `src/app.css:6-14` using CSS custom properties.

| Color | Hex Code | CSS Variable |
|-------|----------|--------------|
| **Black** | `#000000` | `--color-black` |
| **Brown** | `#A52A2A` | `--color-brown` |
| **Orange** | `#FFA500` | `--color-orange` |
| **Tan** | `#D2B48C` | `--color-tan` |
| **White** | `#FFFFFF` | `--color-white` |
| **Yellow** | `#FFFF00` | `--color-yellow` |
| **Blue-Gray** | `#4A5568` | `--color-blue-gray` |

## Default Theme

The application uses the following default colors:

- **Background**: Blue-Gray (`#4A5568` / `var(--color-blue-gray)`)
- **Text**: White (`#FFFFFF` / `var(--color-white)`)

## Usage

To use these colors in your components, reference the CSS variables:

```css
/* Example usage */
.my-element {
  background-color: var(--color-brown);
  color: var(--color-tan);
}
```

## Design Notes

The color scheme combines warm, earthy tones (brown, tan, orange, yellow) with a cool blue-gray background. This palette is fitting for an application themed around Old World game analytics, evoking ancient Egyptian aesthetics where "Per-Ankh" means "House of Life" in ancient Egyptian.
