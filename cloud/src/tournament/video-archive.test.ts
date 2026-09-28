import { describe, expect, it } from "vitest";
import {
	classifyAngle,
	editDistance,
	groupIntoParts,
	playersInTitle,
	prepareRoster,
	resolveName,
	attributeVideos,
	union,
	versusInTitle,
	videoIdsInUrl,
	type ArchiveMatchInput,
	type TimedVideo,
} from "./video-archive";
import type { Video } from "../video/types";

// Every fixture below is taken from the 2026 Community Tournament, because the
// bugs these pin were all found in that data rather than imagined.

const video = (id: string, title: string): Video => ({
	id,
	title,
	url: `https://www.youtube.com/watch?v=${id}`,
	thumbnail_url: null,
	published_at: "",
	platform: "youtube",
	duration_seconds: null,
});

/** `hours: null` is a broadcast still running — no runtime known yet. */
const at = (
	aired: string,
	hours: number | null,
	channel: string,
	title = channel,
	uploaderUserId: string | null = null,
): TimedVideo => ({
	video: video(`V${aired}${channel}`.slice(0, 11), title),
	channel,
	uploaderUserId,
	aired,
	seconds: hours === null ? null : Math.round(hours * 3600),
});

const ROSTER = prepareRoster([
	"alcaras",
	"CLIFF123",
	"NestorLN",
	"Quetzal",
	"Max (3WordName)",
	"ant",
	"Konstant",
	"watchtheturd",
	"A_Modern_Major_General",
	"phielp",
]);

describe("union", () => {
	it("counts overlap once", () => {
		expect(
			union([
				[0, 100],
				[50, 150],
			]),
		).toBe(150);
	});
	it("adds disjoint windows and excludes the gap between them", () => {
		expect(
			union([
				[0, 100],
				[200, 300],
			]),
		).toBe(200);
	});
	it("absorbs a window nested inside another", () => {
		expect(
			union([
				[0, 1000],
				[400, 500],
			]),
		).toBe(1000);
	});
	it("does not depend on input order", () => {
		expect(
			union([
				[200, 300],
				[0, 100],
				[50, 150],
			]),
		).toBe(250);
	});
	it("treats touching windows as continuous", () => {
		expect(
			union([
				[0, 100],
				[100, 200],
			]),
		).toBe(200);
	});
	it("is zero for no windows", () => {
		expect(union([])).toBe(0);
	});
});

describe("editDistance", () => {
	it("counts a transposition as one edit, not two", () => {
		// Plain Levenshtein scores this 2; the whole reason for the variant is
		// that it scores 1, so the assertion must be exact and the cap tight.
		expect(editDistance("quetzal", "queztal", 1)).toBe(1);
	});
	it("bails out past the cap instead of computing the true distance", () => {
		expect(editDistance("alcaras", "watchtheturd", 1)).toBe(2);
	});
});

describe("resolveName", () => {
	it("matches a name outright", () => {
		expect(resolveName("alcaras", ROSTER)).toBe("alcaras");
	});

	// Uploaders truncate: "Cliff v Lerrike", "Nestor v Quetzal".
	it("matches a truncated name by prefix", () => {
		expect(resolveName("cliff", ROSTER)).toBe("CLIFF123");
		expect(resolveName("nestor", ROSTER)).toBe("NestorLN");
	});

	// And mistype: "NestorLN v Queztal".
	it("matches a mistyped name within one edit", () => {
		expect(resolveName("queztal", ROSTER)).toBe("Quetzal");
	});

	it("refuses a prefix that fits more than one player", () => {
		expect(resolveName("ma", prepareRoster(["Magnus", "Marauder"]))).toBeNull();
	});

	// This tournament has a player called "PS". Exact equality is safe at any
	// length a real handle reaches; it is prefix and fuzzy matching that need
	// characters to be distinctive.
	it("matches a two-character handle exactly", () => {
		expect(resolveName("ps", [...ROSTER, ...prepareRoster(["PS"])])).toBe("PS");
	});

	it("matches a three-character prefix when only one player fits", () => {
		expect(resolveName("max", ROSTER)).toBe("Max (3WordName)");
	});

	it("refuses a short token that is nobody's name", () => {
		expect(resolveName("al", ROSTER)).toBeNull();
	});

	it("does not fuzzy-match a short token into a real name", () => {
		// "ant" is a player; one edit from "ane"/"and" must not resolve, or every
		// stray word in a title becomes a player.
		expect(resolveName("and", ROSTER)).toBeNull();
	});
});

describe("playersInTitle", () => {
	it("reads both players out of a plain title", () => {
		expect(playersInTitle("alcaras v phielp - Old World", ROSTER)).toEqual([
			"alcaras",
			"phielp",
		]);
	});

	it("prefers the longest name over a shorter one inside it", () => {
		// "Max" is a prefix of "Max (3WordName)"; the 4-gram must win.
		expect(
			playersInTitle("problemgambler vs Max 3WordName Part 1", ROSTER),
		).toEqual(["Max (3WordName)"]);
	});

	it("ignores the tournament's own boilerplate", () => {
		expect(
			playersInTitle("Old World Community Tournament 2026", ROSTER),
		).toEqual([]);
	});

	// The reason attribution must not key on the match number: two different
	// matches in this tournament are both titled "Match 013".
	it("reads names out of a title whose match number is wrong", () => {
		expect(
			playersInTitle("Magnus v watchtheturd, Part 7 [Match 089]", ROSTER),
		).toEqual(["watchtheturd"]);
	});

	// "alcarasv" is one edit from alcaras. Letting a 2-gram straddle the "v"
	// still resolved the name, but swallowed the token that says who played.
	it("does not let a name swallow the versus token beside it", () => {
		expect(versusInTitle("alcaras v phielp", ROSTER)).toEqual([
			"alcaras",
			"phielp",
		]);
	});

	it("does not read a bracket word as a player", () => {
		const roster = prepareRoster([
			"Divine",
			"Swiss_Cheese",
			"alcaras",
			"phielp",
		]);
		expect(playersInTitle("Div 2 Match 5: alcaras vs phielp", roster)).toEqual([
			"alcaras",
			"phielp",
		]);
		expect(playersInTitle("Swiss Round 3 alcaras v phielp", roster)).toEqual([
			"alcaras",
			"phielp",
		]);
	});
});

describe("versusInTitle", () => {
	it("returns the names on either side of the versus token", () => {
		expect(
			versusInTitle("Konstant casts: Cliff vs NestorLN [Cast]", ROSTER),
		).toEqual(["CLIFF123", "NestorLN"]);
	});

	it("is null when a side of the versus is not a roster name", () => {
		expect(versusInTitle("Frederik vs phielp", ROSTER)).toBeNull();
		expect(versusInTitle("alcaras and phielp", ROSTER)).toBeNull();
	});
});

describe("videoIdsInUrl", () => {
	it("reads every URL shape a person might paste", () => {
		expect(
			videoIdsInUrl("https://www.youtube.com/watch?v=abcdefghijk"),
		).toEqual(["abcdefghijk"]);
		expect(videoIdsInUrl("https://youtu.be/abcdefghijk")).toEqual([
			"abcdefghijk",
		]);
		expect(videoIdsInUrl("https://youtube.com/live/abcdefghijk?x=1")).toEqual([
			"abcdefghijk",
		]);
	});

	it("finds nothing in the channel links most parts actually carry", () => {
		expect(videoIdsInUrl("https://www.youtube.com/@Siontific/live")).toEqual(
			[],
		);
		expect(videoIdsInUrl("https://www.twitch.tv/shaunmcnamee")).toEqual([]);
	});
});

describe("classifyAngle", () => {
	it("trusts the uploader's identity over anything in the title", () => {
		expect(
			classifyAngle(
				"alcaras v Nicknight [Cast]",
				"alcaras",
				["alcaras"],
				"u1",
				["u1"],
			),
		).toBe("pov");
	});

	it("reads the title tags", () => {
		expect(classifyAngle("x [PoV]", "Zeg", ["alcaras"])).toBe("pov");
		expect(classifyAngle("x [Cast]", "Zeg", ["alcaras"])).toBe("cast");
	});

	// A bare substring test fires on these.
	it("does not read 'broadcast' or 'castle' as a cast tag", () => {
		expect(
			classifyAngle("Broadcast from alcaras", "alcaras", ["alcaras"]),
		).toBe("pov");
	});

	it("calls a player filming their own match a point of view", () => {
		expect(classifyAngle("untitled", "alcaras", ["alcaras", "phielp"])).toBe(
			"pov",
		);
	});

	// The collision this roster actually contains.
	it("does not mistake the caster Konstant for the player ant", () => {
		expect(classifyAngle("untitled", "Konstant", ["ant", "phielp"])).toBe(
			"cast",
		);
	});

	it("falls back to cast when the channel is unknown", () => {
		expect(classifyAngle("untitled", "", ["alcaras"])).toBe("cast");
	});
});

describe("groupIntoParts", () => {
	const P = ["alcaras", "phielp"];
	const U: (string | null)[] = [null, null];

	it("keeps two games played the same evening apart", () => {
		// Match 3 ran 17:00 and again at 23:00 on 4 July. Bucketing by calendar
		// day merged them and threw away the second game's hours.
		const { parts } = groupIntoParts(
			[
				at("2026-07-04T16:47:00Z", 3.6, "Nestor"),
				at("2026-07-04T23:01:00Z", 3.55, "William Reese"),
			],
			P,
			U,
		);
		expect(parts).toHaveLength(2);
	});

	it("joins a stream that dropped and came back", () => {
		const { parts } = groupIntoParts(
			[
				at("2026-07-19T20:58:00Z", 0.54, "SkipperXIV"),
				at("2026-07-19T21:36:00Z", 0.42, "SkipperXIV"),
				at("2026-07-19T22:06:00Z", 2.11, "SkipperXIV"),
			],
			P,
			U,
		);
		expect(parts).toHaveLength(1);
		// The gaps between segments are not play, so they are not counted.
		expect(parts[0].seconds).toBeCloseTo((0.54 + 0.42 + 2.11) * 3600, 0);
	});

	it("counts one evening filmed twice once, not twice", () => {
		// A cast and a point of view of the same hours.
		const { parts } = groupIntoParts(
			[
				at("2026-08-27T01:57:00Z", 3.05, "alcaras"),
				at("2026-08-27T01:57:00Z", 3.04, "Shaun McNamee"),
			],
			P,
			U,
		);
		expect(parts).toHaveLength(1);
		expect(parts[0].seconds).toBeCloseTo(3.05 * 3600, 0);
	});

	// The defect that shipped: pricing a part at its longest single camera.
	it("adds up a relay where channels covered different stretches", () => {
		// Match 80: Boldus 14:02→17:25, Aran 17:25→22:24, alcaras 22:49→00:10.
		const { parts } = groupIntoParts(
			[
				at("2026-09-05T14:02:00Z", 3.372, "Boldus Gaming"),
				at("2026-09-05T17:25:00Z", 4.978, "Aran"),
				at("2026-09-05T22:49:00Z", 1.341, "alcaras"),
			],
			P,
			U,
		);
		expect(parts).toHaveLength(1);
		// Not 4.978 — the longest single camera saw half the game.
		expect(parts[0].seconds / 3600).toBeGreaterThan(9);
	});

	it("aligns parts to scheduled sittings and counts the unfilmed ones", () => {
		const { parts, gaps } = groupIntoParts(
			[at("2026-08-24T15:00:00Z", 3.6, "Boldus Gaming")],
			P,
			U,
			["2026-08-24T15:00:00Z", "2026-08-25T11:30:00Z"],
		);
		// One of the two scheduled sittings was filmed; the other is the gap.
		expect(parts).toHaveLength(1);
		expect(gaps).toBe(1);
	});

	it("survives a malformed scheduled instant instead of losing alignment", () => {
		const { parts, gaps } = groupIntoParts(
			[at("2026-08-24T15:00:00Z", 3.6, "Boldus Gaming")],
			P,
			U,
			["not a date", "2026-08-24T15:00:00Z"],
		);
		// The malformed instant is skipped, so the real one still gets claimed and
		// nothing is reported as unfilmed.
		expect(parts).toHaveLength(1);
		expect(gaps).toBe(0);
	});

	it("drops a video with no usable air time rather than poisoning the sort", () => {
		const { parts } = groupIntoParts(
			[at("", 2, "Broken"), at("2026-08-24T15:00:00Z", 3.6, "Boldus Gaming")],
			P,
			U,
		);
		expect(parts).toHaveLength(1);
		expect(parts[0].angles).toHaveLength(1);
	});

	it("numbers parts in the order they aired and orders angles by length", () => {
		const { parts } = groupIntoParts(
			[
				at("2026-08-27T01:00:00Z", 1, "Short"),
				at("2026-08-27T01:00:00Z", 3, "Long"),
				at("2026-08-30T01:00:00Z", 2, "Later"),
			],
			P,
			U,
		);
		expect(parts.map((p) => p.n)).toEqual([1, 2]);
		expect(parts[0].angles.map((a) => a.channel)).toEqual(["Long", "Short"]);
	});

	it("returns nothing for a match with no footage", () => {
		expect(groupIntoParts([], P, U).parts).toEqual([]);
	});

	// The video the tab exists for while a tournament is live. It has no runtime
	// yet, so it cannot be priced — but dropping it made the match look unfilmed.
	it("keeps a broadcast still running as an unpriced angle", () => {
		const { parts } = groupIntoParts(
			[
				at("2026-08-27T01:57:00Z", 1.5, "Shaun McNamee"),
				at("2026-08-27T02:10:00Z", null, "alcaras"),
			],
			P,
			U,
		);
		expect(parts).toHaveLength(1);
		expect(parts[0].angles.map((a) => [a.channel, a.seconds])).toEqual([
			["Shaun McNamee", 1.5 * 3600],
			["alcaras", null],
		]);
		// Priced from the one camera that has a runtime.
		expect(parts[0].seconds).toBeCloseTo(1.5 * 3600, 0);
	});

	it("lists a match whose only footage is still running", () => {
		const { parts } = groupIntoParts(
			[at("2026-08-27T01:57:00Z", null, "alcaras")],
			P,
			U,
		);
		expect(parts).toHaveLength(1);
		expect(parts[0].seconds).toBe(0);
	});
});

describe("attributeVideos", () => {
	const M = (
		id: string,
		a: string,
		b: string,
		extra: Partial<ArchiveMatchInput> = {},
	): ArchiveMatchInput => ({
		match_id: id,
		players: [a, b],
		playerUserIds: [null, null],
		scheduledAt: [],
		streamUrls: [],
		...extra,
	});

	it("lets a stored stream link win outright", () => {
		const v = at("2026-07-04T16:47:00Z", 3, "Nestor", "nothing recognisable");
		const { byMatch, unattributed } = attributeVideos(
			[v],
			[
				M("m1", "alcaras", "phielp", {
					streamUrls: [`https://www.youtube.com/watch?v=${v.video.id}`],
				}),
			],
		);
		expect(byMatch.get("m1")).toHaveLength(1);
		expect(unattributed).toHaveLength(0);
	});

	it("falls back to the names in the title", () => {
		const { byMatch } = attributeVideos(
			[at("2026-07-04T16:47:00Z", 3, "Nestor", "alcaras v phielp - Part 1")],
			[M("m1", "alcaras", "phielp")],
		);
		expect(byMatch.get("m1")).toHaveLength(1);
	});

	it("ignores a wrong match number in favour of the names", () => {
		// Real case: this title says Match 089, but the players say otherwise.
		const { byMatch } = attributeVideos(
			[
				at(
					"2026-09-07T16:00:00Z",
					3,
					"alcaras",
					"Magnus v watchtheturd, Part 7 [Match 089]",
				),
			],
			[M("m72", "Magnus", "watchtheturd"), M("m89", "torrvor", "heitlinger96")],
		);
		expect(byMatch.get("m72")).toHaveLength(1);
		expect(byMatch.has("m89")).toBe(false);
	});

	it("breaks a rematch tie on air time", () => {
		const early = M("early", "alcaras", "phielp", {
			scheduledAt: ["2026-07-04T17:00:00Z"],
		});
		const late = M("late", "alcaras", "phielp", {
			scheduledAt: ["2026-08-30T02:00:00Z"],
		});
		const { byMatch } = attributeVideos(
			[at("2026-08-30T02:05:00Z", 3, "Zeg", "alcaras v phielp")],
			[early, late],
		);
		expect(byMatch.get("late")).toHaveLength(1);
		expect(byMatch.has("early")).toBe(false);
	});

	it("surfaces what it could not place instead of dropping it", () => {
		// "Frederik" is a player's real name, not their handle — unreachable.
		const { byMatch, unattributed } = attributeVideos(
			[at("2026-08-08T14:18:00Z", 6, "Siontific", "Frederik v Marauder")],
			[M("m47", "Spider", "Marauder")],
		);
		expect(byMatch.size).toBe(0);
		expect(unattributed).toHaveLength(1);
	});

	// Casters here are often players too. Credited first, "ant" used to claim
	// the game for ant-v-alcaras — silently, since that pairing exists.
	it("believes the versus over the order names appear in", () => {
		const { byMatch } = attributeVideos(
			[at("2026-07-04T16:47:00Z", 3, "ant", "ant casts alcaras vs phielp")],
			[
				M("ant-alcaras", "ant", "alcaras"),
				M("alcaras-phielp", "alcaras", "phielp"),
			],
		);
		expect([...byMatch.keys()]).toEqual(["alcaras-phielp"]);
	});

	it("refuses a title whose names fit more than one pairing", () => {
		// No versus to settle it, and both pairs played: a guess would be silent.
		const { byMatch, unattributed } = attributeVideos(
			[at("2026-07-04T16:47:00Z", 3, "ant", "ant, alcaras and phielp")],
			[
				M("ant-alcaras", "ant", "alcaras"),
				M("alcaras-phielp", "alcaras", "phielp"),
			],
		);
		expect(byMatch.size).toBe(0);
		expect(unattributed).toHaveLength(1);
	});

	it("still places a title with a third name when only one pairing fits", () => {
		const { byMatch } = attributeVideos(
			[at("2026-07-04T16:47:00Z", 3, "ant", "ant, alcaras and phielp")],
			[
				M("alcaras-phielp", "alcaras", "phielp"),
				M("ant-cliff", "ant", "CLIFF123"),
			],
		);
		expect([...byMatch.keys()]).toEqual(["alcaras-phielp"]);
	});

	it("attributes a broadcast still running, so it is not lost", () => {
		const { byMatch } = attributeVideos(
			[at("2026-07-04T16:47:00Z", null, "Nestor", "alcaras v phielp")],
			[M("m1", "alcaras", "phielp")],
		);
		expect(byMatch.get("m1")).toHaveLength(1);
	});
});
