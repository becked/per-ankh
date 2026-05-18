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
// In `vite dev` the cloud Worker runs on http://localhost:8787 and the
// frontend on http://localhost:1420 — two different origins, so
// client-side fetches need localhost whitelisted in connect-src.
// Production CSP stays tight (only api.per-ankh.app).
//
// Detection: `PER_ANKH_DEV=1` is set by the dev wrapper (scripts/per-ankh.ts)
// on the vite child process, plus by `npm run dev` via package.json's "dev"
// script. We previously sniffed process.argv for "dev", but that turned out
// to be unreliable — depending on how Node/tsx/Vite loads svelte.config.js
// (esbuild-bundle-then-import, ESM loader, worker thread, etc.) the argv
// available at config load time can be stripped down to just the node
// binary. An explicit env var is reliable across all of those.
//
// We don't use NODE_ENV because that's set by Vite *after* the CLI loads,
// and any value inherited from the shell (e.g. an exported
// `NODE_ENV=production` from a deploy session) wins at svelte.config
// load time — silently shipping a dev CSP without the localhost entry
// and breaking every cloudApi call in the browser.
//
// `cloudflareinsights.com` is the POST target for the Cloudflare Web
// Analytics beacon (the script itself loads from
// `static.cloudflareinsights.com`, allowed in script-src below).
// Cloudflare auto-injects the beacon when Web Analytics is enabled on
// the Worker; without both directives the script loads-and-blocks and
// the beacon submission fails.
const isDev = process.env.PER_ANKH_DEV === "1";
const connectSrc = [
	"self",
	"https://api.per-ankh.app",
	"https://cloudflareinsights.com",
];
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
				"script-src": ["self", "https://static.cloudflareinsights.com"],
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
