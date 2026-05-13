import { defineConfig } from "vitest/config";

// Isolate the Worker test suite from the SvelteKit project at the repo
// root. Without this, vitest discovers root's vite plugins (svelte-kit,
// svelte) and warns about a missing svelte config / app.html.
export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
	},
	plugins: [],
});
