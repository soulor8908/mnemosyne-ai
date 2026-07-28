import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // 极简单色主调 + 一个强调色（产品设计原则）
        ink: {
          50: '#f7f7f8',
          100: '#eeeef0',
          200: '#d9d9de',
          300: '#b8b8c0',
          400: '#8e8e99',
          500: '#6b6b75',
          600: '#52525a',
          700: '#3f3f46',
          800: '#27272a',
          900: '#18181b',
          950: '#0a0a0c',
        },
        accent: {
          DEFAULT: '#4f46e5',
          hover: '#4338ca',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: 'none',
            color: '#27272a',
            a: { color: '#4f46e5' },
            code: {
              backgroundColor: '#f4f4f5',
              padding: '0.15em 0.35em',
              borderRadius: '0.25rem',
              fontWeight: '400',
            },
            'code::before': { content: '""' },
            'code::after': { content: '""' },
          },
        },
      },
    },
  },
  plugins: [],
};

export default config;
