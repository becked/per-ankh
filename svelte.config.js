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
// In `vite dev` (NODE_ENV !== "production") the cloud Worker runs on
// http://localhost:8787 and the frontend on http://localhost:1420 — two
// different origins, so client-side fetches need it whitelisted in
// connect-src. Production CSP stays tight (only api.per-ankh.app).
const isDev = process.env.NODE_ENV !== "production";
const connectSrc = ["self", "https://api.per-ankh.app"];
if (isDev) connectSrc.push("http://localhost:8787");

// Violation reports go to the API Worker. Sending to both the legacy
// `report-uri` and the modern `report-to` (group declared via the
// Report-To header set in src/hooks.server.ts) maximizes coverage —
// older browsers honor only `report-uri`, newer browsers prefer
// `report-to` but fall back. The endpoint accepts both formats.
const cspReportUri = isDev
	? "http://localhost:8787/v1/csp-report"
	: "https://api.per-ankh.app/v1/csp-report";

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({}),
		csp: {
			mode: "hash",
			directives: {
				"default-src": ["self"],
				"script-src": ["self"],
				"style-src": ["self", "unsafe-inline"],
				"img-src": ["self", "data:", "https://cdn.discordapp.com"],
				"connect-src": connectSrc,
				"font-src": ["self"],
				"object-src": ["none"],
				"frame-ancestors": ["none"],
				"base-uri": ["self"],
				"report-uri": [cspReportUri],
				"report-to": ["csp-endpoint"],
			},
		},
	},
};

export default config;
