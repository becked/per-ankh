// Copy text to the clipboard. Resolves true on success so callers can gate
// their "Copied!" feedback on it.
//
// The async Clipboard API is available in every "secure context" — HTTPS and
// localhost — which covers production (per-ankh.app) and normal dev. It fails
// (resolves false) only when the page is served from a non-secure origin, e.g.
// the dev server reached by LAN IP over plain http, where navigator.clipboard
// is absent or writeText rejects.
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
