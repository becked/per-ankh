// One floating card over the map, opened by pointing at the thing it names
// and pinned there by a right-click. Held by the map page, which owns both
// cards the map has — a city's and a unit's — so the two behave identically
// rather than drifting apart as two copies of this would.
//
// Pointing at a marker is enough to open it. bits-ui has this built in
// (`openOnHover` on `Popover.Trigger`, with a safe-polygon bridge), but it
// hangs off the trigger's own node, and neither card has a trigger: a city
// banner is drawn inside SpriteMap and a unit marker inside its canvas, while
// both cards need the whole game, so they are anchored from the page. Hence
// the two halves of hover intent by hand, at the delays already in use — the
// open delay is the chrome's own tooltips (`delayDuration={200}`, MapChrome and
// MapYieldStrip), the close delay is bits-ui's `closeDelay` default for the
// trigger above.
//
// A right-click LOCKS what hover opened — the gesture that locks a tile's
// panel to its hex, so the map has one vocabulary rather than a card that
// pinned on a click beside tiles that lock on a right-click. Unlocking hands
// the card back to the pointer instead of closing it, as unlocking a tile
// hands its hex back to the hover panel. Locking is pointer-only: the map view
// is desktop-only (#270).
//
// Neither card answers an outside click, locked or not — the page passes
// `interactOutsideBehavior: "ignore"` in both states. The card is portaled to
// `document.body`, so bits-ui counts a press on the very thing holding it open
// as an interaction outside it: the default took the card down at the start of
// every pan, and on a plain left-click on its own marker, which nothing then
// undid — SpriteMap raises a hover only on a CHANGE of marker, so a card
// dismissed under a stationary pointer stayed down until the pointer left and
// came back. A tile panel, a plain div with nothing listening for a click, has
// never had either problem. Closing is the pointer leaving while unlocked, the
// ✕ or a second right-click while locked, and Escape either way.
//
// Two things follow from the lock outliving the pointer. Hovering another
// marker leaves a locked card where it is rather than carrying it over and
// dropping the lock, as hovering another hex leaves a locked tile panel alone.
// And the card goes off screen with what it names: it is anchored to something
// the camera can carry out of the map box, so SpriteMap reports that crossing
// and the card comes down until it is back — the cull a locked tile panel does
// for itself.

const HOVER_OPEN_MS = 200;
const HOVER_CLOSE_MS = 300;

/**
 * The state of one such card, keyed by whatever names the thing it is open on
 * — a city's name, a unit's `xml_id`. Compared with `===`, so the key is a
 * primitive.
 */
export class HoverLockCard<K extends string | number> {
	/** What the card is open on, or null when it is closed. */
	key = $state<K | null>(null);
	/** The element it is anchored to, which rides the camera. */
	anchor = $state<HTMLElement | null>(null);
	/** Whether a right-click has pinned it, so the pointer no longer owns it. */
	locked = $state(false);
	/** Whether the camera has carried its anchor off the canvas. */
	offCanvas = $state(false);

	#openTimer: ReturnType<typeof setTimeout> | null = null;
	#closeTimer: ReturnType<typeof setTimeout> | null = null;

	/** What the Popover's `open` takes: standing on something, and on screen. */
	get open(): boolean {
		return this.key !== null && !this.offCanvas;
	}

	#cancelOpen(): void {
		if (this.#openTimer === null) return;
		clearTimeout(this.#openTimer);
		this.#openTimer = null;
	}

	/**
	 * Called by the card itself on pointer-enter: the pointer has crossed from
	 * the marker into the card, which must not then close under it.
	 */
	cancelClose(): void {
		if (this.#closeTimer === null) return;
		clearTimeout(this.#closeTimer);
		this.#closeTimer = null;
	}

	/** Open on `key`, anchored to `element`. The cull starts clear — the thing
	 * it opens on is the one the pointer is on. */
	#openOn(key: K, element: HTMLElement, locked: boolean): void {
		this.key = key;
		this.anchor = element;
		this.locked = locked;
		this.offCanvas = false;
	}

	/**
	 * Hover, or keyboard focus, on a marker. Both arrive here so the card opens
	 * the same way either way — and neither disturbs a locked card, which only
	 * the ✕ or a second right-click takes back.
	 */
	hover(key: K, element: HTMLElement): void {
		if (this.locked) return;
		this.cancelClose();
		if (this.key === key) return;
		this.#cancelOpen();
		this.#openTimer = setTimeout(() => {
			this.#openTimer = null;
			this.#openOn(key, element, false);
		}, HOVER_OPEN_MS);
	}

	/**
	 * The pointer left the marker, or the card. Either way the card has to
	 * outlast the crossing between them — they are a `sideOffset` apart, and
	 * the card is where a long record is read and scrolled.
	 */
	leave(): void {
		this.#cancelOpen();
		if (this.key === null || this.locked) return;
		this.cancelClose();
		this.#closeTimer = setTimeout(() => {
			this.#closeTimer = null;
			this.key = null;
			this.anchor = null;
		}, HOVER_CLOSE_MS);
	}

	/**
	 * A marker was right-clicked. Toggles, as it does on a tile: a second
	 * right-click on the locked card's own marker unlocks it in place — the
	 * pointer is still on the marker, so the card stays up as the transient one
	 * it would have been and goes when the pointer does.
	 */
	toggleLock(key: K, element: HTMLElement): void {
		this.#cancelOpen();
		this.cancelClose();
		if (this.locked && this.key === key) {
			this.locked = false;
			return;
		}
		this.#openOn(key, element, true);
	}

	/** Close outright: the ✕, Escape, or the thing it names going away. */
	close(): void {
		this.#cancelOpen();
		this.cancelClose();
		this.key = null;
		this.anchor = null;
		this.locked = false;
		this.offCanvas = false;
	}

	/** SpriteMap's answer on whether the anchor is still on the canvas. */
	setOffCanvas(offCanvas: boolean): void {
		this.offCanvas = offCanvas;
	}

	/**
	 * Drop the pending timers. They outlive the component otherwise: scrubbing
	 * to a turn that drops the marker, or navigating away, can land between the
	 * hover and the open.
	 */
	dispose(): void {
		this.#cancelOpen();
		this.cancelClose();
	}
}
