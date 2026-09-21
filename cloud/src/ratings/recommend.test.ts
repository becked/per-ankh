import { describe, expect, it } from "vitest";
import {
	buildRecommendations,
	MAX_APPEARANCES,
	RECOMMENDATION_COUNT,
	type RecommendationCandidate,
} from "./recommend";
import type { Duel } from "./glicko2";

const TODAY = "2026-08-26";
const RECENT = "2026-08-20";

function player(
	userId: string,
	over: Partial<RecommendationCandidate> = {},
): RecommendationCandidate {
	return {
		userId,
		r: 1500,
		rd: 80,
		publicGames: 40,
		lastPublicPlayed: RECENT,
		lastActive: RECENT,
		openToMatches: true,
		...over,
	};
}

// A pool of same-strength, settled, active players — every pair passes the
// stomp filter, so each test can vary the one thing it is about.
function pool(n: number, prefix = "p"): RecommendationCandidate[] {
	return Array.from({ length: n }, (_, i) => player(`${prefix}${i}`));
}

function idsFor(
	lists: Map<string, { opponentUserId: string }[]>,
	userId: string,
): string[] {
	return (lists.get(userId) ?? []).map((r) => r.opponentUserId);
}

describe("buildRecommendations", () => {
	it("gives each player a full list drawn from everyone but themselves", () => {
		const players = pool(15);
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		for (const p of players) {
			const ids = idsFor(lists, p.userId);
			expect(ids).toHaveLength(RECOMMENDATION_COUNT);
			expect(ids).not.toContain(p.userId);
			expect(new Set(ids).size).toBe(ids.length);
		}
	});

	it("never suggests a game one side would walk", () => {
		// The stomp has to be the better-scoring name, or this test is not about
		// the band. A pack of equals rejects a far outlier on closeness alone —
		// the score *is* closeness, so the outlier sorts to the bottom and the
		// band is never consulted — and an assertion that still passes with the
		// band deleted pins nothing.
		//
		// So: exactly a page of close games, every one of them discounted. The
		// viewer has played each peer three times this quarter, which takes them
		// to 0.5 / (1 + 0.6·3) = 0.18. The stomp is a first meeting at full
		// novelty, and 26/74 scores 0.25 — above the entire page. Score alone
		// would seat it; only the band keeps it off.
		const viewer = player("viewer");
		const peers = pool(RECOMMENDATION_COUNT, "peer");
		const duels: Duel[] = peers.flatMap((p) =>
			Array.from({ length: 3 }, (_, i) => ({
				date: `2026-0${6 + i}-01`,
				p1: viewer.userId,
				p2: p.userId,
				winner: viewer.userId,
			})),
		);
		const lists = buildRecommendations({
			players: [viewer, ...peers, player("stomp", { r: 1690 })],
			duels,
			today: TODAY,
		});

		const ids = idsFor(lists, "viewer");
		expect(ids).toHaveLength(RECOMMENDATION_COUNT);
		expect(ids).not.toContain("stomp");

		// The same promise at the ends of the ladder, where closeness settles it
		// without the band having to: a healthy pack is offered neither outlier.
		const ends = buildRecommendations({
			players: [
				...pool(20),
				player("hopeless", { r: 2400 }),
				player("outclassed", { r: 700 }),
			],
			duels: [],
			today: TODAY,
		});
		for (const p of pool(20)) {
			const packIds = idsFor(ends, p.userId);
			expect(packIds).not.toContain("hopeless");
			expect(packIds).not.toContain("outclassed");
		}
		// …and symmetrically: the strong player is not offered the weak one
		// while anyone closer is left.
		expect(idsFor(ends, "hopeless")).not.toContain("outclassed");
	});

	it("fills the ends of the ladder from whoever is nearest", () => {
		// One player far above a settled pack: nobody is a close game for them,
		// so the band gives way entirely rather than hand them the one-name
		// page this floor exists to replace. What they get is not twelve close
		// games — there are none — but the twelve closest there are.
		const players = [player("champion", { r: 2100 }), ...pool(14)];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		const ids = idsFor(lists, "champion");
		expect(ids).toHaveLength(RECOMMENDATION_COUNT);
		expect(new Set(ids).size).toBe(ids.length);
		// The pack still gets full lists off each other.
		expect(idsFor(lists, "p0")).toHaveLength(RECOMMENDATION_COUNT);
	});

	it("widens the band when either side is a player it barely knows", () => {
		// Two candidates exactly as far from the viewer as each other: a
		// conservative rating (r − 2·RD) of 1520 against the viewer's 1340,
		// which predicts about 26/74. That sits outside the band a settled pair
		// is held to and inside the one a pair with a barely-known player gets,
		// so the deviation is the only thing between them — same closeness,
		// same recency, same page slot. Eleven peers take the rest of the page,
		// so the band decides who has the twelfth rather than the fill does.
		//
		// The viewer was seen today, which puts them first in the pass: nobody
		// has spent an appearance yet, so the two are tied on score as well and
		// the settled one — first by the id tiebreak, so first down a scored
		// list — is what a recommender that had forgotten the deviation would
		// hand back.
		const players = [
			player("viewer", { lastActive: TODAY }),
			...pool(11, "peer"),
			player("settled_far", { r: 1680 }),
			player("unplaced_far", { r: 1920, rd: 200, publicGames: 1 }),
		];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		const ids = idsFor(lists, "viewer");
		expect(ids).toHaveLength(RECOMMENDATION_COUNT);
		expect(ids).toContain("unplaced_far");
		expect(ids).not.toContain("settled_far");
	});

	it("leaves out anyone who opted out, and still gives them their own list", () => {
		const players = [...pool(12), player("hidden", { openToMatches: false })];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		for (const p of players) {
			expect(idsFor(lists, p.userId)).not.toContain("hidden");
		}
		expect(idsFor(lists, "hidden")).toHaveLength(RECOMMENDATION_COUNT);
	});

	it("leaves out anyone who has not been seen in months", () => {
		const players = [
			...pool(12),
			player("gone", { lastActive: "2026-01-01" }),
			player("never", { lastActive: null }),
		];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		for (const p of players) {
			const ids = idsFor(lists, p.userId);
			expect(ids).not.toContain("gone");
			expect(ids).not.toContain("never");
		}
	});

	it("spreads the load instead of sending everyone to the same player", () => {
		// The cap has to be what stops the pile-up, or this test is not about
		// the cap. A pool of equals spreads itself: the soft 1 / (1 + picked)
		// penalty alone lands every candidate on exactly the same count, and an
		// assertion that still passes with the ceiling deleted pins nothing.
		//
		// So: three players seen this week, and thirty-seven last seen two and
		// a half months ago. Same strength, so every game is as close as every
		// other and recency is the only thing between them — a 1.0 against a
		// 0.7, for every viewer alike. Twice as many receivers as candidates:
		// forty in the pool and forty more who read a list without being on
		// anyone's, nine hundred and sixty picks in all. Left to the soft
		// penalty the three would each be handed to over thirty people; the
		// ceiling holds them at two dozen, and every list is still full.
		const fresh = pool(3, "fresh").map((p) => ({ ...p, lastActive: TODAY }));
		const stale = pool(37, "stale").map((p) => ({
			...p,
			lastActive: "2026-06-10",
		}));
		const players = [
			...fresh,
			...stale,
			...pool(40, "reader").map((p) => ({ ...p, openToMatches: false })),
		];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		const appearances = new Map<string, number>();
		for (const p of players) {
			const ids = idsFor(lists, p.userId);
			expect(ids).toHaveLength(RECOMMENDATION_COUNT);
			for (const id of ids) {
				appearances.set(id, (appearances.get(id) ?? 0) + 1);
			}
		}
		for (const p of fresh) {
			expect(appearances.get(p.userId)).toBe(MAX_APPEARANCES);
		}
		for (const [, count] of appearances) {
			expect(count).toBeLessThanOrEqual(MAX_APPEARANCES);
		}
	});

	it("counts the pair's history and badges what is true about it", () => {
		const players = [
			player("me"),
			player("rival"),
			player("stranger"),
			player("rookie", { publicGames: 2 }),
			player("today", { lastActive: TODAY, lastPublicPlayed: TODAY }),
		];
		const duels: Duel[] = [
			{ date: "2026-08-01", p1: "me", p2: "rival", winner: "me" },
			{ date: "2026-08-10", p1: "me", p2: "rival", winner: "rival" },
		];
		const lists = buildRecommendations({ players, duels, today: TODAY });
		const mine = new Map(
			(lists.get("me") ?? []).map((r) => [r.opponentUserId, r]),
		);

		expect(mine.get("rival")!.meetings).toBe(2);
		expect(mine.get("stranger")!.meetings).toBe(0);
		expect(mine.get("rookie")!.badges).toContain("new_here");
		expect(mine.get("today")!.badges).toContain("active_this_week");
		// Nobody who has played forty games is "new here".
		expect(mine.get("rival")!.badges).not.toContain("new_here");
	});

	it("badges only what a visitor could have read for themselves", () => {
		// The private half of each candidate is set to the opposite of the
		// public half: a veteran whose record is all private reads as new here,
		// and someone active only in games nobody can see, or only by logging
		// in, is not badged active. Getting these the other way round would put
		// a fact about a private game on a stranger's screen.
		const players = [
			player("me"),
			player("unseen", { publicGames: 1, lastPublicPlayed: "2026-06-01" }),
			player("lurker", { lastActive: TODAY, lastPublicPlayed: "2026-06-01" }),
			player("visible", { lastActive: TODAY, lastPublicPlayed: TODAY }),
		];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });
		const mine = new Map(
			(lists.get("me") ?? []).map((r) => [r.opponentUserId, r]),
		);

		expect(mine.get("unseen")!.badges).toContain("new_here");
		expect(mine.get("lurker")!.badges).not.toContain("active_this_week");
		expect(mine.get("visible")!.badges).toContain("active_this_week");
	});

	it("prefers a fresh pairing to this month's third rematch", () => {
		const players = [player("me"), player("again"), player("fresh")];
		const duels: Duel[] = Array.from({ length: 3 }, (_, i) => ({
			date: `2026-08-0${i + 1}`,
			p1: "me",
			p2: "again",
			winner: "me",
		}));
		const lists = buildRecommendations({ players, duels, today: TODAY });
		// With only two candidates there is room for both — the decay is a
		// discount, not a ban.
		expect(idsFor(lists, "me").sort()).toEqual(["again", "fresh"]);

		// With more rivals than slots, the rematch loses its place.
		const crowded = buildRecommendations({
			players: [...players, ...pool(12, "other")],
			duels,
			today: TODAY,
		});
		expect(idsFor(crowded, "me")).not.toContain("again");
	});

	it("does not hand a settled player a list of strangers", () => {
		// Every unrated player sits at the starting rating, so a prediction
		// from raw ratings would call them an even game for anyone mid-ladder.
		// The conservative estimate places them at the bottom of what they
		// might be instead, and a newcomer only reaches a settled player's list
		// once even that pessimistic estimate is close.
		const newcomers = Array.from({ length: 12 }, (_, i) =>
			player(`new${i}`, { rd: 300, publicGames: 1 }),
		);
		const known = Array.from({ length: 11 }, (_, i) =>
			player(`known${i}`, { r: 1480 + i * 5 }),
		);
		const proven = player("proven", { r: 1900, rd: 300, publicGames: 2 });
		const lists = buildRecommendations({
			players: [player("veteran"), ...known, ...newcomers, proven],
			duels: [],
			today: TODAY,
		});

		const ids = idsFor(lists, "veteran");
		expect(ids.filter((id) => id.startsWith("new"))).toHaveLength(0);
		expect(ids).toContain("proven");
		for (const k of known) expect(ids).toContain(k.userId);
	});

	it("fills a thin pool rather than handing anyone a short list", () => {
		// Thirteen candidates for ninety-two lists: the appearance ceiling
		// cannot be honoured and still fill them, and a page with three names
		// on it is the feature not working, so the ceiling is what gives.
		const players = [
			...pool(13, "few"),
			...pool(79, "reader").map((p) => ({ ...p, openToMatches: false })),
		];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		for (const p of players) {
			expect(idsFor(lists, p.userId)).toHaveLength(RECOMMENDATION_COUNT);
		}
	});

	it("lists the most recently active first, whatever their rating", () => {
		// Three players spread across the band, seen on three different days.
		// Nearest-in-rating would put `mid` first; the stored order is who can
		// actually play this week.
		const players = [
			player("me"),
			player("mid", { r: 1505, lastActive: "2026-08-01" }),
			player("far", { r: 1560, lastActive: TODAY }),
			player("near", { r: 1520, lastActive: RECENT }),
		];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });
		expect(idsFor(lists, "me")).toEqual(["far", "near", "mid"]);
	});

	it("is deterministic — same inputs, same lists in the same order", () => {
		const players = pool(20);
		const a = buildRecommendations({ players, duels: [], today: TODAY });
		const b = buildRecommendations({ players, duels: [], today: TODAY });
		expect([...a.entries()]).toEqual([...b.entries()]);
	});
});
