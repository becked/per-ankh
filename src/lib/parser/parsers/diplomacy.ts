// Diplomacy relation parser. Direct port of
// src-tauri/src/parser/parsers/diplomacy.rs.
//
// Two source elements under <Game>: <TribeDiplomacy> (player-vs-tribe
// pairs) and <TeamDiplomacy> (player-vs-player pairs).

import { ParseError } from "../extract-zip.js";
import { getElementChildren, isElement } from "../parse-xml.js";

export interface DiplomacyRelation {
	entity1Type: string;
	entity1Id: string;
	entity2Type: string;
	entity2Id: string;
	relation: string;
	warScore: number | null;
	lastConflictTurn: number | null;
	lastDiplomacyTurn: number | null;
	diplomacyBlockedUntilTurn: number | null;
}

export function parseDiplomacyRelations(
	root: Record<string, unknown>,
): DiplomacyRelation[] {
	const out: DiplomacyRelation[] = [];

	const gameNode = root.Game;
	if (!isElement(gameNode)) return out;

	parseTribeDiplomacy(gameNode.TribeDiplomacy, out);
	parseTeamDiplomacy(gameNode.TeamDiplomacy, out);

	return out;
}

/**
 * Parse `<TribeDiplomacy>` children. Keys look like `TRIBE_REBELS.0` —
 * tribe name (which may contain dots in unusual cases) followed by `.player_id`.
 * Mirrors `rsplitn(2, '.')` on the Rust side via lastIndexOf — splits on the
 * RIGHTMOST dot only.
 */
function parseTribeDiplomacy(node: unknown, out: DiplomacyRelation[]): void {
	if (!isElement(node)) return;

	for (const [key, value] of getElementChildren(node)) {
		if (typeof value !== "string" || value === "") {
			throw new ParseError(
				`TribeDiplomacy.${key} text content`,
				"MISSING_FIELD",
			);
		}

		const lastDot = key.lastIndexOf(".");
		if (lastDot === -1) continue; // invalid key format — Rust logs warning + continue

		const tribeName = key.slice(0, lastDot);
		const playerId = key.slice(lastDot + 1);

		out.push({
			entity1Type: "tribe",
			entity1Id: tribeName,
			entity2Type: "player",
			entity2Id: playerId,
			relation: value,
			warScore: null,
			lastConflictTurn: null,
			lastDiplomacyTurn: null,
			diplomacyBlockedUntilTurn: null,
		});
	}
}

/**
 * Parse `<TeamDiplomacy>` children. Keys look like `T.0.1` — exactly three
 * dot-separated parts, first must be `T`.
 *
 * Note both teams are still emitted with entity_type = "player" (NOT "team")
 * to match the Rust source; the source-element name is `TeamDiplomacy` but
 * the modeled entities are players.
 */
function parseTeamDiplomacy(node: unknown, out: DiplomacyRelation[]): void {
	if (!isElement(node)) return;

	for (const [key, value] of getElementChildren(node)) {
		if (typeof value !== "string" || value === "") {
			throw new ParseError(
				`TeamDiplomacy.${key} text content`,
				"MISSING_FIELD",
			);
		}

		const parts = key.split(".");
		if (parts.length !== 3 || parts[0] !== "T") continue; // invalid format

		out.push({
			entity1Type: "player",
			entity1Id: parts[1],
			entity2Type: "player",
			entity2Id: parts[2],
			relation: value,
			warScore: null,
			lastConflictTurn: null,
			lastDiplomacyTurn: null,
			diplomacyBlockedUntilTurn: null,
		});
	}
}

export function diplomacyRelationToRow(
	d: DiplomacyRelation,
): Record<string, unknown> {
	return {
		entity1_type: d.entity1Type,
		entity1_id: d.entity1Id,
		entity2_type: d.entity2Type,
		entity2_id: d.entity2Id,
		relation: d.relation,
		war_score: d.warScore,
		last_conflict_turn: d.lastConflictTurn,
		last_diplomacy_turn: d.lastDiplomacyTurn,
		diplomacy_blocked_until_turn: d.diplomacyBlockedUntilTurn,
	};
}
