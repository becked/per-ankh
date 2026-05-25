// Transient notification store. Replaces native alert() for error (and
// occasional info) messages. A classic writable store — not module-level
// $state — so it can be imported and called imperatively from anywhere
// (event handlers, async catch blocks) and subscribed to with `$toasts`
// inside Toaster.svelte. The host component is mounted once in the root
// layout.
import { writable } from "svelte/store";

export type ToastKind = "error" | "info";
export type Toast = { id: number; kind: ToastKind; message: string };

const store = writable<Toast[]>([]);
let nextId = 0;

const DEFAULT_TTL = 5000;

function push(kind: ToastKind, message: string, ttl = DEFAULT_TTL): void {
	const id = nextId++;
	store.update((list) => [...list, { id, kind, message }]);
	// Toasts are only ever pushed from client event handlers, so this timer
	// never runs during SSR.
	if (ttl > 0) setTimeout(() => dismiss(id), ttl);
}

function dismiss(id: number): void {
	store.update((list) => list.filter((t) => t.id !== id));
}

export const toasts = { subscribe: store.subscribe };

export const toast = {
	error: (message: string): void => push("error", message),
	info: (message: string): void => push("info", message),
	dismiss,
};
