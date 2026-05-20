import type { Config } from 'tailwindcss';

// TCMS design tokens (light theme defaults; dark theme via CSS vars).
// Mirrors index.html PRD design — see /Downloads/index.html
const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        // Surfaces
        bg: '#FAFAF9',
        surface: '#FFFFFF',
        'surface-2': '#F5F5F4',
        'surface-3': '#EEEDEB',

        // Borders
        border: { DEFAULT: '#E7E5E4', strong: '#D6D3D1' },

        // Text
        text: { DEFAULT: '#1C1917', 2: '#57534E', 3: '#A8A29E' },

        // Brand
        primary: {
          DEFAULT: '#6366F1',
          hover: '#4F46E5',
          light: '#EEF2FF',
          text: '#3730A3',
        },

        // Semantic
        success: { DEFAULT: '#16A34A', bg: '#F0FDF4', text: '#166534' },
        danger: { DEFAULT: '#DC2626', bg: '#FEF2F2', text: '#991B1B' },
        warning: { DEFAULT: '#EA580C', bg: '#FFF7ED', text: '#9A3412' },

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
