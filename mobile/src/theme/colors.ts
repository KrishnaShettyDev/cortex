// Cortex Theme System - iOS-Style

export type ThemeMode = 'dark' | 'light';

// Dark Theme Colors
export const darkColors = {
  // Backgrounds - deeper, richer dark
  bgPrimary: '#0A0A0A',
  bgSecondary: '#121212',
  bgTertiary: '#1C1C1E',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#48484A',

  // Gradient accent (rainbow-ish)
  gradientStart: '#7DD3C0',    // Mint
  gradientMid: '#A78BFA',       // Purple
  gradientEnd: '#F472B6',       // Pink
  accent: '#A78BFA',            // Primary purple

  // Legacy accent colors (for compatibility)
  accentMint: '#7DD3C0',
  accentLavender: '#A78BFA',
  accentPeach: '#F472B6',
  accentSky: '#A8D4E6',

  // Glass effects - enhanced
  glassBackground: 'rgba(255, 255, 255, 0.06)',
  glassBorder: 'rgba(255, 255, 255, 0.12)',
  glassHighlight: 'rgba(255, 255, 255, 0.18)',
  glassBlur: 20,

  // Status
  success: '#34C759',
  error: '#FF453A',
  warning: '#FFD60A',

  // Service colors
  gmail: '#EA4335',
  calendar: '#4285F4',
  google: '#4285F4',
  microsoft: '#00A4EF',

  // Shadows
  shadowColor: '#000000',
};

// Light Theme Colors
export const lightColors = {
  // Backgrounds - clean, bright
  bgPrimary: '#FFFFFF',
  bgSecondary: '#F2F2F7',
  bgTertiary: '#E5E5EA',

  // Text
  textPrimary: '#000000',
  textSecondary: '#3C3C43',
  textTertiary: '#8E8E93',

  // Gradient accent (same rainbow)
  gradientStart: '#7DD3C0',
  gradientMid: '#A78BFA',
  gradientEnd: '#F472B6',
  accent: '#A78BFA',

  // Legacy accent colors
  accentMint: '#7DD3C0',
  accentLavender: '#A78BFA',
  accentPeach: '#F472B6',
  accentSky: '#A8D4E6',

  // Glass effects - adapted for light
  glassBackground: 'rgba(0, 0, 0, 0.04)',
  glassBorder: 'rgba(0, 0, 0, 0.08)',
  glassHighlight: 'rgba(0, 0, 0, 0.12)',
  glassBlur: 20,

  // Status
  success: '#34C759',
  error: '#FF3B30',
  warning: '#FFCC00',

  // Service colors
  gmail: '#EA4335',
  calendar: '#4285F4',
  google: '#4285F4',
  microsoft: '#00A4EF',

  // Shadows
  shadowColor: '#000000',
};

// Default export for backward compatibility (dark theme)
export const colors = darkColors;

// Get colors for a specific theme
export function getThemeColors(mode: ThemeMode) {
  return mode === 'light' ? lightColors : darkColors;
}

// Gradient color arrays - typed for LinearGradient compatibility
type GradientColors = [string, string, ...string[]];

export const darkGradients: {
  primary: GradientColors;
  subtle: GradientColors;
  glass: GradientColors;
  accent: GradientColors;
} = {
  primary: ['#7DD3C0', '#A78BFA', '#F472B6'],
  subtle: ['rgba(167, 139, 250, 0.3)', 'rgba(244, 114, 182, 0.3)'],
  glass: ['rgba(255, 255, 255, 0.1)', 'rgba(255, 255, 255, 0.05)'],
  accent: ['#A78BFA', '#F472B6'],
};

export const lightGradients: {
  primary: GradientColors;
  subtle: GradientColors;
  glass: GradientColors;
  accent: GradientColors;
} = {
  primary: ['#7DD3C0', '#A78BFA', '#F472B6'],
  subtle: ['rgba(167, 139, 250, 0.2)', 'rgba(244, 114, 182, 0.2)'],
  glass: ['rgba(0, 0, 0, 0.05)', 'rgba(0, 0, 0, 0.02)'],
  accent: ['#A78BFA', '#F472B6'],
};

// Default gradients (dark)
export const gradients = darkGradients;

// Get gradients for a specific theme
export function getThemeGradients(mode: ThemeMode) {
  return mode === 'light' ? lightGradients : darkGradients;
}
