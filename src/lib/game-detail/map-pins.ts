// Map pins, resolved for display. "Map Pin" is the game's own name for the
// system (`TEXT_UI_PLACE_MAP_PIN`); a Note carries text its author typed, an
// Improvement pin names what they meant to build there. The blob's `pings`
// array is one row per pin per player (see parsers/pings.ts); this turns it
// into what a surface renders — a grid position, the seat's colour, and the
// one line the game itself would show.
//
// Three surfaces read it and must agree: the tile panel's rows, the map's
// marker layer, and the Map Pins tab. So the copy rule lives here once.

import {
	PING_IMPROVEMENT_SENTINEL_NAMES,
	PING_IMPROVEMENT_SPECIFIC_LOG,
	PING_TYPES,
} from "$lib/generated/ping-types";
import type { FullGameData, MapTile, PingInfo } from "$lib/parser/types";
import {
	improvementDisplayName,
	unitOwner,
	type DetailPlayer,
} from "./helpers";
import { tilesByXmlId } from "./reconstruct-map-tiles";

/** One pin, ready to render. */
export interface MapPin {
	/** Stable key for an `{#each}`: the save gives a pin no id of its own. */
	key: string;
	playerXmlId: number;
	/** The roster's label for the seat that dropped it. */
	ownerLabel: string;
	/** That seat's own colour — not its nation's, so a mirror reads apart. */
	ownerColor: string;
	/** PING_NOTE, PING_IMPROVEMENT, … */
	pingType: string;
	/** The game's name for the kind ("Note", "Improvement Reminder"). */
	kindName: string;
	/**
	 * The improvement this pin names, when it names a real one — the zType the
	 * `improvements` sprite category takes. Null on a note, and on the
	 * sentinels (GENERIC, ROAD, URBAN) the game ships no improvement art for.
	 */
	improvementSprite: string | null;
	/** The turn it was placed — a FLOOR on when it was on the map. */
	turn: number;
	/** Grid position, or null for a pin on no tile. */
	x: number | null;
	y: number | null;
	/** The line the pin reads as. */
	text: string;
	/**
	 * True when `text` is the game's own fallback rather than words the author
	 * typed — which is every improvement pin, and the 25 of 419 notes in
	 * `test-data/saves/` left blank.
	 */
	isFallback: boolean;
}

/**
 * What one pin says, exactly as `buildTileTooltipPingText`
 * (HelpText.Game.cs:5340-5366) builds the right-hand side of its row: the
 * author's text when there is any, and otherwise the pin's meaning —
 * "Planning <improvement>" for an improvement pin, falling through to the
 * pin KIND's own `<LogText>` for everything else.
 *
 * That last arm is not a default nobody reaches. It is what the game shows
 * for the GENERIC improvement sentinel, which has no name of its own, and for
 * a sentinel from an older build it can no longer resolve — `RESOURCE`, which
 * one v1.0.75065 save in the corpus carries. `isActualImprovementPing` tells
 * a real improvement from a sentinel by index; the `IMPROVEMENT_` prefix is
 * the same test on this side of the save.
 */
export function pinText(ping: PingInfo): { text: string; isFallback: boolean } {
	if (ping.text != null && ping.text !== "") {
		return { text: ping.text, isFallback: false };
	}
	const improvement = ping.improvement;
	const named =
		improvement == null
			? null
			: improvement.startsWith("IMPROVEMENT_")
				? improvementDisplayName(improvement)
				: (PING_IMPROVEMENT_SENTINEL_NAMES[improvement] ?? null);
	if (named != null) {
		return {
			text: PING_IMPROVEMENT_SPECIFIC_LOG.replace("{0_improvement}", named),
			isFallback: true,
		};
	}
	const kind = PING_TYPES.find((t) => t.type === ping.ping_type);
	return { text: kind?.logText ?? "", isFallback: true };
}

/**
 * Every pin in the blob, placed on the grid and coloured by its seat.
 *
 * Returns null — not an empty array — for a blob that cannot answer: one
 * parsed before 2.30.0, which carries no `pings` at all, or one with no
 * `map_width`, without which a `<Tile>` id names no position. Both are
 * different claims from "this game has no pins", and the layer toggle reads
 * the difference rather than offering a switch that can only ever show
 * nothing.
 *
 * A pin whose tile the snapshot has no entry for is dropped; a pin on no tile
 * at all (`Tile="-1"`, which `canPingTile` permits — Player.cs:22114, one pin
 * across the corpus) is kept with a null position, because the pin list can
 * still show it even though the map cannot place it.
 */
export function resolveMapPins(
	game: Pick<FullGameData, "pings" | "map_tiles" | "game_details">,
	players: DetailPlayer[],
): MapPin[] | null {
	const pings = game.pings;
	if (pings == null) return null;
	const mapWidth = game.game_details.map_width;
	if (mapWidth == null) return null;

	const byId = tilesByXmlId(game.map_tiles, mapWidth);
	const out: MapPin[] = [];
	for (const [i, ping] of pings.entries()) {
		let tile: MapTile | undefined;
		if (ping.tile_xml_id != null) {
			tile = byId.get(ping.tile_xml_id);
			if (!tile) continue;
		}
		// The resolver the unit markers run, for the reason it documents: a
		// mirror matchup seats two players on one nation, and the nation's
		// colour would give them the same plate. `tribe` is null because a pin
		// only ever names a seat, which leaves the roster's own label and
		// colour and the `getSeriesColor(i)` arm for a seat the roster has no
		// row for.
		const owner = unitOwner(
			{ player_xml_id: ping.player_xml_id, tribe: null },
			players,
			i,
		);
		const { text, isFallback } = pinText(ping);
		out.push({
			key: String(i),
			playerXmlId: ping.player_xml_id,
			ownerLabel: owner.label,
			ownerColor: owner.color,
			pingType: ping.ping_type,
			kindName:
				PING_TYPES.find((t) => t.type === ping.ping_type)?.name ??
				ping.ping_type,
			improvementSprite: ping.improvement?.startsWith("IMPROVEMENT_")
				? ping.improvement
				: null,
			turn: ping.turn,
			x: tile?.x ?? null,
			y: tile?.y ?? null,
			text,
			isFallback,
		});
	}
	// Newest first, then by seat, so a list reads as "what was planned last".
	out.sort((a, b) => b.turn - a.turn || a.playerXmlId - b.playerXmlId);
	return out;
}

/**
 * The pins on the map at `turn`: those placed at or before it.
 *
 * A floor, not a window. The save records when a pin was placed and nothing
 * about when it went: `addPing` clears any pin already on the tile
 * (Player.cs:21998-22000) and `GameLogType.PING` is not one of the types
 * `isPermanentGameLog` keeps (Player.cs:15613-15643), so a pin removed on
 * turn 50 is simply absent from a save written at turn 90, with no trace of
 * having been there. Every pin here was therefore on the map from its turn
 * until at least the save's — hence the caveat the surfaces carry.
 */
export function pinsAtTurn(pins: MapPin[], turn: number): MapPin[] {
	return pins.filter((p) => p.turn <= turn);
}

/** The pins standing on one tile, in the order the list shows them. */
export function pinsOnTile(pins: MapPin[], x: number, y: number): MapPin[] {
	return pins.filter((p) => p.x === x && p.y === y);
}

/**
 * The one caveat every pin surface carries: the save dates a pin's placement
 * and never its removal, so "on the map from turn N" is a floor. Worded as
 * `TechsTab`'s `UNCERTAIN_NOTE` is, and placed beside the value rather than
 * in a subtitle, for the same reason.
 */
export const PIN_REMOVAL_NOTE =
	"The save records when a pin was placed, not when it was removed — a pin shown from its turn onward may have been taken down earlier.";
