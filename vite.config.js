import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

// esbuild (pinned to 0.28.1 via overrides for a security fix; see package.json)
// lowers destructuring for older Safari targets — its workaround for a Safari
// bug fixed in Safari 15 — and then fails to compile it ("Transforming
// destructuring ... is not supported yet"). With Vite's default 'modules' target
// (which includes safari14) this breaks both the production build (the parser
// worker bundle) and dev dependency pre-bundling (@deck.gl/core). Every browser
// we target natively supports destructuring, so tell esbuild to treat it as
// supported and never lower it — applied to the main transform AND the dep
// optimizer, which are separate esbuild passes. See esbuild#3743 / #4436
// (closed as not-planned). This keeps the Safari 14 floor rather than raising it.
const dontLowerDestructuring = { supported: { destructuring: true } };

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 1420,
		strictPort: true,
	},
	esbuild: dontLowerDestructuring,
	optimizeDeps: {
		esbuildOptions: dontLowerDestructuring,
	},
});
