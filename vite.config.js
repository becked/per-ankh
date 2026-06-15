import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 1420,
		strictPort: true,
	},
	build: {
		// Vite's default 'modules' target with Safari's floor raised 14 -> 15.
		// esbuild (pinned to 0.28.1 via overrides for a security fix) lowers
		// destructuring for Safari <= 14 — a workaround for a Safari bug fixed in
		// 15 — and then fails to compile it ("Transforming destructuring ... is
		// not supported yet"), which breaks the parser worker bundle. Targeting
		// Safari 15 stops the lowering. See esbuild#4436 (closed as not-planned).
		// Revisit if/when the toolchain ships an esbuild without this regression.
		target: ["es2020", "edge88", "firefox78", "chrome87", "safari15"],
	},
});
