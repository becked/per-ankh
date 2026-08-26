import { describe, expect, it } from "vitest";
import {
	buildRecommendations,
	MAX_APPEARANCES,
	MAX_UNSETTLED_PER_LIST,
	MIN_RECOMMENDATION_COUNT,
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
		games: 40,
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
		// Eight players at the same strength, so the floor below is nowhere near
		// binding and the band is free to do its job.
		const players = [
			...pool(8),
			player("hopeless", { r: 2400 }),
			player("outclassed", { r: 700 }),
		];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		for (const p of pool(8)) {
			const ids = idsFor(lists, p.userId);
			expect(ids).not.toContain("hopeless");
			expect(ids).not.toContain("outclassed");
		}
		// …and symmetrically: the strong player is not offered the weak one
		// while anyone closer is left.
		expect(idsFor(lists, "hopeless")).not.toContain("outclassed");
	});

	it("gives the ends of the ladder a floor rather than a dead end", () => {
		// One player far above a settled pack: nobody is a close game for them,
		// so the band has to give way — down to the floor, and no further.
		const players = [player("champion", { r: 2100 }), ...pool(12)];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		const ids = idsFor(lists, "champion");
		expect(ids).toHaveLength(MIN_RECOMMENDATION_COUNT);
		expect(new Set(ids).size).toBe(ids.length);
		// The pack still gets full lists off each other.
		expect(idsFor(lists, "p0")).toHaveLength(RECOMMENDATION_COUNT);
	});

	it("widens the band for a player it barely knows, rather than giving up", () => {
		// Each of these is ~200 rating points away: outside the band a settled
		// player is held to, inside the one a barely-known player gets. Six
		// same-strength players sit alongside them so the floor is already
		// satisfied and the band is what decides.
		const opponents = [
			player("a", { r: 1700 }),
			player("b", { r: 1300 }),
			player("c", { r: 1660 }),
		];
		const nearby = pool(6, "near");

		// A settled player at the same rating finds none of the three close
		// enough, and fills up from the six instead.
		const settled = buildRecommendations({
			players: [player("settled"), ...opponents, ...nearby],
			duels: [],
			today: TODAY,
		});
		const settledIds = idsFor(settled, "settled");
		expect(settledIds.sort()).toEqual(nearby.map((p) => p.userId).sort());

		// The newcomer's band is wide enough to reach all nine.
		const unsettled = buildRecommendations({
			players: [
				player("newcomer", { r: 1500, rd: 300, games: 1 }),
				...opponents,
				...nearby,
			],
			duels: [],
			today: TODAY,
		});
		expect(idsFor(unsettled, "newcomer")).toHaveLength(9);
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
		// Far more receivers than candidates: without the load term the pool's
		// most-informative player would be on all ninety lists. Ninety is also
		// enough for the ceiling to hold without any list coming up short, which
		// is the case it is meant to bind in.
		const players = pool(90);
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		const appearances = new Map<string, number>();
		for (const p of players) {
			for (const id of idsFor(lists, p.userId)) {
				appearances.set(id, (appearances.get(id) ?? 0) + 1);
			}
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
			player("rookie", { games: 2 }),
			player("today", { lastActive: TODAY }),
			...pool(3, "circle"),
		];
		// Two games with the rival, plus enough other opponents that "we share
		// nobody" is a fact about the pairing and not about how little `me` has
		// played (see BRIDGE_BADGE_MIN_CIRCLE).
		const duels: Duel[] = [
			{ date: "2026-08-01", p1: "me", p2: "rival", winner: "me" },
			{ date: "2026-08-10", p1: "me", p2: "rival", winner: "rival" },
			{ date: "2026-07-01", p1: "me", p2: "circle0", winner: "me" },
			{ date: "2026-07-02", p1: "me", p2: "circle1", winner: "me" },
			{ date: "2026-07-03", p1: "me", p2: "circle2", winner: "me" },
		];
		const lists = buildRecommendations({ players, duels, today: TODAY });
		const mine = new Map(
			(lists.get("me") ?? []).map((r) => [r.opponentUserId, r]),
		);

		expect(mine.get("rival")!.meetings).toBe(2);
		// Already played, so not a bridge to anywhere.
		expect(mine.get("rival")!.badges).not.toContain("bridges_circles");
		expect(mine.get("stranger")!.meetings).toBe(0);
		expect(mine.get("stranger")!.badges).toContain("bridges_circles");
		expect(mine.get("rookie")!.badges).toContain("new_here");
		expect(mine.get("today")!.badges).toContain("active_this_week");
		// Nobody who has played forty games is "new here".
		expect(mine.get("rival")!.badges).not.toContain("new_here");
	});

	it("does not tell a player who has barely played that they bridge circles", () => {
		// One prior opponent is not a circle — everyone else is distant by
		// definition, and the badge would land on all ten rows saying nothing.
		const players = [player("fresh", { games: 1, rd: 300 }), ...pool(12)];
		const duels: Duel[] = [
			{ date: "2026-08-01", p1: "fresh", p2: "p0", winner: "p0" },
		];
		const lists = buildRecommendations({ players, duels, today: TODAY });
		for (const rec of lists.get("fresh") ?? []) {
			expect(rec.badges).not.toContain("bridges_circles");
		}

		// A player with a real history gets it back: `veteran` has played three
		// people, and the rest of the pool are strangers to all of them.
		const withCircle = buildRecommendations({
			players: [player("veteran"), ...pool(12)],
			duels: [
				{ date: "2026-08-01", p1: "veteran", p2: "p0", winner: "p0" },
				{ date: "2026-08-02", p1: "veteran", p2: "p1", winner: "p1" },
				{ date: "2026-08-03", p1: "veteran", p2: "p2", winner: "p2" },
			],
			today: TODAY,
		});
		expect(
			(withCircle.get("veteran") ?? []).some((r) =>
				r.badges.includes("bridges_circles"),
			),
		).toBe(true);
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

		// With ten rivals competing for the slots, the rematch loses its place.
		const crowded = buildRecommendations({
			players: [...players, ...pool(10, "other")],
			duels,
			today: TODAY,
		});
		expect(idsFor(crowded, "me")).not.toContain("again");
	});

	it("does not hand a settled player a list of strangers", () => {
		// Every unrated player sits at the starting rating, so on score alone a
		// pool of newcomers would sweep a mid-ladder player's whole list.
		const newcomers = Array.from({ length: 12 }, (_, i) =>
			player(`new${i}`, { rd: 300, games: 1 }),
		);
		const known = Array.from({ length: 8 }, (_, i) =>
			player(`known${i}`, { r: 1480 + i * 5 }),
		);
		const lists = buildRecommendations({
			players: [player("veteran"), ...known, ...newcomers],
			duels: [],
			today: TODAY,
		});

		const ids = idsFor(lists, "veteran");
		expect(ids).toHaveLength(RECOMMENDATION_COUNT);
		expect(ids.filter((id) => id.startsWith("new")).length).toBe(
			MAX_UNSETTLED_PER_LIST,
		);
	});

	it("fills a thin pool rather than handing anyone a short list", () => {
		// Eleven settled players competing for ninety lists: the appearance
		// ceiling cannot be honoured and still fill them, and a page with three
		// names on it is the feature not working. Same for the quota — with only
		// unsettled candidates left, a stranger beats a blank.
		const players = [
			...pool(11, "few"),
			...Array.from({ length: 79 }, (_, i) =>
				player(`crowd${i}`, { rd: 250, games: 2 }),
			),
		];
		const lists = buildRecommendations({ players, duels: [], today: TODAY });

		for (const p of players) {
			expect(idsFor(lists, p.userId)).toHaveLength(RECOMMENDATION_COUNT);
		}
	});

	it("is deterministic — same inputs, same lists in the same order", () => {
		const players = pool(20);
		const a = buildRecommendations({ players, duels: [], today: TODAY });
		const b = buildRecommendations({ players, duels: [], today: TODAY });
		expect([...a.entries()]).toEqual([...b.entries()]);
	});
});
