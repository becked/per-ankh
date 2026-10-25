// Bounded-concurrency map for the corpus sweeps in scripts/admin/commands/.
//
// Shared because the sweeps want the same ceiling for the same two reasons:
// wrangler spawns dominate the wall clock, and each decompressed save is held
// in memory while it is worked on. A chunked `Promise.all` would idle the pool
// on every slow save in a chunk; this keeps `limit` in flight continuously.

export async function mapLimit<T>(
	items: readonly T[],
	limit: number,
	task: (item: T, index: number) => Promise<void>,
): Promise<void> {
	let next = 0;
	const workers = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			for (;;) {
				const i = next++;
				if (i >= items.length) return;
				await task(items[i], i);
			}
		},
	);
	await Promise.all(workers);
}
