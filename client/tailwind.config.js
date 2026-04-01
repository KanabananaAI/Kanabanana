/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        board: {
          bg: 'var(--board-bg)',
          card: 'var(--board-card)',
          border: 'var(--board-border)',
          hover: 'var(--board-hover)',
          surface: 'var(--board-surface)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        agent: {
          claude: '#e67e22',
          kilo: '#06b6d4',
          lmstudio: '#10b981',
          qwen: '#3b82f6',
          gemini: '#a855f7',
          droid: '#22c55e',
          generic: '#6b7280',
        },
        status: {
          executing: '#22c55e',
          thinking: '#eab308',
          error: '#ef4444',
          idle: '#6b7280',
          done: '#3b82f6',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
