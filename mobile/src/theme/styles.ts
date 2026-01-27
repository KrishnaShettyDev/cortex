import { StyleSheet, ViewStyle, TextStyle, Dimensions, Platform } from 'react-native';
import { colors } from './colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// iOS-style spacing (4pt grid)
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

// iOS-style border radius
export const borderRadius = {
  xs: 4,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  xxl: 20,
  full: 9999,
};

// Responsive utilities
export const responsive = {
  screenPadding: spacing.lg,
  cardMaxWidth: 500,
  inputHeight: 48,
  isSmallScreen: SCREEN_WIDTH < 375,
  isMediumScreen: SCREEN_WIDTH >= 375 && SCREEN_WIDTH < 428,
  isLargeScreen: SCREEN_WIDTH >= 428,
};

// iOS Typography - SF Pro inspired
// Uses system font which is SF Pro on iOS
export const typography = StyleSheet.create({
  // Large Title (34pt)
  largeTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.37,
    lineHeight: 41,
  },
  // Title 1 (28pt)
  title1: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.36,
    lineHeight: 34,
  },
  // Title 2 (22pt)
  title2: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.35,
    lineHeight: 28,
  },
  // Title 3 (20pt)
  title3: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    letterSpacing: 0.38,
    lineHeight: 25,
  },
  // Headline (17pt semibold)
  headline: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    letterSpacing: -0.41,
    lineHeight: 22,
  },
  // Body (17pt)
  body: {
    fontSize: 17,
    fontWeight: '400',
    color: colors.textPrimary,
    letterSpacing: -0.41,
    lineHeight: 22,
  },
  // Callout (16pt)
  callout: {
    fontSize: 16,
    fontWeight: '400',
    color: colors.textPrimary,
    letterSpacing: -0.32,
    lineHeight: 21,
  },
  // Subhead (15pt)
  subhead: {
    fontSize: 15,
    fontWeight: '400',
    color: colors.textSecondary,
    letterSpacing: -0.24,
    lineHeight: 20,
  },
  // Footnote (13pt)
  footnote: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.textSecondary,
    letterSpacing: -0.08,
    lineHeight: 18,
  },
  // Caption 1 (12pt)
  caption1: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textTertiary,
    lineHeight: 16,
  },
  // Caption 2 (11pt)
  caption2: {
    fontSize: 11,
    fontWeight: '400',
    color: colors.textTertiary,
    letterSpacing: 0.07,
    lineHeight: 13,
  },
  // Legacy aliases
  h1: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.36,
  },
  h2: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.textPrimary,
    letterSpacing: 0.35,
  },
  h3: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  bodySmall: {
    fontSize: 15,
    fontWeight: '400',
    color: colors.textSecondary,
    lineHeight: 20,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textTertiary,
  },
  button: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    letterSpacing: -0.41,
  },
});

// iOS-style card
export const glassCard: ViewStyle = {
  backgroundColor: colors.fill,
  borderRadius: borderRadius.lg,
  overflow: 'hidden',
};

// iOS-style card with border
export const borderedCard: ViewStyle = {
  backgroundColor: colors.fill,
  borderWidth: 0.5,
  borderColor: colors.separator,
  borderRadius: borderRadius.lg,
  overflow: 'hidden',
};

// iOS-style bottom sheet handle
export const sheetHandle: ViewStyle = {
  width: 36,
  height: 5,
  backgroundColor: colors.fillTertiary,
  borderRadius: 2.5,
  alignSelf: 'center',
  marginTop: spacing.sm,
  marginBottom: spacing.md,
};

// iOS-style button styles
export const buttonStyles = StyleSheet.create({
  // Primary filled button
  primary: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    minHeight: 50,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.41,
  },
  // Secondary/outline button
  secondary: {
    backgroundColor: colors.fill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    minHeight: 50,
  },
  secondaryText: {
    color: colors.accent,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.41,
  },
  // Icon button (circular)
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.fill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  // Small icon button
  iconSmall: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.fill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  // Pill button (for actions)
  pill: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.full,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  pillText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  // Text button (no background)
  text: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  textLabel: {
    color: colors.accent,
    fontSize: 17,
    fontWeight: '400',
  },
  // Glass button (deprecated - use secondary)
  glass: {
    backgroundColor: colors.fill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.lg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
});

// iOS-style input
export const inputStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.fill,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: responsive.inputHeight,
  },
  text: {
    color: colors.textPrimary,
    fontSize: 17,
    letterSpacing: -0.41,
  },
  placeholder: {
    color: colors.textTertiary,
  },
  focused: {
    backgroundColor: colors.fillSecondary,
  },
  // Search bar style
  searchBar: {
    backgroundColor: colors.fillSecondary,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
  },
});

// iOS-style shadows
export const shadows = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  sm: {
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 6,
  },
  xl: {
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 10,
  },
  // Accent glow (for CTAs)
  glow: {
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
};

// Common layout styles
export const layoutStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spaceBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  screenPadding: {
    paddingHorizontal: spacing.lg,
  },
  // Safe area padding
  safeArea: {
    paddingTop: Platform.OS === 'ios' ? 44 : 24,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
});

// iOS-style list row
export const listRowStyle: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.lg,
  gap: spacing.md,
  minHeight: 44, // iOS touch target
};

// Divider style
export const dividerStyle: ViewStyle = {
  height: StyleSheet.hairlineWidth,
  backgroundColor: colors.separator,
  marginLeft: spacing.lg,
};

// Full-width divider
export const dividerFullStyle: ViewStyle = {
  height: StyleSheet.hairlineWidth,
  backgroundColor: colors.separator,
};

// Status pill style
export const statusPillStyle: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  paddingHorizontal: spacing.sm,
  paddingVertical: spacing.xs,
  borderRadius: borderRadius.full,
  gap: spacing.xs,
  backgroundColor: colors.fill,
};

// iOS-style section header
export const sectionHeaderStyle: TextStyle = {
  fontSize: 13,
  fontWeight: '400',
  color: colors.textSecondary,
  textTransform: 'uppercase',
  letterSpacing: -0.08,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.xl,
  paddingBottom: spacing.sm,
};

// iOS-style grouped list container
export const groupedListStyle: ViewStyle = {
  backgroundColor: colors.fill,
  borderRadius: borderRadius.lg,
  marginHorizontal: spacing.lg,
  overflow: 'hidden',
};
