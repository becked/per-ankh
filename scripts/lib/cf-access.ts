// Cloudflare Access service-token headers. `staging.per-ankh.app` sits behind
// Access, so anything that fetches it anonymously gets the login page instead
// of the app — the deploy smoke probe and the OS-screenshot capture both have
// to present a token, and both build the same two headers.
//
// Where the token comes from is the caller's business: the gitignored
// `.staging.vars` at the repo root locally, CI secrets in the environment.
// This takes whichever map and returns null when it holds no token, leaving
// "absent is fatal" vs. "absent is a degraded mode" to the caller.

export function cfAccessHeaders(
	vars: Record<string, string | undefined>,
): Record<string, string> | null {
	const id = vars["CF_ACCESS_CLIENT_ID"];
	const secret = vars["CF_ACCESS_CLIENT_SECRET"];
	if (!id || !secret) return null;
	return {
		"CF-Access-Client-Id": id,
		"CF-Access-Client-Secret": secret,
	};
}
