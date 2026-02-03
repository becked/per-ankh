# Native Window Chrome Proposal

## Overview

This document proposes updating Per-Ankh's UI to use native-style window chrome, inspired by Apple's Messages app design where the sidebar extends into the title bar area. This would give the application a more polished, platform-native appearance.

## Current State

Per-Ankh currently uses Tauri's default window decorations with a standard title bar and sidebar below it. While functional, this creates visual separation between the title bar and application content.

## Proposed Design

### macOS Design (Primary Target)

Adopt the Messages.app aesthetic:

- Sidebar extends to the top of the window
- macOS traffic lights (red/yellow/green) positioned in the sidebar area
- Translucent sidebar background with blur effect
- Custom drag region for window movement
- No traditional title bar separation

**Visual Reference:** See `assets/messages-ui-reference.png` (screenshot provided)

### Windows Design (Secondary)

Adapted design for Windows platform:

- Sidebar extends to top with custom title bar
- Custom window control buttons (minimize/maximize/close) positioned top-right
- Support for Windows 11 snap layouts (hover-over-maximize)
- Optional: Mica or Acrylic backdrop effects for modern Windows 11 aesthetic
- Match Windows design language (sharper corners, different spacing)

### Linux Design (Future Consideration)

Linux support would require additional research due to varying desktop environments (GNOME, KDE, etc.). Consider standard title bar for initial Linux support.

## Technical Implementation

### Tauri Configuration Changes

**File:** `src-tauri/tauri.conf.json`

```json
{
	"tauri": {
		"windows": [
			{
				"decorations": false,
				"transparent": true,
				"titleBarStyle": "Overlay"
			}
		]
	}
}
```

### Frontend Components Required

1. **Custom Title Bar Component**
   - Platform detection logic
   - Drag region definition using `data-tauri-drag-region`
   - macOS: Traffic light positioning (typically 20px from top/left)
   - Windows: Custom control buttons with proper functionality

2. **Updated Sidebar Component**
   - Extended height to include title bar area
   - Platform-specific spacing for window controls
   - Translucent/blur background effects

3. **Platform Detection Utility**
   - Runtime OS detection
   - Conditional styling/layout based on platform
   - TypeScript type guards for platform-specific code

### Technical Considerations

**Challenges:**

- Accurate traffic light positioning on macOS (Apple's exact spacing)
- Implementing translucent blur effects (CSS `backdrop-filter` or native APIs)
- Ensuring drag regions don't interfere with sidebar interactions
- Dark mode support (matching system appearance)
- Windows snap layouts integration (requires specific window message handling)

**Risks:**

- Increased complexity in window management code
- Platform-specific bugs harder to test without all OS environments
- Potential accessibility issues with custom window controls
- Breaking changes if Tauri's window API evolves

## User Experience Impact

### Benefits

1. **More Native Feel**
   - Application feels like a first-class native app
   - Follows platform conventions users expect
   - Professional polish

2. **Better Space Utilization**
   - Sidebar uses title bar area
   - More vertical space for content
   - Cleaner visual hierarchy

3. **Platform Differentiation**
   - macOS users get macOS-style chrome
   - Windows users get Windows-style chrome
   - Each platform feels "at home"

### Potential Concerns

1. **Familiarity**
   - Windows users may not expect left-side window controls (keep them right-side)
   - Custom controls need to behave exactly like native ones

2. **Accessibility**
   - Custom window controls must be keyboard navigable
   - Screen readers must properly announce window control buttons
   - High contrast modes must be supported

3. **Development Time**
   - Non-trivial implementation effort
   - Testing across multiple OS versions (macOS 12/13/14, Windows 10/11)
   - Ongoing maintenance as Tauri/OS APIs evolve

## Implementation Strategy

### Phase 1: macOS Prototype

- Implement macOS-style window chrome
- Test on macOS 12, 13, and 14
- Validate translucent effects and traffic light positioning
- Gather internal feedback

### Phase 2: Windows Adaptation

- Design Windows-specific layout (right-side controls)
- Implement custom window control buttons
- Test snap layouts and window management
- Test on Windows 10 and 11

### Phase 3: Refinement

- Dark mode support and testing
- Accessibility audit and improvements
- Performance optimization (blur effects can be expensive)
- User testing with target audience

### Phase 4: Linux (Optional)

- Research desktop environment requirements
- Implement fallback to standard decorations
- Test on Ubuntu/Fedora with GNOME and KDE

## Alternative Approaches

### Option 1: Platform-Specific Builds

- macOS gets native chrome
- Windows/Linux keep standard decorations
- Reduces complexity, focuses effort where most impactful

### Option 2: User Preference Toggle

- Let users choose between native chrome and standard title bar
- Adds complexity but gives users control
- Could be feature flag initially for beta testing

### Option 3: Defer Until Post-MVP

- Ship with standard decorations initially
- Add native chrome in v2.0 after core features stable
- Reduces risk during initial development

## Recommendation

**Proposed Approach:**

1. Start with **macOS-only** implementation (Phase 1)
2. Use feature flag to toggle between native and standard chrome
3. Gather user feedback before committing to full cross-platform implementation
4. Evaluate Windows adaptation (Phase 2) based on macOS feedback

**Rationale:**

- macOS implementation is more straightforward (traffic lights are native)
- Feature flag allows safe rollout and A/B testing
- Can validate user interest before investing in Windows/Linux
- Since app is still in development, now is the time to experiment

## Resources

### Tauri Documentation

- [Custom Title Bar](https://tauri.app/v1/guides/features/window-customization)
- [Window Configuration](https://tauri.app/v1/api/config/#windowconfig)

### Design References

- Apple Messages app (macOS)
- Apple Music app (similar sidebar design)
- Microsoft Teams (Windows custom chrome example)

### Technical Examples

- [tauri-plugin-vibrancy](https://github.com/tauri-apps/tauri-plugin-vibrancy) - Translucent window effects
- Community examples in Tauri showcase

## Open Questions

1. **Performance:** How do blur effects impact performance on older hardware?
2. **Accessibility:** What specific WCAG requirements apply to custom window controls?
3. **Testing:** Do we have access to all target OS versions for testing?
4. **User Research:** Have we validated that target users value native appearance?
5. **Maintenance:** What's the ongoing maintenance burden of platform-specific code?

## Decision Required

- [ ] Approve macOS prototype implementation
- [ ] Approve full cross-platform implementation
- [ ] Approve alternative approach (specify)
- [ ] Defer to future release
- [ ] Reject proposal

## Next Steps (If Approved)

1. Create detailed technical design document
2. Set up feature flag infrastructure
3. Implement macOS prototype
4. Internal testing and feedback
5. Iterate based on findings

---

**Document Author:** Claude
**Date:** 2025-11-10
**Status:** Proposal - Awaiting PM/Tech Lead Review
