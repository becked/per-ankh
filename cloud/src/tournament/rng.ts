// Tiny deterministic RNG (mulberry32) seeded from a string. Used by the
// pairing and map-assignment algorithms so a "regenerate" produces the same
// result for the same inputs — useful for debugging and for unit tests that
// don't want to special-case randomness.

function hashStringToUint32(s: string): number {
	// FNV-1a 32-bit. Good enough for seeding a PRNG.
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

export function createRng(seed: string): () => number {
	let state = hashStringToUint32(seed) || 1;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Fisher-Yates shuffle in-place. Caller passes its own RNG so the shuffle
// is deterministic per the caller's seed.
export function shuffle<T>(arr: T[], rng: () => number): T[] {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}
