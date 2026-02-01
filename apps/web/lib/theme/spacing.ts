/**
 * Cortex Spacing System
 * Copied from mobile app for exact parity
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export type Spacing = typeof spacing;
export type SpacingKey = keyof Spacing;

// Helper function to get spacing value
export function getSpacing(key: SpacingKey): number {
  return spacing[key];
}

// Convert to pixels for CSS
export function spacingToPx(key: SpacingKey): string {
  return `${spacing[key]}px`;
}

// Convert to rem for CSS
export function spacingToRem(key: SpacingKey): string {
  return `${spacing[key] / 16}rem`;
}
