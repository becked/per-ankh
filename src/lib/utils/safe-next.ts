// Shared sanitizer for `?next=` redirect targets. Only same-origin paths are
// allowed; anything else collapses to "/dashboard". Used at every read site
// so a hand-crafted `?next=https://attacker.test/` link can't bounce a
// signed-in user off-site after login.
//
// Rules:
//   - Must start with "/" (relative path).
//   - Must NOT start with "//" (protocol-relative; would land on attacker host).
//   - Must NOT contain a backslash (\foo confuses some browsers into a host).
//   - Decoding errors fall back to the default.
//
// The same logic is mirrored in cloud/src/auth.ts so the server validates
// `next` before stashing it in OAuthPending — defense in depth.
export const DEFAULT_NEXT = "/dashboard";

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
