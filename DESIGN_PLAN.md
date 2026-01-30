# Cortex iOS Design System Refresh
## Apple Blue Theme + Light/Dark Mode + Glass Effects

**Version:** 1.0
**Date:** January 2025
**Status:** Planning

---

## Executive Summary

Transform Cortex from a purple-accented dark-only app to a polished, Apple-native experience with:
- **Apple Blue (#007AFF)** as the primary accent
- **True Light/Dark mode** with system-follow option
- **Liquid Glass effects** where supported (iOS 26+) with graceful fallbacks
- **iOS Human Interface Guidelines** compliance

---

## Research Findings

### 1. Apple Blue Color Analysis

| Property | Light Mode | Dark Mode |
|----------|------------|-----------|
| Accent | `#007AFF` | `#0A84FF` |
| Contrast vs White | 4.02:1 | 3.78:1 |
| WCAG AA (Large Text) | ✅ Pass | ✅ Pass |
| WCAG AA (Normal Text) | ❌ Fail | ❌ Fail |

**Implication:** Apple Blue is suitable for:
- ✅ Buttons, links, icons, interactive elements
- ✅ Large text (17pt+ bold, 14pt+ semibold)
- ❌ NOT for body text - use high contrast text colors

**Sources:**
- [WebAIM Contrast Guidelines](https://webaim.org/articles/contrast/)
- [Colour Contrast Checker](https://colourcontrast.cc/)

### 2. Expo Glass Effect SDK

| Requirement | Status |
|-------------|--------|
| Minimum iOS | **iOS 26** |
| Components | `GlassView`, `GlassContainer` |
| Fallback | Automatic to regular `View` |
| Props | `glassEffectStyle`, `isInteractive`, `tintColor` |

**Key Limitations:**
- `isInteractive` cannot change after mount
- Avoid `opacity < 1.0` on GlassView or parents
- Some iOS 26 betas lack the Liquid Glass API

**Runtime Checks:**
```typescript
import { isLiquidGlassAvailable, isGlassEffectAPIAvailable } from 'expo-glass-effect';

// Check before rendering glass effects
const canUseGlass = isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
```

**Source:** [Expo Glass Effect Documentation](https://docs.expo.dev/versions/latest/sdk/glass-effect/)

### 3. Apple HIG Insights (2025)

**Liquid Glass Design Language:**
- Translucent, depth-aware UI elements
- Fluid responsiveness to motion and content
- "Optical qualities of glass" including refraction

**Typography:**
- San Francisco remains standard
- Default body: 17pt
- Bolder weights for emphasis (avoid light weights)
- Left-aligned for readability

**Colors:**
- System colors adjusted for Liquid Glass harmony
- High contrast pairs required (4.5:1 minimum for text)
- Semantic colors for status (success, error, warning)

**Sources:**
- [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/)
- [WWDC25: New Design System](https://developer.apple.com/videos/play/wwdc2025/356/)
- [iOS Design Guidelines 2025](https://tapptitude.com/blog/i-os-app-design-guidelines-for-2025)

### 4. Dark Mode Best Practices

- **NOT pure black everywhere** - use dark gray (#1C1C1E) for elevated surfaces
- **Elevation through lightness** - lighter = more elevated in dark mode
- **System follows by default** - respect user's system preference
- **Smooth transitions** - 0.3s ease for theme switches
- **Persist preference** - remember user choice

**Sources:**
- [Apple Dark Mode Guidelines](https://developer.apple.com/design/human-interface-guidelines/dark-mode)
- [Supporting Dark Mode in iOS](https://developer.apple.com/documentation/uikit/appearance_customization/supporting_dark_mode_in_your_interface/)

---

## Proposed Color Palette

### Light Mode

| Token | Hex | Usage |
|-------|-----|-------|
| `background` | `#FAFAFA` | Screen backgrounds |
| `surface` | `#FFFFFF` | Cards, elevated surfaces |
| `surfaceSecondary` | `#F2F2F7` | Secondary surfaces, inputs |
| `textPrimary` | `#1A1A1A` | Primary text |
| `textSecondary` | `#6B6B6B` | Secondary text |
| `textTertiary` | `#8E8E93` | Placeholder, disabled |
| `accent` | `#007AFF` | Primary actions, links |
| `accentPressed` | `#0056B3` | Pressed state |
| `divider` | `#E5E5E5` | Separators |
| `fill` | `rgba(0,0,0,0.04)` | Subtle backgrounds |

### Dark Mode

| Token | Hex | Usage |
|-------|-----|-------|
| `background` | `#000000` | Screen backgrounds (OLED) |
| `surface` | `#1C1C1E` | Cards, elevated surfaces |
| `surfaceSecondary` | `#2C2C2E` | Secondary surfaces, inputs |
| `textPrimary` | `#FFFFFF` | Primary text |
| `textSecondary` | `#8E8E93` | Secondary text |
| `textTertiary` | `#48484A` | Placeholder, disabled |
| `accent` | `#0A84FF` | Primary actions, links |
| `accentPressed` | `#409CFF` | Pressed state |
| `divider` | `#2C2C2E` | Separators |
| `fill` | `rgba(255,255,255,0.04)` | Subtle backgrounds |

### Semantic Colors (Both Modes)

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `success` | `#34C759` | `#30D158` | Success states |
| `warning` | `#FF9500` | `#FF9F0A` | Warning states |
| `error` | `#FF3B30` | `#FF453A` | Error states |
| `info` | `#007AFF` | `#0A84FF` | Info (= accent) |

### Service Colors (Unchanged)

| Service | Color |
|---------|-------|
| Gmail | `#EA4335` |
| Calendar | `#4285F4` |
| WhatsApp | `#25D366` |
| Microsoft | `#00A4EF` |

---

## Architecture Changes

### Current State
```
src/theme/
├── colors.ts      # Exports darkColors/lightColors but defaults to dark
├── styles.ts      # Shared styles referencing colors
└── index.ts       # Barrel export

No theme context - colors hardcoded throughout 53 files
```

### Proposed State
```
src/theme/
├── colors.ts          # Color tokens (light + dark)
├── styles.ts          # Shared styles (theme-aware)
├── ThemeContext.tsx   # NEW: React context for theme
├── useTheme.ts        # NEW: Hook to access theme
└── index.ts           # Updated exports

src/stores/
└── appStore.ts        # Add themeMode: 'system' | 'light' | 'dark'

src/hooks/
└── useColorScheme.ts  # NEW: System theme detection
```

### Theme Context API

```typescript
// ThemeContext.tsx
interface ThemeContextValue {
  mode: 'system' | 'light' | 'dark';
  resolvedMode: 'light' | 'dark';  // Actual mode after system resolution
  colors: ThemeColors;
  gradients: ThemeGradients;
  setMode: (mode: 'system' | 'light' | 'dark') => void;
  isDark: boolean;
}

// Usage in components
const { colors, isDark, setMode } = useTheme();
```

---

## Component Updates Required

### High Priority (Core Experience)

| Component | Changes |
|-----------|---------|
| `_layout.tsx` | Add ThemeProvider, dynamic StatusBar |
| `colors.ts` | Update palette to Apple Blue |
| `ThemeContext.tsx` | NEW - create theme provider |
| `settings.tsx` | Add Appearance section with toggle |
| `chat.tsx` | Update colors, BlurView tints |
| `ChatBubble.tsx` | Theme-aware message styling |
| `GlassCard.tsx` | Add GlassView with fallback |

### Medium Priority (Components)

| Component | Changes |
|-----------|---------|
| `ActionReviewModal.tsx` | Theme colors, glass effect |
| `ActionSuggestionPill.tsx` | Theme colors |
| `DayBriefingScroll.tsx` | Theme colors |
| `FloatingActionButton.tsx` | Accent color update |
| `GradientIcon.tsx` | Blue gradient option |
| `ThinkingIndicator.tsx` | Theme colors |
| All other components | Replace hardcoded colors |

### Low Priority (Screens)

| Screen | Changes |
|--------|---------|
| `auth.tsx` | Theme colors, gradients |
| `calendar.tsx` | Theme colors |
| `add-memory.tsx` | Theme colors |
| `people.tsx` | Theme colors |
| `person/[name].tsx` | Theme colors |
| `connected-accounts.tsx` | Theme colors |

---

## Glass Effect Strategy

### Implementation Approach

```typescript
// components/GlassContainer.tsx
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { View, ViewProps } from 'react-native';
import { useTheme } from '../theme';

interface GlassContainerProps extends ViewProps {
  intensity?: 'subtle' | 'regular' | 'prominent';
  fallbackStyle?: 'blur' | 'solid';
}

export function GlassContainer({
  children,
  intensity = 'regular',
  fallbackStyle = 'solid',
  style,
  ...props
}: GlassContainerProps) {
  const { colors, isDark } = useTheme();
  const canUseGlass = isLiquidGlassAvailable();

  if (canUseGlass) {
    return (
      <GlassView
        glassEffectStyle={intensity === 'subtle' ? 'clear' : 'regular'}
        style={style}
        {...props}
      >
        {children}
      </GlassView>
    );
  }

  // Fallback for iOS < 26 / Android
  return (
    <View
      style={[
        { backgroundColor: colors.surface },
        style
      ]}
      {...props}
    >
      {children}
    </View>
  );
}
```

### Where to Use Glass

| Location | Priority | Notes |
|----------|----------|-------|
| Bottom sheets | High | Modal backgrounds |
| Navigation bars | Medium | If applicable |
| Cards (optional) | Low | May be too busy |
| Floating elements | Medium | FAB, toasts |

---

## Settings Screen: Appearance Section

### Design

```
┌─────────────────────────────────────────┐
│  Appearance                        [>]  │
├─────────────────────────────────────────┤
│                                         │
│  ○ System                               │
│  ○ Light                                │
│  ○ Dark                          [✓]    │
│                                         │
└─────────────────────────────────────────┘
```

### Behavior

1. **Default:** System (follows iOS appearance)
2. **Persisted:** Store in AsyncStorage + Zustand
3. **Instant:** No app restart required
4. **StatusBar:** Updates automatically (light/dark)

---

## Implementation Phases

### Phase 1: Foundation (Day 1)
- [ ] Create `ThemeContext.tsx` with provider
- [ ] Update `colors.ts` with Apple Blue palette
- [ ] Add `themeMode` to appStore
- [ ] Create `useColorScheme.ts` hook
- [ ] Wrap app in ThemeProvider

### Phase 2: Core Screens (Day 1-2)
- [ ] Update `_layout.tsx` (StatusBar, provider)
- [ ] Update `chat.tsx` (main experience)
- [ ] Update `settings.tsx` (add Appearance)
- [ ] Update `ChatBubble.tsx`

### Phase 3: Components (Day 2-3)
- [ ] Update all 34 components
- [ ] Replace hardcoded colors
- [ ] Update BlurView tints dynamically
- [ ] Update gradient references

### Phase 4: Glass Effects (Day 3)
- [ ] Install `expo-glass-effect`
- [ ] Create `GlassContainer.tsx` wrapper
- [ ] Apply to bottom sheets
- [ ] Test on iOS 26 simulator

### Phase 5: Polish (Day 4)
- [ ] Theme transition animations
- [ ] Test all screens in both modes
- [ ] Accessibility audit
- [ ] Performance testing

---

## Testing Checklist

### Visual Testing
- [ ] Light mode on iOS
- [ ] Dark mode on iOS
- [ ] System toggle (iOS Settings)
- [ ] Light mode on Android
- [ ] Dark mode on Android

### Component Testing
- [ ] All 34 components render correctly
- [ ] No hardcoded colors visible
- [ ] BlurView tints match theme
- [ ] Gradients appropriate for mode

### Accessibility Testing
- [ ] Contrast ratios meet AA for text
- [ ] Touch targets 44x44pt minimum
- [ ] VoiceOver compatibility
- [ ] Dynamic Type support

### Glass Effect Testing
- [ ] iOS 26+ simulator (glass works)
- [ ] iOS < 26 device (fallback works)
- [ ] Android (fallback works)

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| iOS 26 not widely adopted | Low glass usage | Solid fallbacks as primary |
| 53 files to update | High effort | Systematic approach, testing |
| Hardcoded colors missed | Visual bugs | Global search, code review |
| Performance impact | UX degradation | Profile theme switching |
| Breaking changes | User complaints | Thorough testing |

---

## Questions for Discussion

1. **Gradient strategy:** Should we keep gradients or go pure solid Apple Blue?
   - Option A: Solid blue everywhere (most Apple-like)
   - Option B: Subtle blue gradient for CTAs (more Cortex personality)

2. **Glass effect adoption:** How aggressively use glass?
   - Option A: Only bottom sheets (conservative)
   - Option B: Cards + sheets + floating elements (full embrace)

3. **Service icons:** Keep Google/service colors or make monochrome?
   - Option A: Keep branded colors (recognizable)
   - Option B: Monochrome (cleaner, more unified)

4. **Default theme:** What should new users see?
   - Option A: System (respects user preference)
   - Option B: Dark (Cortex brand identity)

---

## References

- [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/)
- [Apple HIG - Color](https://developer.apple.com/design/human-interface-guidelines/color)
- [Apple HIG - Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)
- [Expo Glass Effect](https://docs.expo.dev/versions/latest/sdk/glass-effect/)
- [WCAG Contrast Guidelines](https://webaim.org/articles/contrast/)
- [iOS Design Guidelines 2025](https://tapptitude.com/blog/i-os-app-design-guidelines-for-2025)

---

*Plan prepared for Cortex team review.*
