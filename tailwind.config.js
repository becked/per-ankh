/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        black: '#000000',
        brown: '#A52A2A',
        orange: '#FFA500',
        tan: '#D2B48C',
        'tan-hover': '#dfcaae',
        white: '#FFFFFF',
        yellow: '#FFFF00',
        'blue-gray': '#211A12',
        'border-gray': '#1C160F',
        gray: {
          200: '#eeeeee',
        },
      },
    },
  },
  plugins: [],
}
