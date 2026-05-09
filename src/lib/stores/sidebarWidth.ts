import { browser } from "$app/environment";
import { writable } from "svelte/store";

const KEY = "per-ankh:cloud:sidebar-width";

export const MIN_WIDTH = 120;
export const MAX_WIDTH = 480;
export const DEFAULT_WIDTH = 175;

function readInitial(): number {
	if (!browser) return DEFAULT_WIDTH;
	const raw = localStorage.getItem(KEY);
	if (raw === null) return DEFAULT_WIDTH;
	const n = Number(raw);
	if (!Number.isFinite(n)) return DEFAULT_WIDTH;
	return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
}

export const sidebarWidth = writable<number>(readInitial());

if (browser) {
	sidebarWidth.subscribe((v) => {
		localStorage.setItem(KEY, String(v));
	});
}

export function setSidebarWidth(px: number): void {
	const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, px));
	sidebarWidth.set(clamped);
}
