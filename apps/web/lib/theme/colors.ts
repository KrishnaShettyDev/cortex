/**
 * Cortex Theme Colors - Apple Blue Design System
 * Copied from mobile app for exact parity
 *
 * Based on Apple Human Interface Guidelines
 * Primary accent: Apple Blue (#007AFF light / #0A84FF dark)
 */

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

// ============================================================================
// LIGHT MODE
// ============================================================================
export const lightColors = {
  // Backgrounds
  bgPrimary: '#FAFAFA',
  bgSecondary: '#FFFFFF',
  bgTertiary: '#F2F2F7',
  bgElevated: '#FFFFFF',

  // Text
  textPrimary: '#1A1A1A',
  textSecondary: '#6B6B6B',
  textTertiary: '#8E8E93',
  textQuaternary: '#C7C7CC',

  // Apple Blue Accent
  accent: '#007AFF',
  accentLight: 'rgba(0, 122, 255, 0.12)',
  accentMuted: 'rgba(0, 122, 255, 0.06)',
  accentPressed: '#0056B3',

  // Fills (iOS-style layered fills)
  fill: 'rgba(0, 0, 0, 0.04)',
  fillSecondary: 'rgba(0, 0, 0, 0.06)',
  fillTertiary: 'rgba(0, 0, 0, 0.08)',

  // Separators & Borders
  separator: '#E5E5E5',
  separatorOpaque: '#C6C6C8',
  glassBorder: 'rgba(0, 0, 0, 0.06)',
  glassBackground: 'rgba(0, 0, 0, 0.03)',
  glassHighlight: 'rgba(0, 0, 0, 0.08)',
  glassBlur: 25,

  // System Colors
  success: '#34C759',
  error: '#FF3B30',
  warning: '#FF9500',
  info: '#007AFF',

  // Service Colors (unchanged - brand recognition)
  gmail: '#EA4335',
  calendar: '#4285F4',
  google: '#4285F4',
  microsoft: '#00A4EF',
  whatsapp: '#25D366',

  // Shadows
  shadowColor: '#000000',
};

// ============================================================================
// DARK MODE
// ============================================================================
export const darkColors = {
  // Backgrounds - true black for OLED
  bgPrimary: '#000000',
  bgSecondary: '#1C1C1E',
  bgTertiary: '#2C2C2E',
  bgElevated: '#1C1C1E',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#48484A',
  textQuaternary: '#3A3A3C',

  // Apple Blue Accent (darker variant for dark mode)
  accent: '#0A84FF',
  accentLight: 'rgba(10, 132, 255, 0.15)',
  accentMuted: 'rgba(10, 132, 255, 0.08)',
  accentPressed: '#409CFF',

  // Fills (iOS-style layered fills)
  fill: 'rgba(255, 255, 255, 0.04)',
  fillSecondary: 'rgba(255, 255, 255, 0.08)',
  fillTertiary: 'rgba(255, 255, 255, 0.12)',

  // Separators & Borders
  separator: '#2C2C2E',
  separatorOpaque: '#38383A',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  glassBackground: 'rgba(255, 255, 255, 0.04)',
  glassHighlight: 'rgba(255, 255, 255, 0.12)',
  glassBlur: 25,

  // System Colors (adjusted for dark mode)
  success: '#30D158',
  error: '#FF453A',
  warning: '#FF9F0A',
  info: '#0A84FF',

  // Service Colors (unchanged)
  gmail: '#EA4335',
  calendar: '#4285F4',
  google: '#4285F4',
  microsoft: '#00A4EF',
  whatsapp: '#25D366',

  // Shadows
  shadowColor: '#000000',
};

// ============================================================================
// DEFAULT EXPORT
// ============================================================================
export const colors = darkColors;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
export function getThemeColors(mode: ResolvedTheme) {
  return mode === 'light' ? lightColors : darkColors;
}

// ============================================================================
// GRADIENTS
// ============================================================================
type GradientColors = [string, string, ...string[]];

export const lightGradients = {
  primary: ['#007AFF', '#5AC8FA'] as GradientColors,
  subtle: ['rgba(0, 122, 255, 0.15)', 'rgba(90, 200, 250, 0.15)'] as GradientColors,
  glass: ['rgba(255, 255, 255, 0.8)', 'rgba(255, 255, 255, 0.6)'] as GradientColors,
  accent: ['#007AFF', '#5AC8FA'] as GradientColors,
};

export const darkGradients = {
  primary: ['#0A84FF', '#5AC8FA'] as GradientColors,
  subtle: ['rgba(10, 132, 255, 0.2)', 'rgba(90, 200, 250, 0.2)'] as GradientColors,
  glass: ['rgba(255, 255, 255, 0.06)', 'rgba(255, 255, 255, 0.02)'] as GradientColors,
  accent: ['#0A84FF', '#5AC8FA'] as GradientColors,
};

// Default gradients (dark mode)
export const gradients = darkGradients;

export function getThemeGradients(mode: ResolvedTheme) {
  return mode === 'light' ? lightGradients : darkGradients;
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================
export type ThemeColors = typeof lightColors;
export type ThemeGradients = typeof lightGradients;
