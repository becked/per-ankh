# Bundle Egyptian Hieroglyph Font

## Problem

On Linux systems, Egyptian hieroglyphs in the ImportModal display as boxes (□) instead of the intended characters. This occurs because most Linux distributions don't include fonts that support the Unicode Egyptian Hieroglyphs block (U+13000–U+1342F) by default.

**Affected component:** `src/lib/HieroglyphParade.svelte`

**Current behavior:**
- macOS: Works (system fonts have some coverage)
- Windows: Works (Segoe UI Historic provides support)
- Linux: Shows boxes (no default hieroglyph font)

## Solution

Bundle Noto Sans Egyptian Hieroglyphs font directly in the application to guarantee consistent rendering across all platforms.

## Implementation Plan

### Step 1: Install Font Package

Install the Fontsource package for Noto Sans Egyptian Hieroglyphs:

```bash
npm install @fontsource/noto-sans-egyptian-hieroglyphs
```

**Why Fontsource:**
- npm-managed, easy to update
- Optimized for web bundling (~250KB)
- Vite/SvelteKit handles it automatically
- No manual file management

### Step 2: Import Font in Component

Add font import to `src/lib/HieroglyphParade.svelte` in the `<style>` section (line 201):

```svelte
<style>
  @import '@fontsource/noto-sans-egyptian-hieroglyphs';

  .parade-container {
    /* existing styles */
  }

  /* ... rest of styles ... */
</style>
```

**Why scoped to component:**
- Font only loads when ImportModal is used
- Minimizes bundle size impact
- Keeps font usage localized to where it's needed

### Step 3: Update Font Stack

Update the font-family declarations for hieroglyph-rendering elements in `src/lib/HieroglyphParade.svelte` (lines 230-241 and 253-267):

```css
.parade-item {
  position: absolute;
  font-size: 1.2rem;
  color: var(--color-tan);
  opacity: 0.9;
  font-family: "Noto Sans Egyptian Hieroglyphs", sans-serif; /* ADD THIS LINE */
  animation: parade-march 20s linear forwards;
  right: -2.4rem;
  white-space: nowrap;
  line-height: 1;
}

.hieroglyph-border {
  position: absolute;
  top: 4.5rem;
  left: 1rem;
  right: 1rem;
  font-size: 0.5rem;
  color: var(--color-tan);
  opacity: 0.7;
  font-family: "Noto Sans Egyptian Hieroglyphs", sans-serif; /* ADD THIS LINE */
  white-space: nowrap;
  overflow: hidden;
  pointer-events: none;
  z-index: 10;
  letter-spacing: 0.15em;
  line-height: 1;
}
```

**Why explicit font-family:**
- Ensures hieroglyphs use the bundled font
- Prevents fallback to system fonts that might not have coverage
- Clear intent in the code

### Step 4: Test Across Platforms

**Development testing:**

1. Run dev server:
   ```bash
   npm run tauri:dev
   ```

2. Open ImportModal and verify hieroglyphs render correctly

3. Test that font loads (check browser DevTools Network tab):
   - Should see font file load when modal opens
   - File size should be ~200-300KB

**Build testing:**

1. Create production build:
   ```bash
   npm run tauri:build
   ```

2. Test on each platform:
   - **Linux**: Verify hieroglyphs display without requiring `fonts-noto-extra`
   - **macOS**: Verify still works (should use bundled font)
   - **Windows**: Verify still works (should use bundled font)

3. Verify bundle size increase is acceptable:
   - Check `build/` directory size
   - Font should add ~250KB to total bundle

**What to verify:**
- ✅ Static border hieroglyphs display correctly (lines 187, 199)
- ✅ Animated parade hieroglyphs display correctly (lines 191-196)
- ✅ No "tofu" boxes (□) on any platform
- ✅ Performance is acceptable (no lag during animation)
- ✅ Bundle size increase is reasonable

### Step 5: Update Documentation

After successful implementation, update user-facing documentation if needed. Since the fix is transparent to users (font is bundled), no user action or documentation changes should be required.

## Technical Details

### How It Works

1. **@fontsource package** provides pre-packaged font files optimized for web
2. **@import in component** tells Vite to bundle the font CSS
3. **Vite build process** extracts font files, generates hashed filenames
4. **SvelteKit adapter-static** copies bundled assets to `build/`
5. **Tauri build** embeds `build/` contents in native executable
6. **Runtime** loads font from embedded assets (works offline)

### Font Characteristics

- **Name:** Noto Sans Egyptian Hieroglyphs
- **Coverage:** 1,079 glyphs from Unicode block U+13000–U+1342F
- **License:** SIL Open Font License 1.1 (OFL-1.1)
- **File size:** ~200-300KB (only hieroglyph subset)
- **Source:** Google Noto Fonts project

### Alternative Approaches Considered

**Option: Bundle font in static/ folder**
- Requires manual download and updates
- More complex @font-face declaration
- ❌ Rejected: Less maintainable than npm package

**Option: Add font to global app.css**
- Font loads immediately on app start
- Impacts startup time for unused feature
- ❌ Rejected: Component-scoped is more efficient

**Option: Require users to install system font**
- No bundle size impact
- ❌ Rejected: Poor user experience, fragmentation across platforms

## Verification Checklist

- [ ] Font package installed in package.json dependencies
- [ ] @import added to HieroglyphParade.svelte
- [ ] font-family added to .parade-item
- [ ] font-family added to .hieroglyph-border
- [ ] Tested in dev mode (hieroglyphs render)
- [ ] Tested production build on Linux
- [ ] Tested production build on macOS
- [ ] Tested production build on Windows
- [ ] Verified bundle size increase (~250KB)
- [ ] No console errors or warnings

## References

- [Noto Sans Egyptian Hieroglyphs - Google Fonts](https://fonts.google.com/noto/specimen/Noto+Sans+Egyptian+Hieroglyphs)
- [Fontsource Package](https://www.npmjs.com/package/@fontsource/noto-sans-egyptian-hieroglyphs)
- [Noto Fonts GitHub](https://github.com/notofonts/egyptian-hieroglyphs)
- [Unicode Egyptian Hieroglyphs Block](https://unicode.org/charts/PDF/U13000.pdf)
