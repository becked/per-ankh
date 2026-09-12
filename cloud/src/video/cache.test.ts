import { describe, expect, it } from "vitest";
import { getVideosCached } from "./cache";
import { UncacheableVideos, type Video, type VideoEnv } from "./types";

const video = (id: string, published_at: string): Video => ({
	id,
	title: id,
	url: `https://www.youtube.com/watch?v=${id}`,
	thumbnail_url: null,
	published_at,
	platform: "youtube",
	duration_seconds: null,
});

const AIRED = [video("BROADCAST01", "2026-07-31T01:04:43Z")];
const VOD_DATED = [video("BROADCAST01", "2026-07-31T15:27:03Z")];

// The cache only ever get()s and put()s one key, so a Map stands in for KV.
// `puts` records writes, which is what these tests are actually about.
function fakeEnv(): {
	env: VideoEnv;
	store: Map<string, string>;
	puts: string[];
} {
	const store = new Map<string, string>();
	const puts: string[] = [];
	const env = {
		SESSIONS_KV: {
			get: (k: string) => Promise.resolve(store.get(k) ?? null),
			put: (k: string, v: string) => {
				puts.push(k);
				store.set(k, v);
				return Promise.resolve();
			},
		},
	} as unknown as VideoEnv;
	return { env, store, puts };
}

// Collects the background refresh the stale path hands to waitUntil, so a test
// can await it instead of racing it.
function fakeCtx(): { ctx: ExecutionContext; settled: () => Promise<unknown> } {
	const pending: Promise<unknown>[] = [];
	const ctx = {
		waitUntil: (p: Promise<unknown>) => {
			pending.push(p);
		},
	} as unknown as ExecutionContext;
	return { ctx, settled: () => Promise.all(pending) };
}

// Age the single cached entry past the 1h soft TTL. Reads the key back out of
// the store rather than rebuilding it, so this doesn't pin CACHE_VERSION.
function makeStale(store: Map<string, string>): void {
	const [key] = [...store.keys()];
	const entry = JSON.parse(store.get(key) as string) as { fetched_at: number };
	entry.fetched_at = Date.now() - 2 * 60 * 60 * 1000;
	store.set(key, JSON.stringify(entry));
}

describe("getVideosCached", () => {
	// The bug this guards: CACHE_VERSION is what orphans entries written before a
	// shape change. Miss the bump and a warm entry is read back through
	// `cached.videos as T[]` and served with the new field absent from the JSON
	// entirely — not null — for up to the 24h hard TTL. This repo has been bitten
	// by exactly that once already: the `!= null` guard in tournament/public.ts
	// exists only because a v1 entry had no uploader ids on its videos.
	it("orphans entries written under an older cache version", async () => {
		// Learn the live key rather than rebuilding it, so this never pins the
		// number — it only asserts that the PREVIOUS one is not served.
		const probe = fakeEnv();
		await getVideosCached(probe.env, "youtube", "UC1", () =>
			Promise.resolve(AIRED),
		);
		const [liveKey] = [...probe.store.keys()];
		const version = Number(/videos:v(\d+):/.exec(liveKey)?.[1]);
		expect(version).toBeGreaterThan(1);

		const { env, store } = fakeEnv();
		// An entry in the shape that shipped before the current version: fresh
		// enough to serve, and missing the field the current shape requires.
		store.set(
			liveKey.replace(`videos:v${version}:`, `videos:v${version - 1}:`),
			JSON.stringify({
				fetched_at: Date.now(),
				videos: [
					{
						id: "BROADCAST01",
						title: "BROADCAST01",
						url: "https://www.youtube.com/watch?v=BROADCAST01",
						thumbnail_url: null,
						published_at: "2026-07-31T01:04:43Z",
						platform: "youtube",
					},
				],
			}),
		);

		let fetched = 0;
		const videos = await getVideosCached(env, "youtube", "UC1", () => {
			fetched++;
			return Promise.resolve(AIRED);
		});
		expect(fetched).toBe(1);
		expect(videos[0].duration_seconds).toBeNull();
	});

	// A degraded batch now costs two things, not one: the dates stay as the feed
	// gave them AND those videos keep a null runtime. A list carrying a mix of
	// both must still be served and still not cached.
	it("serves a degraded list carrying mixed runtimes without caching it", async () => {
		const { env, puts } = fakeEnv();
		const mixed = [
			{
				...video("ENRICHED001", "2026-07-31T01:04:43Z"),
				duration_seconds: 6714,
			},
			video("DEGRADED001", "2026-07-31T15:27:03Z"),
		];
		const videos = await getVideosCached(env, "youtube", "UC1", () =>
			Promise.reject(new UncacheableVideos(mixed)),
		);
		expect(videos.map((v) => v.duration_seconds)).toEqual([6714, null]);
		expect(puts).toHaveLength(0);
	});

	it("caches a clean fetch", async () => {
		const { env, puts } = fakeEnv();
		const videos = await getVideosCached(env, "youtube", "UC1", () =>
			Promise.resolve(AIRED),
		);
		expect(videos).toEqual(AIRED);
		expect(puts).toHaveLength(1);
	});

	it("serves a degraded fetch without caching it", async () => {
		const { env, puts } = fakeEnv();
		const videos = await getVideosCached(env, "youtube", "UC1", () =>
			Promise.reject(new UncacheableVideos(VOD_DATED)),
		);
		// Cold miss: better to show the VOD dates than an empty feed — but they
		// must not be persisted, or they'd be served for the whole TTL.
		expect(videos).toEqual(VOD_DATED);
		expect(puts).toHaveLength(0);
	});

	it("keeps a stale entry's good dates when the refresh degrades", async () => {
		const { env, store, puts } = fakeEnv();
		await getVideosCached(env, "youtube", "UC1", () => Promise.resolve(AIRED));
		makeStale(store);
		puts.length = 0;

		const { ctx, settled } = fakeCtx();
		const served = await getVideosCached(
			env,
			"youtube",
			"UC1",
			() => Promise.reject(new UncacheableVideos(VOD_DATED)),
			ctx,
		);
		await settled();

		expect(served).toEqual(AIRED);
		expect(puts).toHaveLength(0);
		const [key] = [...store.keys()];
		expect(
			(JSON.parse(store.get(key) as string) as { videos: Video[] }).videos,
		).toEqual(AIRED);
	});

	it("still swallows a hard fetch failure on a cold miss", async () => {
		const { env, puts } = fakeEnv();
		const videos = await getVideosCached(env, "youtube", "UC1", () =>
			Promise.reject(new Error("youtube feed responded 503")),
		);
		expect(videos).toEqual([]);
		expect(puts).toHaveLength(0);
	});
});
