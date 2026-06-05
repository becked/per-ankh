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
// build's actual API origin: swap the prod origin in connect-src and
// retarget report-uri. Idempotent — re-running on an already-patched
// header is a no-op.
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
export const handleFetch: HandleFetch = ({ event, request, fetch }) => {
	if (new URL(request.url).origin === API_ORIGIN) {
		const cookie = event.request.headers.get("cookie");
		if (cookie) request.headers.set("cookie", cookie);
	}
	return fetch(request);
};

export const handle: Handle = async ({ event, resolve }) => {
	// Legacy share URLs (minted by desktop v0.2.0 as
	// `https://per-ankh.app/share/[id]`) are served by the frozen `web/`
	// SPA, which now lives on `legacy.per-ankh.app`. 302 so we can fold
	// /share/* back into this app later without fighting cached 301s.
	if (event.url.pathname.startsWith("/share/")) {
		const id = event.url.pathname.slice("/share/".length);
		return Response.redirect(`https://legacy.per-ankh.app/share/${id}`, 302);
	}

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
