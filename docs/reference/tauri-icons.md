# Tauri Icon Requirements

## Overview

Tauri applications require icon files in multiple formats and sizes to support different platforms (macOS, Windows, Linux) and display contexts (window icon, dock/taskbar, file associations, etc.).

## Required Icon Files

The icon files are located in `src-tauri/icons/` and referenced in `src-tauri/tauri.conf.json`.

### Core Icons (specified in tauri.conf.json)

```json
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico"
]
```

- **32x32.png** - Small icon for Windows taskbar, Linux panels
- **128x128.png** - Standard resolution icon for macOS dock, app lists
- **128x128@2x.png** - High DPI (Retina) version for macOS
- **icon.icns** - macOS icon bundle (contains multiple sizes)
- **icon.ico** - Windows icon bundle (contains multiple sizes)

### Additional Platform Icons

The `src-tauri/icons/` directory also contains Windows Store/UWP icons:
- Square30x30Logo.png
- Square44x44Logo.png
- Square71x71Logo.png
- Square89x89Logo.png
- Square107x107Logo.png
- Square142x142Logo.png
- Square150x150Logo.png
- Square284x284Logo.png
- Square310x310Logo.png
- StoreLogo.png

## Icon Design Guidelines

### General Principles
- **Simple and clear**: Icons should be recognizable at small sizes
- **High contrast**: Ensure visibility across light and dark backgrounds
- **No fine details**: Avoid thin lines or small elements that disappear at small sizes
- **Square canvas**: Design on a square canvas (typically 512x512 or 1024x1024)
- **Safe margins**: Keep important elements within 80% of the canvas to account for rounding/masking

### Platform-Specific Considerations

**macOS (.icns)**
- Rounded corners are applied by the system
- Support for dark mode variants (optional)
- Includes sizes: 16x16, 32x32, 64x64, 128x128, 256x256, 512x512, 1024x1024

**Windows (.ico)**
- Sharp corners (no rounding)
- Includes sizes: 16x16, 32x32, 48x48, 64x64, 128x128, 256x256
- Consider background transparency carefully

**Linux (.png)**
- Usually displayed without modification
- Various desktop environments may apply different effects

## Using 𓉑 (Egyptian Hieroglyph) for Per-Ankh Icon

### Design Approach

The Egyptian hieroglyph 𓉑 (U+13251) is used for the Per-Ankh application icon due to its:
- Strong symbolic connection to the app name ("Per-Ankh" = "House of Life")
- Simple, recognizable shape that scales well
- Historical significance related to Ancient Egypt/Old World theme
- Authentic hieroglyphic representation

**Note:** The application previously used the ankh symbol (☥ U+2625) but was updated to use the more authentic Egyptian hieroglyph 𓉑 (U+13251) for better visual representation.

### Recommended Design Process

1. **Create master icon** (1024x1024 PNG):
   - Center the Egyptian hieroglyph (𓉑)
   - Use bold, clean lines (minimum 20-30px stroke width at 1024px)
   - Consider adding a subtle background shape or color
   - Test visibility at small sizes (reduce to 32x32 to verify legibility)

2. **Color scheme options**:
   - Single color (white or accent color) on solid background
   - Gradient following app's color scheme
   - Subtle texture or pattern in background

3. **Generate icon bundle** using Tauri CLI:
   ```bash
   npm run tauri icon /path/to/source-icon.png
   ```

   This command automatically generates all required formats and sizes.

### Tools for Icon Creation

**Design Tools:**
- **Figma** - Free, web-based, excellent for vector design
- **Inkscape** - Free, open-source vector graphics editor
- **Adobe Illustrator** - Professional vector design (paid)
- **Affinity Designer** - One-time purchase, professional-grade

**AI Generation:**
- Claude, ChatGPT with DALL-E, Midjourney, etc. can generate icon designs
- Prompt example: "Create a minimalist app icon featuring an Egyptian hieroglyph (house/per-ankh symbol 𓉑), bold lines, simple geometric design, suitable for 1024x1024 resolution"

**Icon Conversion:**
- **Tauri CLI icon generator** (built-in): `npm run tauri icon`
- **ImageMagick**: Command-line image manipulation
- **CloudConvert**: Online format conversion

## Updating Icons

### Quick Update Process

1. Design/obtain new 1024x1024 PNG icon
2. Run Tauri icon generator:
   ```bash
   npm run tauri icon path/to/new-icon.png
   ```
3. Generator outputs all required formats to `src-tauri/icons/`
4. Rebuild application to see changes:
   ```bash
   npm run tauri build
   ```

### Manual Update (if needed)

If you have pre-made icons in various formats:
1. Replace files in `src-tauri/icons/`
2. Ensure filenames match those in `tauri.conf.json`
3. Rebuild application

## Testing Icons

- **Development**: Icons appear in window titlebar and dock/taskbar while running `npm run tauri dev`
- **Production**: After `npm run tauri build`, test the bundled application (.app, .exe, etc.)
- **Multiple sizes**: Test on both standard and high-DPI displays
- **Backgrounds**: Verify icon visibility on light and dark system themes

## References

- [Tauri Icon Configuration Docs](https://tauri.app/v1/guides/features/icons/)
- [Apple Human Interface Guidelines - App Icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)
- [Windows App Icon Design](https://learn.microsoft.com/en-us/windows/apps/design/style/iconography/app-icon-design)
