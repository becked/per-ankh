// Map pins — the game's own name for a tile marker a player drops
// (`TEXT_UI_PLACE_MAP_PIN`, text-ui.xml:4499). `<Pings>` sits under each
// `<Player>` and is written by `Player.writeGameXML` (Player.cs:3567-3599) as
// ATTRIBUTES on a self-closing `<Ping>`, not as children:
//
//   <Pings>
//     <Ping PingType="5" Turn="83" RemindTurn="0" Tile="329" Text="…" />
//     <Ping PingType="6" Turn="73" RemindTurn="0" Tile="406" Text=""
//           Improvement="IMPROVEMENT_WATERMILL" />
//   </Pings>
//
// Three things the shape doesn't say.
//
// `PingType` is an INTEGER, not a zType: the writer emits
// `ping.meType.ToString()`, so the value indexes ping.xml's entry order with
// the template `<Entry>` dropped. PING_TYPES (baked) is that order; the parser
// resolves through it so the blob carries `PING_NOTE` rather than `5`.
//
// `Improvement` is a zType EXCEPT for the sentinels the writer spells out by
// name — GENERIC, ROAD and URBAN, which are indices past the end of the
// improvement array (`InfoHelpers.getGenericImprovementPing` and its two
// siblings, InfoHelpers.cs:2923-2937). Older builds wrote at least one more:
// a `RESOURCE` sentinel appears once in test-data/saves/, in a v1.0.75065
// save, and no branch in the current `writeGameXML` produces it. So the field
// is kept verbatim and the reader tells the two apart by the `IMPROVEMENT_`
// prefix, the way `isActualImprovementPing` tells them apart by index — which
// leaves an unknown sentinel rendering as the game renders GENERIC rather than
// as a missing improvement.
//
// There is no history. `<Pings>` is the set alive at the save turn, and
// `addPing` calls `removePing(tileID)` first (Player.cs:21998-22000) — one pin
// per tile per player, and an overwritten or deleted pin leaves nothing
// behind. Each pin does carry the turn it was placed, which is a floor on when
// it was there and the reason the map's layer can follow the turn slider.
//
// Measured across the 116 saves in test-data/saves/: 1,403 pins in 61 saves;
// 981 PING_IMPROVEMENT, 419 PING_NOTE, 2 PING_FOUND and 1 PING_GENERIC. The
// last two are not a parse error, and they are why the resolved kind is the
// full ping.xml table rather than the two durable entries: PING_FOUND declares
// no turn duration and goes only when its tile gains city territory (`bFound`,
// Player.cs:22135), and the GENERIC pin was placed on turn 62 of a game saved
// at turn 62, inside the two turns `<iMPTurnDuration>` gives it. 88
// distinct improvement targets, of which 3 are sentinels (32 ROAD, 16 GENERIC,
// 1 RESOURCE; no URBAN). 25 of the 419 notes carry empty text, which the
// game's own tooltip answers with the pin kind's LogText. One pin carries
// `Tile="-1"`, the tile-less pin `canPingTile` permits (Player.cs:22114). 3 of
// the 394 non-empty note texts carry an escaped newline — notes are
// multi-line, which is what `decodeCharRefs` below exists for.

import { PING_TYPES } from "../../generated/ping-types.js";
import {
	asArray,
	isElement,
	optAttrStr,
	optInt,
	requireInt,
} from "../parse-xml.js";

/**
 * Cap on a pin's text, in UTF-16 code units. Note text is the one unbounded
 * player-authored string the blob would carry, and nothing in the game's own
 * input caps it. The longest note across test-data/saves/ is 126 characters,
 * so this is headroom rather than a limit anyone writes up against; a longer
 * note is truncated rather than dropped, because the first 500 characters of
 * a note still say what the pin is for.
 */
export const MAX_PING_TEXT = 500;

/**
 * Decode the numeric character references the save writes and
 * fast-xml-parser leaves alone.
 *
 * It resolves the NAMED entities in an attribute (`&amp;` comes back as `&`)
 * and passes `&#xA;` through verbatim, which is how a note's own line breaks
 * reach us — Old World escapes them that way, and 3 of the 394 non-empty note
 * texts across `test-data/saves/` carry one. Without this the panel would
 * print the escape itself rather than break the line, which is the whole of
 * what `white-space: pre-line` is there for.
 *
 * Pin text is the only free-text attribute the parser reads, so the decode
 * lives here rather than in `parse-xml.ts`: every other attribute is a zType,
 * an integer or a name the game never escapes.
 */
function decodeCharRefs(text: string): string {
	return text.replace(/&#(x[0-9a-fA-F]+|\d+);/g, (whole, digits: string) => {
		const code =
			digits[0] === "x" || digits[0] === "X"
				? parseInt(digits.slice(1), 16)
				: parseInt(digits, 10);
		// An unpaired surrogate or an out-of-range code point would throw;
		// leave those as written rather than fail the whole parse over one note.
		if (!Number.isFinite(code) || code > 0x10ffff) return whole;
		if (code >= 0xd800 && code <= 0xdfff) return whole;
		return String.fromCodePoint(code);
	});
}

/** One map pin, as the save records it. */
export interface Ping {
	playerXmlId: number;
	/** The resolved zType (PING_NOTE, PING_IMPROVEMENT, …). */
	pingType: string;
	/** The turn it was placed — a floor on when it was on the map. */
	turn: number;
	/** `<Tile>`'s id, or null for the tile-less pin the game permits. */
	tileXmlId: number | null;
	/** The author's text, or null when they typed none. */
	text: string | null;
	/** An improvement zType, a sentinel name, or null on a non-improvement pin. */
	improvement: string | null;
}

export function parsePings(root: Record<string, unknown>): Ping[] {
	const out: Ping[] = [];

	for (const playerNode of asArray(root.Player) as unknown[]) {
		if (!isElement(playerNode)) continue;
		const playerXmlId = requireInt(playerNode["@_ID"], "Player.ID");

		const pingsNode = playerNode.Pings;
		if (!isElement(pingsNode)) continue;

		for (const node of asArray(pingsNode.Ping) as unknown[]) {
			if (!isElement(node)) continue;

			// An index ping.xml has no entry for is a build we can't read the
			// kind of; dropping the pin is better than storing an integer no
			// consumer can name.
			const typeIndex = optInt(node["@_PingType"]);
			const pingType =
				typeIndex == null ? undefined : PING_TYPES[typeIndex]?.type;
			if (pingType === undefined) continue;

			const turn = optInt(node["@_Turn"]);
			if (turn == null) continue;

			// The writer always emits Tile, and -1 is its "no tile" value —
			// the same value `ReadGameXML` defaults to when the attribute is
			// missing (Player.cs:4822).
			const tile = optInt(node["@_Tile"]) ?? -1;

			// optAttrStr, not optStr: `Text=""` is what an improvement pin
			// carries, and the empty string has to survive as "the author
			// typed nothing" rather than as an absent attribute.
			// Decoded before the cap, so the cap counts characters a reader
			// sees rather than the six an escaped newline is written as.
			const rawText = decodeCharRefs(optAttrStr(node["@_Text"]) ?? "");

			out.push({
				playerXmlId,
				pingType,
				turn,
				tileXmlId: tile < 0 ? null : tile,
				text: rawText === "" ? null : rawText.slice(0, MAX_PING_TEXT),
				improvement: optAttrStr(node["@_Improvement"]),
			});
		}
	}

	return out;
}

export function pingToRow(p: Ping): Record<string, unknown> {
	return {
		player_xml_id: p.playerXmlId,
		ping_type: p.pingType,
		turn: p.turn,
		tile_xml_id: p.tileXmlId,
		text: p.text,
		improvement: p.improvement,
	};
}
