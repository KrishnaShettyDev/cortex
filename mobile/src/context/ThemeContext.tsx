import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useAppStore, ThemeMode } from '../stores/appStore';
import {
  darkColors,
  lightColors,
  darkGradients,
  lightGradients,
} from '../theme/colors';

type ThemeColors = typeof darkColors;
type ThemeGradients = typeof darkGradients;

interface ThemeContextValue {
  colors: ThemeColors;
  gradients: ThemeGradients;
  themeMode: ThemeMode;
  effectiveTheme: 'dark' | 'light';
  setThemeMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const themeMode = useAppStore((state) => state.themeMode);
  const setThemeMode = useAppStore((state) => state.setThemeMode);

  const { colors, gradients, effectiveTheme } = useMemo(() => {
    // Determine effective theme based on mode and system preference
    let effective: 'dark' | 'light';
    if (themeMode === 'system') {
      effective = systemColorScheme === 'light' ? 'light' : 'dark';
    } else {
      effective = themeMode;
    }

    return {
      colors: effective === 'light' ? lightColors : darkColors,
      gradients: effective === 'light' ? lightGradients : darkGradients,
      effectiveTheme: effective,
    };
  }, [themeMode, systemColorScheme]);

  const value = useMemo(
    () => ({
      colors,
      gradients,
      themeMode,
      effectiveTheme,
      setThemeMode,
    }),
    [colors, gradients, themeMode, effectiveTheme, setThemeMode]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
