// Security headers emitted on every SSR'd response.
//
// CSP is configured in svelte.config.js with PRODUCTION values so
// SvelteKit can inject hashes for its inline hydration script. When this
// build talks to a non-prod API — vite dev (localhost:8787) or a staging
// build (api-staging) — we rewrite the emitted CSP header here (see
// patchCspApiOrigin below). The build-time `VITE_API_URL` constant is the
// reliable signal; a branch in svelte.config.js itself can't be trusted
// because that file is loaded in a context where neither process.argv
// nor process.env is what we expect.
//
// Other hardening — XFO, Referrer-Policy, Permissions-Policy, X-Content-
// Type-Options — applies regardless of the request type.

import { env as privateEnv } from "$env/dynamic/private";
import type { Handle, HandleFetch } from "@sveltejs/kit";

// Build-time API base — the same var the API client reads
// (src/lib/api-cloud.ts) and the staging deploy injects, so connect-src,
// both CSP report endpoints, and the SSR cookie-forward check all follow
// one origin. Defaults to prod; `vite dev` gets localhost:8787 from the
// committed .env.development.
const PROD_API_ORIGIN = "https://api.per-ankh.app";
const API_ORIGIN = new URL(
	(import.meta.env.VITE_API_URL ?? `${PROD_API_ORIGIN}/v1`) as string,
).origin;
const REPORT_URI = `${API_ORIGIN}/v1/csp-report`;

// Rewrite the production CSP header SvelteKit emits so it points at this
// build's actual API origin: swap the prod origin in connect-src, retarget
// report-uri, and — in dev only — admit the API origin to img-src, because
// locally the Worker is also the image host. Idempotent — re-running on an
// already-patched header is a no-op.
function patchCspApiOrigin(header: string): string {
	const directives = new Map<string, string[]>();
	for (const part of header.split(";")) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const [name, ...values] = trimmed.split(/\s+/);
		directives.set(name, values);
	}
	const connectSrc = directives.get("connect-src") ?? [];
	const prodIdx = connectSrc.indexOf(PROD_API_ORIGIN);
	if (prodIdx >= 0) {
		connectSrc[prodIdx] = API_ORIGIN;
		directives.set("connect-src", connectSrc);
	} else if (!connectSrc.includes(API_ORIGIN)) {
		connectSrc.push(API_ORIGIN);
		directives.set("connect-src", connectSrc);
	}
	if (directives.has("report-uri")) {
		directives.set("report-uri", [REPORT_URI]);
	}
	// Under `vite dev` the image host is the API origin: production serves
	// screenshots from img.per-ankh.app (an R2 custom domain, no Worker in the
	// path), which has no local equivalent, so the dev Worker serves them from
	// its own GET /v1/dev/images/* route instead. img-src has to name it or
	// every tile is CSP-blocked rather than merely missing.
	//
	// `import.meta.env.DEV` and not `API_ORIGIN !== PROD_API_ORIGIN`, which is
	// also true for a staging build: staging's images come from
	// img.staging.per-ankh.app, already in the baked policy, so adding its API
	// origin there would widen the policy for a host that serves no images.
	if (import.meta.env.DEV) {
		const imgSrc = directives.get("img-src") ?? [];
		if (!imgSrc.includes(API_ORIGIN)) {
			imgSrc.push(API_ORIGIN);
			directives.set("img-src", imgSrc);
		}
	}
	return [...directives.entries()]
		.map(([name, values]) => `${name} ${values.join(" ")}`)
		.join("; ");
}

// Headers from server-side fetches in load() that we need to read in
// our API client. By default SvelteKit filters all response headers from
// `event.fetch` for security (don't leak Set-Cookie etc. to the client).
// We need content-type so the request() helper in api-cloud.ts can
// distinguish JSON error bodies from text. Cache-Control is forwarded so
// the browser respects upstream cache hints when the page is hydrated.
const ALLOWED_RESPONSE_HEADERS = new Set([
	"content-type",
	"cache-control",
	"content-disposition",
]);

// Reporting API endpoint group declaration. The CSP `report-to`
// directive (svelte.config.js) names this group; the directive alone
// doesn't tell the browser where to send reports — this header does.
// Same destination as `report-uri` for legacy fallback.
const reportToHeader = JSON.stringify({
	group: "csp-endpoint",
	max_age: 10886400,
	endpoints: [{ url: REPORT_URI }],
});

// Cross-origin SSR fetch to the API needs the incoming request's Cookie
// header forwarded by hand — SvelteKit's `event.fetch` does not forward
// cookies cross-origin (browser-like security). Without this, hard
// refreshes of authenticated pages (e.g. /games/[id], /dashboard) call
// the API server-side with no auth and get 401, redirecting to /
// despite the user having a valid session cookie.
//
// Pairs with cloud/src/session.ts setting Domain=per-ankh.app on the
// session cookie — that's what makes the cookie visible on the frontend
// hostname (where SSR reads it) in the first place.
//
// The visitor's address needs forwarding for the same reason and doesn't
// survive the hop either: this fetch leaves as a fresh request from
// Cloudflare's egress, so the API sees one address for every SSR visitor at
// once and its per-IP rate limits count the whole site into one bucket (the
// 2026-08-05 outage). SSR_TRUSTED_KEY is what lets the API believe the
// address we send instead — a caller who can't present it gets these headers
// stripped, so nothing here lets a visitor claim someone else's IP. Unset on
// either side means no forwarding, which is exactly the old behaviour, so the
// two Workers can be deployed in either order.
//
// The address is all we forward. The visitor's User-Agent doesn't survive the
// hop either, and sending it would switch on the API's scraper exemption
// (isScraperUA in cloud/src/games.ts) for ordinary site traffic — an exemption
// keyed on a string the caller types, granted before both the rate-limit gate
// and its audit row. Anyone sending `User-Agent: Discordbot/2.0` here would
// become unmetered and invisible at once. Forwarding the address alone already
// leaves link-preview crawlers better off than they were: metered against
// their own IP instead of pooled onto the egress with everyone else.
//
// Header names are duplicated from cloud/src/util.ts — separate builds, no
// shared module between them.
export const handleFetch: HandleFetch = ({ event, request, fetch }) => {
	if (new URL(request.url).origin === API_ORIGIN) {
		const cookie = event.request.headers.get("cookie");
		if (cookie) request.headers.set("cookie", cookie);

		const ssrKey = privateEnv.SSR_TRUSTED_KEY;
		if (ssrKey) {
			request.headers.set("X-SSR-Key", ssrKey);
			// CF-Connecting-IP is what the API reads for everyone else; falling
			// back to getClientAddress() keeps `vite dev` (no edge headers) on the
			// same path rather than leaving it untested until production.
			const clientIp =
				event.request.headers.get("CF-Connecting-IP") ??
				event.getClientAddress();
			// Deleted, not just conditionally set: the key goes out unconditionally
			// above, so a request that reached this subrequest carrying an address
			// we didn't put there would go out keyed and believed. Nothing copies
			// visitor headers onto a cross-origin server fetch today — this is what
			// keeps that from being load-bearing.
			request.headers.delete("X-SSR-Client-IP");
			if (clientIp) request.headers.set("X-SSR-Client-IP", clientIp);
		}
	}
	return fetch(request);
};

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			ALLOWED_RESPONSE_HEADERS.has(name.toLowerCase()),
	});

	// Prod builds already carry the right origin in the baked CSP — only
	// dev (localhost API) and staging builds need the rewrite.
	if (API_ORIGIN !== PROD_API_ORIGIN) {
		const csp = response.headers.get("content-security-policy");
		if (csp)
			response.headers.set("content-security-policy", patchCspApiOrigin(csp));
	}

	response.headers.set("X-Content-Type-Options", "nosniff");
	// Block iframe embedding entirely. Public game cards work without
	// iframes (Discord/Slack/Twitter scrape OG tags then render their own
	// preview). If embed support becomes desirable later, switch to a
	// `frame-ancestors` allowlist.
	response.headers.set("X-Frame-Options", "DENY");
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	response.headers.set(
		"Permissions-Policy",
		"camera=(), microphone=(), geolocation=()",
	);
	response.headers.set("Report-To", reportToHeader);

	return response;
};
