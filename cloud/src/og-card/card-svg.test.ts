// The OG card's SVG builder. Pure — no wasm, no D1 — so what is pinned here
// is the layer that can silently diverge from the component it mirrors: which
// chart gets drawn, which rows exist, and the two things an SVG string can get
// wrong that a PNG would hide (unescaped text, an unclipped overflow).
//
// The rasterizer itself is exercised end-to-end in
// cloud/test/integration/games/og-card.test.ts, which is the only place a
// `.wasm` module import resolves.

import { describe, expect, it } from "vitest";
import { buildCardSvg } from "./card-svg";
import { CARD_HEIGHT, CARD_WIDTH } from "../../../src/lib/og-card";
import type { PublicGameCard, PublicGameCardPlayer } from "../games";

function player(
	over: Partial<PublicGameCardPlayer> & { player_index: number },
): PublicGameCardPlayer {
	return {
		player_name: `seat-${over.player_index}`,
		nation: null,
		is_human: true,
		is_uploader: over.player_index === 0,
		is_winner: false,
		final_points: null,
		cities_total: null,
		techs_completed: null,
		laws_count: null,
		vp_series: [],
		momentum_series: [],
		...over,
	};
}

function card(over: Partial<PublicGameCard> = {}): PublicGameCard {
	return {
		game_id: "g".repeat(21),
		game_name: "Test Game",
		display_name: null,
		user_nation: "NATION_ROME",
		user_won: true,
		winner_nation: "NATION_ROME",
		winner_name: "Scipio",
		victory_type: "VICTORY_CONQUEST",
		map_size: "MAPSIZE_SMALLEST",
		map_class: "MAPCLASS_MapScriptInlandSea2",
		difficulty: "DIFFICULTY_MAGNIFICENT",
		total_turns: 80,
		save_date: "2026-03-04T00:00:00Z",
		created_at: "2026-03-05T00:00:00Z",
		uploader_user_id: "u".repeat(21),
		uploader_display_name: "becked",
		uploader_slug: "becked",
		uploader_avatar_url: "https://cdn.discordapp.com/avatars/1/2.png",
		players: [player({ player_index: 0 }), player({ player_index: 1 })],
		...over,
	};
}

const vp = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ turn: i + 1, vp: i }));
const momentum = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ turn: i + 1, p: 0.5 }));

describe("buildCardSvg", () => {
	it("declares the canvas the meta tags promise", () => {
		const svg = buildCardSvg(card());
		expect(svg.startsWith("<svg ")).toBe(true);
		expect(svg).toContain(`width="${CARD_WIDTH}" height="${CARD_HEIGHT}"`);
		expect(svg).toContain(`viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}"`);
	});

	it("labels nine of the component's ten tiles, in its order", () => {
		// Nine, not ten: the first row's fifth tile is labelled Multiplayer or
		// Prosperity depending on the seat count, which the next case covers.
		const svg = buildCardSvg(
			card({
				players: [
					player({ player_index: 0, final_points: 40, cities_total: 8 }),
					player({ player_index: 1 }),
				],
			}),
		);
		const labels = [
			"Player",
			"Winner",
			"Victory Type",
			"Map",
			"Cities",
			"Techs",
			"Laws",
			"VP",
			"Turns",
		];
		let at = -1;
		for (const label of labels) {
			const next = svg.indexOf(`>${label}<`, at + 1);
			expect(next, `${label} missing or out of order`).toBeGreaterThan(at);
			at = next;
		}
	});

	it("shows Multiplayer for >1 human seat and Prosperity otherwise", () => {
		expect(buildCardSvg(card())).toContain(">Multiplayer<");
		const solo = buildCardSvg(
			card({
				players: [player({ player_index: 0, is_human: true })],
			}),
		);
		expect(solo).toContain(">Prosperity<");
		// DIFFICULTY_MAGNIFICENT reads "Modest" in game — through
		// prosperityName, not formatEnum.
		expect(solo).toContain(">Modest<");
	});

	it("drops the featured row when the seat has none of its four stats", () => {
		const svg = buildCardSvg(card());
		expect(svg).not.toContain(">Cities<");
		expect(svg).not.toContain(">Turns<");
	});

	it("draws momentum when exactly two seats carry a series", () => {
		const svg = buildCardSvg(
			card({
				players: [
					player({
						player_index: 0,
						momentum_series: momentum(40),
						vp_series: vp(40),
					}),
					player({
						player_index: 1,
						momentum_series: momentum(40),
						vp_series: vp(40),
					}),
				],
			}),
		);
		// The two clamped area fills, which only the momentum chart draws.
		expect(svg.match(/<polygon /g)).toHaveLength(2);
	});

	it("falls back to one VP polyline per seat when momentum is partial", () => {
		const svg = buildCardSvg(
			card({
				players: [
					player({
						player_index: 0,
						momentum_series: momentum(40),
						vp_series: vp(40),
					}),
					player({ player_index: 1, vp_series: vp(40) }),
					player({ player_index: 2, vp_series: vp(40) }),
				],
			}),
		);
		expect(svg).not.toContain("<polygon ");
		expect(svg.match(/<polyline /g)).toHaveLength(3);
	});

	it("draws no chart at all when no seat carries a series", () => {
		const svg = buildCardSvg(card());
		expect(svg).not.toContain("<polyline ");
		expect(svg).not.toContain("<polygon ");
	});

	it("ends a VP line on the seat's end-state total, not its last sample", () => {
		const svg = buildCardSvg(
			card({
				total_turns: 3,
				players: [
					player({
						player_index: 0,
						// Samples 0,1,2 — the recorded series tops out at 2, and
						// `final_points` is what the game actually ended on.
						vp_series: vp(3),
						final_points: 99,
					}),
				],
			}),
		);
		// With 99 as the y max, the final point is the only one on the plot's
		// top edge. Its y is the chart box's inset top; the three x values are
		// evenly spaced, so the last pair ends the polyline.
		const points = /<polyline points="([^"]+)"/.exec(svg)?.[1] ?? "";
		const ys = points.split(" ").map((p) => Number(p.split(",")[1]));
		expect(ys[ys.length - 1]).toBeLessThan(ys[0]);
		expect(ys[ys.length - 1]).toBeLessThan(ys[1]);
	});

	it("clips every tile's text rather than measuring it", () => {
		const svg = buildCardSvg(
			card({
				players: [
					player({ player_index: 0, final_points: 1 }),
					player({ player_index: 1 }),
				],
			}),
		);
		// Two header columns plus ten tiles.
		expect(svg.match(/<clipPath /g)).toHaveLength(12);
		expect(svg.match(/clip-path="url\(#/g)).toHaveLength(22);
	});

	it("escapes text the save supplies", () => {
		const svg = buildCardSvg(
			card({
				game_name: `Rome & "Carthage" <3`,
				uploader_display_name: "a<b>c",
			}),
		);
		expect(svg).toContain("Rome &amp; &quot;Carthage&quot; &lt;3");
		expect(svg).toContain("a&lt;b&gt;c");
		expect(svg).not.toContain("<b>");
	});

	it("falls back from save_date to created_at", () => {
		expect(buildCardSvg(card())).toContain(">2026-03-04<");
		expect(buildCardSvg(card({ save_date: null }))).toContain(">2026-03-05<");
	});
});
