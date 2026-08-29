/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        xs: '400px',
      },
      fontFamily: {
        sans: ['Poppins', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      colors: {
        // Logo blue — royal / navy
        brand: {
          50: '#eef3ff', 100: '#dbe4ff', 200: '#bcceff', 300: '#8facff',
          400: '#5b7ef4', 500: '#2f6fd0', 600: '#1f52c0', 700: '#17348f',
          800: '#152c78', 900: '#152761',
        },
        // Logo yellow — gold accent
        gold: {
          50: '#fff9e6', 100: '#fff0bf', 200: '#ffe185', 300: '#ffd24d',
          400: '#fdc21f', 500: '#f7b500', 600: '#d99400', 700: '#b47100',
          800: '#915709', 900: '#77470d',
        },
      },
    },
  },
  plugins: [],
};
