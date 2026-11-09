import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Space Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        cobalt: {
          DEFAULT: '#0F0C59',
          deep: '#070526',
          mid: '#120E6A',
          light: '#1e1985',
          panel: 'rgba(22, 18, 98, 0.65)',
          border: 'rgba(255, 243, 224, 0.12)',
        },
        cream: {
          DEFAULT: '#FCECD5',
          light: '#FFF3E0',
          dark: '#E8D4BA',
        },
        terracotta: {
          DEFAULT: '#D95D24',
          bright: '#E06328',
          hover: '#C24E19',
        },
      },
    },
  },
  plugins: [],
}

export default config
