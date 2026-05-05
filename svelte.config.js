// Build target is selected at build time via the BUILD_TARGET env var:
//   - tauri (default): adapter-static + SPA fallback. Tauri has no Node server,
//     so the desktop app needs a fully-static bundle.
//   - cloud: adapter-cloudflare for SSR. Required so public game pages
//     server-render OG meta tags for Discord/Slack/Twitter unfurling.
import staticAdapter from "@sveltejs/adapter-static";
import cloudflareAdapter from "@sveltejs/adapter-cloudflare";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const target = process.env.BUILD_TARGET ?? "tauri";

const adapter =
	target === "cloud"
		? cloudflareAdapter({})
		: staticAdapter({ fallback: "index.html" });

// CSP applies only to the cloud build. Tauri has its own CSP via
// tauri.conf.json and doesn't go through SvelteKit's CSP integration.
//
// `mode: "hash"` lets SvelteKit emit sha256 hashes for its inline
// hydration script automatically — no `unsafe-inline` for scripts.
//
// `style-src 'unsafe-inline'` is a known compromise: Svelte transitions,
// bits-ui portals, and ECharts inject inline `style=` attributes whose
// hashes change too frequently to enumerate. Tighten only after CSP-report
// data shows it's safe.
// In `vite dev` (NODE_ENV !== "production") the cloud Worker runs on
// http://localhost:8787 and the frontend on http://localhost:1420 — two
// different origins, so client-side fetches need it whitelisted in
// connect-src. Production CSP stays tight (only api.per-ankh.app).
const isDev = process.env.NODE_ENV !== "production";
const connectSrc = ["self", "https://api.per-ankh.app"];
if (isDev) connectSrc.push("http://localhost:8787");

const cloudCsp = {
	mode: /** @type {const} */ ("hash"),
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
	},
};

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter,
		...(target === "cloud" ? { csp: cloudCsp } : {}),
	},
};

export default config;
