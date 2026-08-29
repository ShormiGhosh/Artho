/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff', 100: '#d9edff', 200: '#bce0ff', 300: '#8ecbff',
          400: '#59acff', 500: '#3389fc', 600: '#1e6bf1', 700: '#1856de',
          800: '#1a48b4', 900: '#1b408e',
        },
      },
    },
  },
  plugins: [],
};
