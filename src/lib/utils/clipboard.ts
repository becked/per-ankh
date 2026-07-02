// Copy text to the clipboard, resilient to non-secure contexts.
//
// The async Clipboard API (navigator.clipboard) is only reliable in "secure
// contexts" — HTTPS or localhost. When the app is reached over plain http by
// LAN IP (e.g. a dev server at http://192.168.1.123:1420 opened from another
// machine), writeText is either absent or rejects, so copy silently fails.
//
// Crucially, we must NOT await a failing clipboard call before the fallback:
// once the promise rejects we're in a microtask and the click's user-gesture
// window has closed, so the legacy execCommand("copy") — which requires an
// active gesture — no longer works. So in a non-secure context we skip the
// async API entirely and run the synchronous legacy path inline.
//
// Returns true on success so callers can gate their "Copied!" feedback on it.
export async function copyToClipboard(text: string): Promise<boolean> {
	if (window.isSecureContext && navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Denied despite a secure context — fall through to the legacy path.
		}
	}
	return legacyCopy(text);
}

// Legacy execCommand("copy") fallback for plain-http (non-secure) contexts.
// Deprecated but the only option without navigator.clipboard.
//
// It copies via a document Selection/Range rather than focusing a hidden
// <textarea>: inside a popover/dialog the focus scope steals focus straight
// back from an off-screen input, so ta.select() ends up selecting nothing and
// the copy silently no-ops. A Range selection isn't tied to the active element,
// so execCommand("copy") grabs it regardless of who holds focus. Runs
// synchronously to stay inside the triggering click's user-gesture window.
function legacyCopy(text: string): boolean {
	const selection = window.getSelection();
	if (!selection) return false;
	const span = document.createElement("span");
	span.textContent = text;
	span.style.whiteSpace = "pre"; // preserve newlines in the copied text
	span.style.position = "fixed";
	span.style.top = "0";
	span.style.left = "0";
	span.style.opacity = "0";
	span.style.pointerEvents = "none";
	document.body.appendChild(span);

	const saved = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
	const range = document.createRange();
	range.selectNodeContents(span);
	selection.removeAllRanges();
	selection.addRange(range);

	let ok = false;
	try {
		ok = document.execCommand("copy");
	} catch {
		ok = false;
	}

	selection.removeAllRanges();
	if (saved) selection.addRange(saved); // restore the user's prior selection
	document.body.removeChild(span);
	return ok;
}
