// What the map view's chrome reads for one player at one turn. Everything in
// the chrome follows the selected turn, so each value is looked up at that
// turn rather than taken from the end of the game.

import type { CharacterInfo, FamilyInfo } from "$lib/parser/types";
import type { MapTile } from "$lib/types/MapTile";
import type { TechDiscoveryHistory } from "$lib/types/TechDiscoveryHistory";
import type { YieldDataPoint } from "$lib/types/YieldDataPoint";
import type { YieldHistory } from "$lib/types/YieldHistory";
import {
	dynastyLeaders,
	familyCrestKey,
	findByPlayer,
	ownedByPlayer,
	type DetailPlayer,
} from "./helpers";
import type { GameTabId } from "./game-tabs.svelte";

// The frame every piece of the chrome sits in, the tile hover panel included:
// a dark fill with a thin tan trim, drawn in CSS on the palette tokens rather
// than from the game's frame sprites (#270). A class string rather than a
// component so it also dresses elements another component owns, like a
// bits-ui tooltip's content.
export const CHROME_PANEL_CLASS =
	"rounded border border-tan/50 bg-gradient-to-b from-surface/95 to-surface-deep/95 text-tan shadow-[inset_0_0_0_1px_rgb(var(--color-black)/0.6),0_4px_12px_rgb(var(--color-black)/0.5)]";

/** A tile named by its place on the grid — what a locked tile panel holds. */
export type TileCoord = Pick<MapTile, "x" | "y">;

/**
 * One military unit's marker on the map: where it stands, whose colour its
 * plate wears, and the flag glyph drawn over it.
 *
 * Resolved by the map page rather than by `SpriteMap`, which takes no game:
 * the (x, y) join runs through `tile_xml_id`, which needs `map_width`, and the
 * owner colour comes off the resolved roster. `SpriteMap` turns the grid
 * position into world units and draws the pair, as it does for a city banner.
 */
export interface UnitMarker {
	/** The unit's `<Unit>` id — the pick identity, and what the card opens on. */
	xmlId: number;
	/** The tile it stands on, in grid coordinates. */
	x: number;
	y: number;
	/**
	 * The owner's colour: the roster's own for a player (so a mirror's two
	 * Egypts stay apart), the baked tribe colour for a tribe.
	 */
	color: string;
	/**
	 * The game's painted unit art (`units/<TYPE>`), cut to a disc and drawn
	 * over the plate — or null where we ship none: 4 of the corpus's 1,411
	 * military units, in 3 types with no `unit.xml` entry, which have neither
	 * the art nor the flag glyph it replaced. The plate then draws alone.
	 */
	portraitUrl: string | null;
}

/**
 * The deck's camera, as the map's DOM overlays read it: its pan target and
 * zoom, with the target normalized to a 3-tuple (deck's own
 * OrthographicViewState allows a 2-tuple, or none at all).
 */
export interface ViewState {
	target: [number, number, number];
	zoom: number;
}

/**
 * World → canvas-local CSS pixels, the orthographic view's own affine:
 * (world − target) × 2^zoom, centred on the canvas. OrthographicView's
 * default flipY means growing world Y runs down the screen, which is the
 * convention `SpriteMap`'s `hexToPixel` already negates into.
 *
 * Shared rather than per-overlay: the city banners and the locked tile panels
 * both place something over a world point, and two copies of the affine drift
 * apart.
 */
export function projectToCanvas(
	world: [number, number],
	viewState: ViewState,
	canvasWidth: number,
	canvasHeight: number,
): [number, number] {
	const [targetX, targetY] = viewState.target;
	const scale = Math.pow(2, viewState.zoom);
	return [
		(world[0] - targetX) * scale + canvasWidth / 2,
		(world[1] - targetY) * scale + canvasHeight / 2,
	];
}

export interface TopBarYield {
	yieldType: string;
	/** `yield.xml`'s `<bStockpile>` — the game banks these between turns. */
	stockpiled: boolean;
	tab: GameTabId;
}

/**
 * The yields of the game's top bar, in its order and its two groups.
 * `yield.xml` gives each an `<iUIPosition>`, set on exactly these nine and on
 * no other yield (Growth, Culture, Happiness, Discontent and Maintenance have
 * none), and `ClientUI.start` builds top-bar.xml from it as two loops
 * (ClientUI.cs:1726-1749): the `<bGoodsUI>` commodities, and the rates, which
 * is every other positioned yield but Money and Orders because the bar places
 * those two itself. That reads Money, the four goods and Orders, then Science,
 * Civics and Training. Clicking a yield opens `tab` in a lightbox.
 */
export const TOP_BAR_YIELD_GROUPS: TopBarYield[][] = [
	[
		{ yieldType: "YIELD_MONEY", stockpiled: true, tab: "economics" },
		{ yieldType: "YIELD_FOOD", stockpiled: true, tab: "economics" },
		{ yieldType: "YIELD_IRON", stockpiled: true, tab: "economics" },
		{ yieldType: "YIELD_STONE", stockpiled: true, tab: "economics" },
		{ yieldType: "YIELD_WOOD", stockpiled: true, tab: "economics" },
		{ yieldType: "YIELD_ORDERS", stockpiled: true, tab: "orders" },
	],
	[
		{ yieldType: "YIELD_SCIENCE", stockpiled: false, tab: "techs" },
		{ yieldType: "YIELD_CIVICS", stockpiled: true, tab: "laws" },
		{ yieldType: "YIELD_TRAINING", stockpiled: true, tab: "military" },
	],
];

/**
 * The point of a turn-ordered series in force at `turn`: the last one at or
 * before it. The derived histories carry one point per turn, so this is
 * usually that turn's own point.
 */
export function pointAtTurn<T extends { turn: number }>(
	points: T[],
	turn: number,
): T | undefined {
	return points.findLast((p) => p.turn <= turn);
}

/**
 * One player's point for a single yield at `turn`. The yield strip and the
 * leader panel both reach a yield this way, so a yield reads the same in
 * both.
 */
export function yieldPointAtTurn(
	allYields: YieldHistory[],
	player: DetailPlayer,
	yieldType: string,
	turn: number,
): YieldDataPoint | undefined {
	const series = findByPlayer(
		allYields.filter((y) => y.yield_type === yieldType),
		player,
		(y) => y.player_id,
		(y) => y.nation,
	);
	return series ? pointAtTurn(series.data, turn) : undefined;
}

/**
 * Whether this player's yield strip has anything to show: any yield, any
 * turn. A save from before the game recorded yield rates has nothing, and the
 * strip is dropped rather than drawn as nine dashes.
 *
 * It asks across every yield because a rate the save never recorded is a null
 * point rather than a missing series: `deriveYieldHistory` builds each series
 * over every turn whether the save had rows for it or not. Per yield the
 * question would answer "no" far more often than it means to — the game
 * writes a row only when the rate changes (`setTurnYieldRate`, Player.cs:11464)
 * and the yield's block only when it has any row at all (`writeGameXML`,
 * Player.cs:3413), so a realm that never earned Wood has no Wood rows and the
 * slot reads "—" on an otherwise complete save.
 */
export function hasYieldRates(
	allYields: YieldHistory[],
	player: DetailPlayer,
): boolean {
	return ownedByPlayer(
		allYields,
		player,
		(y) => y.player_id,
		(y) => y.nation,
	).some((series) => series.data.some((point) => point.rate != null));
}

/**
 * The crest sprite key for a ruler's family. A `CharacterInfo` carries the
 * family but not its class, so the class comes from the game's own `families`
 * rows — the save writes family state per player (Player.FamilyHeadID and its
 * siblings, parsers/families.ts), so the match is on family *and* player.
 *
 * Across test-data/saves/ (12 saves, 149 reigning rulers) 93 rulers have a
 * family at all; 89 of those resolve a crest, every one of them through the
 * family class, because no ruler's family matched per-family crest art. So
 * the class lookup is what makes the icon appear, not a refinement on it.
 */
export function familyCrestFor(
	families: FamilyInfo[],
	playerId: number,
	family: string | null,
): string | null {
	if (!family) return null;
	const row = families.find(
		(f) => f.family_name === family && f.player_xml_id === playerId,
	);
	// `family_class` is "" when the save's global FamilyClass map had no entry,
	// which familyCrestKey treats as absent.
	return familyCrestKey(family, row?.family_class);
}

/**
 * The tech a player was researching at `turn`: their next discovery after
 * it, and how many turns away it was. Null when they discover nothing later,
 * which is always the case at the final turn.
 */
export function nextDiscovery(
	history: TechDiscoveryHistory | undefined,
	turn: number,
): { tech: string; turns: number } | null {
	const next = history?.data.find((d) => d.turn > turn && d.tech_name != null);
	if (next?.tech_name == null) return null;
	return { tech: next.tech_name, turns: next.turn - turn };
}

/** The player's ruler at `turn`: the last to take the throne by then. */
export function rulerAt(
	characters: CharacterInfo[],
	playerId: number,
	turn: number,
): CharacterInfo | null {
	return (
		dynastyLeaders(characters, playerId).findLast(
			(c) => (c.became_leader_turn ?? 0) <= turn,
		) ?? null
	);
}
