/** @type {import('tailwindcss').Config} */
export default {
	content: ["./src/**/*.{html,js,svelte,ts}"],
	theme: {
		extend: {
			colors: {
				// Channels live in src/app.css; the rgb(var(--x) / <alpha-value>)
				// wiring lets every token take Tailwind opacity modifiers (bg-tan/15).
				black: "rgb(var(--color-black) / <alpha-value>)",
				brown: "rgb(var(--color-brown) / <alpha-value>)",
				"dark-brown": "rgb(var(--color-dark-brown) / <alpha-value>)",
				orange: "rgb(var(--color-orange) / <alpha-value>)",
				tan: "rgb(var(--color-tan) / <alpha-value>)",
				"tan-hover": "rgb(var(--color-tan-hover) / <alpha-value>)",
				"tan-light": "rgb(var(--color-tan-light) / <alpha-value>)",
				white: "rgb(var(--color-white) / <alpha-value>)",
				yellow: "rgb(var(--color-yellow) / <alpha-value>)",
				"blue-gray": "rgb(var(--color-blue-gray) / <alpha-value>)",
				"border-gray": "rgb(var(--color-border-gray) / <alpha-value>)",
				gray: {
					200: "rgb(var(--color-gray-200) / <alpha-value>)",
				},
				// Dark-brown surface ramp
				surface: {
					DEFAULT: "rgb(var(--color-surface) / <alpha-value>)",
					deep: "rgb(var(--color-surface-deep) / <alpha-value>)",
					sunken: "rgb(var(--color-surface-sunken) / <alpha-value>)",
					"sunken-hover":
						"rgb(var(--color-surface-sunken-hover) / <alpha-value>)",
					hover: "rgb(var(--color-surface-hover) / <alpha-value>)",
					raised: "rgb(var(--color-surface-raised) / <alpha-value>)",
					"raised-hover":
						"rgb(var(--color-surface-raised-hover) / <alpha-value>)",
				},
				bright: "rgb(var(--color-bright) / <alpha-value>)",
				muted: "rgb(var(--color-muted) / <alpha-value>)",
				placeholder: "rgb(var(--color-placeholder) / <alpha-value>)",
				input: {
					DEFAULT: "rgb(var(--color-input) / <alpha-value>)",
					focus: "rgb(var(--color-input-focus) / <alpha-value>)",
				},
				"border-subtle": "rgb(var(--color-border-subtle) / <alpha-value>)",
				"border-tooltip": "rgb(var(--color-border-tooltip) / <alpha-value>)",
				track: "rgb(var(--color-track) / <alpha-value>)",
				success: {
					DEFAULT: "rgb(var(--color-success) / <alpha-value>)",
					surface: "rgb(var(--color-success-surface) / <alpha-value>)",
				},
				danger: {
					DEFAULT: "rgb(var(--color-danger) / <alpha-value>)",
					surface: "rgb(var(--color-danger-surface) / <alpha-value>)",
				},
			},
		},
	},
	plugins: [],
};
