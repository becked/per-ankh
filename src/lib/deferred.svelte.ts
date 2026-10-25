// A chunk fetched on demand: the slot that holds what it resolved to, plus the
// state its host renders from while the fetch is in flight.
//
// Declare a slot at module level rather than per component instance. Every
// host that needs the chunk then shares one fetch, and the hosts that render
// after the first have nothing to wait for. Two chunks go through this: the
// game-detail tabs (game-detail/tab-components.svelte.ts) and ECharts
// (echarts-deferred.svelte.ts).
//
// A failed fetch latches. The cause it exists for is a deploy, where the chunk
// being asked for is a file the new build no longer serves, and a retry
// against the same stale manifest would fail the same way — so the host offers
// a reload, which lands on the new build (ui/ChunkFallback.svelte).

export type Deferred<T> = {
	/** What the chunk resolved to, once it has arrived. */
	readonly value: T | undefined;
	/** True once the chunk has failed to arrive. */
	readonly failed: boolean;
	/** Fetch the chunk, at most once per page load. */
	start: () => void;
};

export function deferred<T>(load: () => Promise<T>): Deferred<T> {
	let value = $state<T>();
	let failed = $state(false);
	let started = false;

	return {
		get value(): T | undefined {
			return value;
		},
		get failed(): boolean {
			return failed;
		},
		start(): void {
			if (started) return;
			started = true;
			load().then(
				(resolved) => (value = resolved),
				() => (failed = true),
			);
		},
	};
}
