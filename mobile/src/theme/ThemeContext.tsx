/**
 * ThemeContext - Apple-style theme management
 *
 * Provides theme colors, gradients, and mode switching.
 * Respects system preference when mode is 'system'.
 */

import React, { createContext, useContext, useMemo, useEffect } from 'react';
import { useColorScheme as useRNColorScheme, StatusBar } from 'react-native';
import { useAppStore, selectThemeMode } from '../stores/appStore';
import {
  lightColors,
  darkColors,
  lightGradients,
  darkGradients,
  ThemeColors,
  ThemeGradients,
  ThemeMode,
  ResolvedTheme,
} from './colors';

// ============================================================================
// CONTEXT TYPES
// ============================================================================
interface ThemeContextValue {
  /** User's theme preference: 'system' | 'light' | 'dark' */
  mode: ThemeMode;
  /** Actual resolved theme after system preference */
  resolvedMode: ResolvedTheme;
  /** Current theme colors */
  colors: ThemeColors;
  /** Current theme gradients */
  gradients: ThemeGradients;
  /** Change theme mode */
  setMode: (mode: ThemeMode) => void;
  /** Convenience boolean for dark mode checks */
  isDark: boolean;
}

// ============================================================================
// CONTEXT
// ============================================================================
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// ============================================================================
// PROVIDER
// ============================================================================
interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  // Get system color scheme
  const systemColorScheme = useRNColorScheme();

  // Get persisted theme mode from store
  const mode = useAppStore(selectThemeMode);
  const setThemeMode = useAppStore((state) => state.setThemeMode);

  // Resolve the actual theme based on mode and system preference
  const resolvedMode: ResolvedTheme = useMemo(() => {
    if (mode === 'system') {
      return systemColorScheme === 'light' ? 'light' : 'dark';
    }
    return mode;
  }, [mode, systemColorScheme]);

  const isDark = resolvedMode === 'dark';

  // Get theme-appropriate colors and gradients
  const colors = useMemo(() => {
    return isDark ? darkColors : lightColors;
  }, [isDark]);

  const gradients = useMemo(() => {
    return isDark ? darkGradients : lightGradients;
  }, [isDark]);

  // Update StatusBar style based on theme
  useEffect(() => {
    StatusBar.setBarStyle(isDark ? 'light-content' : 'dark-content', true);
  }, [isDark]);

  const value: ThemeContextValue = useMemo(
    () => ({
      mode,
      resolvedMode,
      colors,
      gradients,
      setMode: setThemeMode,
      isDark,
    }),
    [mode, resolvedMode, colors, gradients, setThemeMode, isDark]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

// ============================================================================
// HOOK
// ============================================================================
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// ============================================================================
// CONVENIENCE HOOKS
// ============================================================================

/** Get just the colors - useful for StyleSheet factories */
export function useThemeColors(): ThemeColors {
  const { colors } = useTheme();
  return colors;
}

/** Get just the isDark boolean */
export function useIsDark(): boolean {
  const { isDark } = useTheme();
  return isDark;
}
