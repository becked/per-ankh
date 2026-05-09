// Mac-style auto-hide scrollbar action. CSS in src/app.css (.cloud-scroll)
// keys off the `data-scrolling` attribute to fade the thumb in/out. Browsers
// don't apply the OS auto-hide behavior to ::-webkit-scrollbar styled bars,
// so we mimic it here.

export function autohideScroll(node: HTMLElement): { destroy(): void } {
	let timer: ReturnType<typeof setTimeout> | null = null;

	const onScroll = (): void => {
		node.dataset.scrolling = "1";
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			delete node.dataset.scrolling;
		}, 700);
	};

	node.addEventListener("scroll", onScroll, { passive: true });

	return {
		destroy(): void {
			node.removeEventListener("scroll", onScroll);
			if (timer) clearTimeout(timer);
		},
	};
}
