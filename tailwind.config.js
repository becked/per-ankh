/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        black: 'var(--color-black)',
        brown: 'var(--color-brown)',
        orange: 'var(--color-orange)',
        tan: 'var(--color-tan)',
        'tan-hover': 'var(--color-tan-hover)',
        white: 'var(--color-white)',
        yellow: 'var(--color-yellow)',
        'blue-gray': 'var(--color-blue-gray)',
        'border-gray': 'var(--color-border-gray)',
        gray: {
          200: 'var(--color-gray-200)',
        },
      },
    },
  },
  plugins: [],
}
