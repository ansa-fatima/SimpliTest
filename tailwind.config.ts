import type { Config } from 'tailwindcss';

// TCMS design tokens. Surfaces/borders/text are CSS variables so the theme
// toggle (light ↔ dark) flips them via `data-theme` on <html>. Brand and
// semantic palettes stay literal — they read the same in both modes.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    // severityBadge/priorityBadge/typeBadge/statusBadge (lib/utils.ts) build
    // Tailwind class strings dynamically -- without this, any color combo
    // that isn't ALSO coincidentally typed out in an already-scanned file
    // never gets its CSS generated at all (not overridden -- just absent),
    // which is exactly how e.g. text-green-800 silently vanished here.
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        // Surfaces — theme-aware
        bg: v('bg'),
        surface: v('surface'),
        'surface-2': v('surface-2'),
        'surface-3': v('surface-3'),

        // Borders — theme-aware
        border: { DEFAULT: v('border'), strong: v('border-strong') },

        // Text — theme-aware
        text: { DEFAULT: v('text'), 2: v('text-2'), 3: v('text-3') },

        // Brand — explicit hex.
        primary: {
          DEFAULT: '#4B0082',
          hover: '#380062',
          light: '#EEE0F7',
          text: '#380062',
        },

        // Semantic — success/danger already matched the reference almost
        // exactly; warning realigned to its amber (was a more orange-red).
        success: { DEFAULT: '#16A34A', bg: '#F0FDF4', text: '#166534' },
        danger: { DEFAULT: '#DC2626', bg: '#FEF2F2', text: '#991B1B' },
        warning: { DEFAULT: '#D97706', bg: '#FEF3C7', text: '#92400E' },

        // Pills (used in tables for priority/severity/run-result)
        pill: {
          high: { bg: '#FEE2E2', text: '#991B1B' },
          medium: { bg: '#FEF3C7', text: '#92400E' },
          low: { bg: '#DBEAFE', text: '#1E40AF' },
          pass: { bg: '#DCFCE7', text: '#166534' },
          fail: { bg: '#FEE2E2', text: '#991B1B' },
          block: { bg: '#FFEDD5', text: '#9A3412' },
        },
      },
      borderRadius: {
        DEFAULT: '8px',
        lg: '12px',
      },
    },
  },
  plugins: [],
};
export default config;
