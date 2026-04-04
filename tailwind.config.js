/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        uvra: {
          bg: '#0a0a0f',
          card: '#12121a',
          border: '#1e1e2e',
          accent: '#6c5ce7',
          'accent-light': '#a29bfe',
          success: '#00b894',
          warning: '#fdcb6e',
          danger: '#e17055',
          text: '#dfe6e9',
          'text-dim': '#636e72',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(108, 92, 231, 0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(108, 92, 231, 0.6)' },
        }
      }
    },
  },
  plugins: [],
}
