/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./entrypoints/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#000000',
        'bg-secondary': '#1C1C1E',
        'bg-tertiary': '#2C2C2E',
        'accent': '#0A84FF',
        'accent-pressed': '#0077ED',
        'text-primary': '#FFFFFF',
        'text-secondary': '#8E8E93',
        'text-tertiary': '#636366',
        'success': '#34C759',
        'error': '#FF3B30',
        'warning': '#FF9500',
      },
      borderRadius: {
        'sm': '8px',
        'md': '12px',
        'lg': '16px',
      },
    },
  },
  plugins: [],
};
