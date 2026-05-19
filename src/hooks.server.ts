// Security headers emitted on every SSR'd response.
//
// CSP is configured in svelte.config.js with PRODUCTION values so
// SvelteKit can inject hashes for its inline hydration script. In dev
// we widen the emitted CSP header here (see patchCspForDev below) —
// `dev` from `$app/environment` is the reliable signal; the dev branch
// in svelte.config.js itself can't be trusted because that file is
// loaded in a context where neither process.argv nor process.env is
// what we expect.
//
// Other hardening — XFO, Referrer-Policy, Permissions-Policy, X-Content-
// Type-Options — applies regardless of the request type.

import type { Handle, HandleFetch } from "@sveltejs/kit";
import { dev } from "$app/environment";

const DEV_API_ORIGIN = "http://localhost:8787";
const DEV_REPORT_URI = `${DEV_API_ORIGIN}/v1/csp-report`;

// Rewrite the production CSP header SvelteKit emits to the variant we
// need in `vite dev`: add the wrangler-dev API origin to connect-src
// (cross-origin fetches from :1420 → :8787) and swap report-uri to the
// dev worker. Idempotent — re-running on an already-patched header is a
// no-op.
function patchCspForDev(header: string): string {
	const directives = new Map<string, string[]>();
	for (const part of header.split(";")) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const [name, ...values] = trimmed.split(/\s+/);
		directives.set(name, values);
	}
	const connectSrc = directives.get("connect-src") ?? [];
	if (!connectSrc.includes(DEV_API_ORIGIN)) {
		connectSrc.push(DEV_API_ORIGIN);
		directives.set("connect-src", connectSrc);
	}
	if (directives.has("report-uri")) {
		directives.set("report-uri", [DEV_REPORT_URI]);
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
	endpoints: [
		{
			url: dev
				? "http://localhost:8787/v1/csp-report"
				: "https://api.per-ankh.app/v1/csp-report",
		},
	],
});

// Cross-origin SSR fetch to the API needs the incoming request's Cookie
// header forwarded by hand — SvelteKit's `event.fetch` does not forward
// cookies cross-origin (browser-like security). Without this, hard
// refreshes of authenticated pages (e.g. /games/[id], /dashboard) call
// the API server-side with no auth and get 401, redirecting to /
// despite the user having a valid session cookie.
//
// Pairs with cloud/src/session.ts setting Domain=per-ankh.app on the
// session cookie — that's what makes the cookie visible on per-ankh.app
// (where SSR reads it) in the first place.
export const handleFetch: HandleFetch = ({ event, request, fetch }) => {
	const target = new URL(request.url);
	const isApi =
		target.hostname === "api.per-ankh.app" ||
		(dev && target.hostname === "localhost" && target.port === "8787");
	if (isApi) {
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

	if (dev) {
		const csp = response.headers.get("content-security-policy");
		if (csp)
			response.headers.set("content-security-policy", patchCspForDev(csp));
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
