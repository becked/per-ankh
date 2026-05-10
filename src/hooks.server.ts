// Security headers emitted on every SSR'd response.
//
// CSP is configured separately via `kit.csp` in svelte.config.js so
// SvelteKit can inject hashes for its inline hydration script. Other
// hardening — XFO, Referrer-Policy, Permissions-Policy, X-Content-Type-
// Options — applies regardless of the request type.

import type { Handle } from "@sveltejs/kit";
import { dev } from "$app/environment";

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

export const handle: Handle = async ({ event, resolve }) => {
	// Legacy share URLs (minted by desktop v0.2.0 as
	// `https://per-ankh.app/share/[id]`) are served by the frozen `web/`
	// SPA, which now lives on `legacy.per-ankh.app`. 302 so we can fold
	// /share/* back into this app later without fighting cached 301s.
	if (event.url.pathname.startsWith("/share/")) {
		const id = event.url.pathname.slice("/share/".length);
		return Response.redirect(
			`https://legacy.per-ankh.app/share/${id}`,
			302,
		);
	}

	const response = await resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			ALLOWED_RESPONSE_HEADERS.has(name.toLowerCase()),
	});

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
