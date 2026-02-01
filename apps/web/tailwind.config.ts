import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Background colors
        'bg-primary': 'var(--color-bg-primary)',
        'bg-secondary': 'var(--color-bg-secondary)',
        'bg-tertiary': 'var(--color-bg-tertiary)',
        'bg-elevated': 'var(--color-bg-elevated)',

        // Text colors
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-tertiary': 'var(--color-text-tertiary)',
        'text-quaternary': 'var(--color-text-quaternary)',

        // Accent colors
        accent: 'var(--color-accent)',
        'accent-light': 'var(--color-accent-light)',
        'accent-muted': 'var(--color-accent-muted)',
        'accent-pressed': 'var(--color-accent-pressed)',

        // System colors
        success: 'var(--color-success)',
        error: 'var(--color-error)',
        warning: 'var(--color-warning)',
        info: 'var(--color-info)',

        // Service colors
        gmail: '#EA4335',
        calendar: '#4285F4',
        google: '#4285F4',
        microsoft: '#00A4EF',
        whatsapp: '#25D366',

        // Separators
        separator: 'var(--color-separator)',
        'glass-border': 'var(--color-glass-border)',
        'glass-bg': 'var(--color-glass-bg)',
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
        '2xl': '32px',
        '3xl': '48px',
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
        full: '9999px',
      },
      fontSize: {
        xs: '12px',
        sm: '13px',
        base: '15px',
        lg: '17px',
        xl: '20px',
        '2xl': '24px',
        '3xl': '28px',
        '4xl': '34px',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      backdropBlur: {
        glass: '25px',
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, var(--gradient-from), var(--gradient-to))',
      },
    },
  },
  plugins: [],
};
export default config;
