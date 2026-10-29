import { describe, expect, it } from "vitest";
import { deriveLeaderReigns } from "./derive-leader-reigns";
import type { FullGameData } from "./schemas/game";

interface Char {
	xml_id: number;
	player_xml_id?: number | null;
	became_leader_turn?: number | null;
	archetype?: string | null;
}

// Characters exactly as given — no defaults filled in, so a test can omit a
// key the way a blob stored by an older parser does. Cast at the boundary the
// way the production caller's blob is: the Valibot schema leaves these entries
// `v.unknown()`.
function blob(characters: Char[]): FullGameData {
	return { characters } as unknown as FullGameData;
}

describe("deriveLeaderReigns", () => {
	it("skips characters who never held a throne, and tribal ones", () => {
		const reigns = deriveLeaderReigns(
			blob([
				// A royal who never acceded.
				{ xml_id: 1, player_xml_id: 0, became_leader_turn: null },
				// A tribal leader: Player="-1" in the save, so no seat owns them.
				{ xml_id: 2, player_xml_id: null, became_leader_turn: 1 },
				{ xml_id: 3, player_xml_id: 0, became_leader_turn: 1 },
			]),
		);

		expect(reigns).toEqual([
			{
				player_index: 0,
				character_xml_id: 3,
				archetype: null,
				start_turn: 1,
			},
		]);
	});

	it("carries the archetype through, including its absence", () => {
		const reigns = deriveLeaderReigns(
			blob([
				{
					xml_id: 1,
					player_xml_id: 0,
					became_leader_turn: 1,
					archetype: "TRAIT_JUDGE_ARCHETYPE",
				},
				// A child ruler, or a save too old for <TraitTurn>: 92 of the
				// corpus's 742 human-seat reigns have no archetype, and null is the
				// honest answer rather than a bucket.
				{ xml_id: 2, player_xml_id: 1, became_leader_turn: 1 },
			]),
		);

		expect(reigns.map((r) => r.archetype)).toEqual([
			"TRAIT_JUDGE_ARCHETYPE",
			null,
		]);
	});

	it("normalizes an absent key to null rather than passing undefined to D1", () => {
		// A blob written before the field existed omits the key outright, and
		// `bind()` rejects undefined. Both fields the guards read, and the one
		// the row carries, are covered: no seat, no accession, no archetype.
		const reigns = deriveLeaderReigns(
			blob([
				{ xml_id: 1 },
				{ xml_id: 2, became_leader_turn: 10 },
				{ xml_id: 3, player_xml_id: 0 },
				{ xml_id: 4, player_xml_id: 0, became_leader_turn: 10 },
			]),
		);

		expect(reigns).toEqual([
			{
				player_index: 0,
				character_xml_id: 4,
				archetype: null,
				start_turn: 10,
			},
		]);
	});

	it("gives a seat one row per leader, in blob order", () => {
		// Nothing downstream reads the order — the reader bands each row by its
		// own accession turn — so the derivation keeps the blob's and sorts
		// nothing.
		const reigns = deriveLeaderReigns(
			blob([
				{ xml_id: 9, player_xml_id: 0, became_leader_turn: 42 },
				{ xml_id: 1, player_xml_id: 0, became_leader_turn: 1 },
				{ xml_id: 4, player_xml_id: 1, became_leader_turn: 1 },
			]),
		);

		expect(reigns.map((r) => [r.player_index, r.start_turn])).toEqual([
			[0, 42],
			[0, 1],
			[1, 1],
		]);
	});
});
