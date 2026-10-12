// Marks the element being scrolled with `data-scrolling="1"` so the global
// scrollbar rules in src/app.css can brighten its thumb, then clears the mark
// once scrolling stops. Browsers don't apply the OS auto-hide behavior to
// ::-webkit-scrollbar styled bars, so we mimic it here.
//
// Wired once, in the root layout, as `<svelte:document onscrollcapture={...} />`:
// `scroll` doesn't bubble, but it does capture, so one document-level handler
// in the capture phase sees scrolls from every container in the app — which is
// the point, since the per-container action this replaced had to be remembered
// at each new call site.

const CLEAR_DELAY_MS = 700;

// Per-element, because two containers can be mid-scroll at once (a popover
// list inside a scrolled page). Entries are deleted as they fire, so this
// holds at most the elements scrolled in the last CLEAR_DELAY_MS.
const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

export function markScrolling(event: Event): void {
	const node = event.target;
	// Scrolls of the document itself target a Document, which has no dataset.
	// (html/body are `overflow: hidden` here, so this is the rare case.)
	if (!(node instanceof HTMLElement)) return;

	// Scroll fires every frame while the wheel spins; skip the attribute write
	// — and the style invalidation behind it — once the mark is already set.
	if (node.dataset.scrolling !== "1") node.dataset.scrolling = "1";

	const pending = timers.get(node);
	if (pending) clearTimeout(pending);
	timers.set(
		node,
		setTimeout(() => {
			timers.delete(node);
			delete node.dataset.scrolling;
		}, CLEAR_DELAY_MS),
	);
}
