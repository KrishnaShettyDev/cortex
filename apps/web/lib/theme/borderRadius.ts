/**
 * Cortex Border Radius System
 * Copied from mobile app for exact parity
 */

export const borderRadius = {
  none: '0',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  '2xl': '24px',
  full: '9999px',
} as const;

export type BorderRadius = typeof borderRadius;
export type BorderRadiusKey = keyof BorderRadius;
