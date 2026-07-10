import adapter from "@sveltejs/adapter-cloudflare";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// `mode: "hash"` lets SvelteKit emit sha256 hashes for its inline
// hydration script automatically — no `unsafe-inline` for scripts.
//
// `style-src 'unsafe-inline'` is a known compromise: Svelte transitions,
// bits-ui portals, and ECharts inject inline `style=` attributes whose
// hashes change too frequently to enumerate. Tighten only after CSP-report
// data shows it's safe.
//
// CSP here describes the PRODUCTION policy. Builds that talk to a
// different API origin — `vite dev` (the wrangler dev Worker on
// http://localhost:8787) and staging (api-staging.per-ankh.app) — get
// their connect-src / report-uri rewritten at SSR time by
// src/hooks.server.ts, keyed off the build-time `VITE_API_URL` constant.
// We tried branching here instead (first via process.argv, then via
// PER_ANKH_DEV) and both were unreliable — `svelte.config.js` is loaded
// in a context where `process.env` and `process.argv` aren't what we
// expect, so the branch silently never fires. `import.meta.env` baked by
// Vite into the bundle is the source of truth and works correctly at
// request time.
//
// `cloudflareinsights.com` is the POST target for the Cloudflare Web
// Analytics beacon (the script itself loads from
// `static.cloudflareinsights.com`, allowed in script-src below).
// Cloudflare auto-injects the beacon when Web Analytics is enabled on
// the Worker; without both directives the script loads-and-blocks and
// the beacon submission fails.
//
// `report-uri` is the legacy violation-report endpoint; `report-to`
// names the modern endpoint group declared in the Report-To header set
// in src/hooks.server.ts. Older browsers honor only `report-uri`,
// newer browsers prefer `report-to` but fall back. The Worker accepts
// both formats.

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({}),
		csp: {
			mode: "hash",
			directives: {
				"default-src": ["self"],
				"script-src": ["self", "https://static.cloudflareinsights.com"],
				"style-src": ["self", "unsafe-inline"],
				// cdn.discordapp.com: user avatars. *.ytimg.com: YouTube video
				// thumbnails on the profile Videos tab — YouTube's image CDN rotates
				// numbered subdomains (i1–i9.ytimg.com), so a wildcard is required.
				// Add each new video platform's thumbnail host here as providers are
				// added (e.g. Twitch: https://static-cdn.jtvnw.net).
				"img-src": [
					"self",
					"data:",
					"https://cdn.discordapp.com",
					"https://*.ytimg.com",
				],
				"connect-src": [
					"self",
					"https://api.per-ankh.app",
					"https://cloudflareinsights.com",
				],
				"font-src": ["self"],
				"object-src": ["none"],
				"frame-ancestors": ["none"],
				"base-uri": ["self"],
				"report-uri": ["https://api.per-ankh.app/v1/csp-report"],
				"report-to": ["csp-endpoint"],
			},
		},
	},
};

export default config;
