// Shared sanitizer for `?next=` redirect targets. Only same-origin paths are
// allowed; anything else collapses to "/". Used at every read site so a
// hand-crafted `?next=https://attacker.test/` link can't bounce a signed-in
// user off-site after login.
//
// Rules:
//   - Must start with "/" (relative path).
//   - Must NOT start with "//" (protocol-relative; would land on attacker host).
//   - Must NOT contain a backslash (\foo confuses some browsers into a host).
//   - Decoding errors fall back to the default.
//
// The same logic is mirrored in cloud/src/auth.ts so the server validates
// `next` before stashing it in OAuthPending — defense in depth.
export const DEFAULT_NEXT = "/";

export function safeNext(raw: string | null | undefined): string {
	if (!raw) return DEFAULT_NEXT;
	let decoded: string;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		return DEFAULT_NEXT;
	}
	if (!decoded.startsWith("/")) return DEFAULT_NEXT;
	if (decoded.startsWith("//")) return DEFAULT_NEXT;
	if (decoded.includes("\\")) return DEFAULT_NEXT;
	return decoded;
}

// Where to send the viewer after login. Prefer an explicit `?next=` (we were
// bounced to this page from a gated route, see loginBounce) over a snapshot of
// the current URL — otherwise a visitor sitting on `/?next=/foo` would have the
// whole nested home URL captured as the post-login target and land back on home
// instead of `/foo`. Both branches are sanitized.
export function resolveLoginNext(url: URL): string {
	const explicit = url.searchParams.get("next");
	return explicit ? safeNext(explicit) : safeNext(url.pathname + url.search);
}

// The redirect target a gated `load()` throws for an anonymous visitor: bounce
// to the home/login surface carrying the originally-requested path+search as
// `?next=` so it round-trips through OAuth and the viewer returns here.
export function loginBounce(url: URL): string {
	return `/?next=${encodeURIComponent(url.pathname + url.search)}`;
}
