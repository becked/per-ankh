import { describe, expect, it } from "vitest";
import { deriveLeaderReigns } from "./derive-leader-reigns";
import type { FullGameData } from "./schemas/game";

interface Char {
	xml_id: number;
	player_xml_id: number | null;
	became_leader_turn: number | null;
	death_turn?: number | null;
	archetype?: string | null;
}

// Only the two fields the derivation reads. Cast at the boundary the way the
// production caller's blob does — the Valibot schema leaves these entries
// `v.unknown()`.
function blob(totalTurns: number, characters: Char[]): FullGameData {
	return {
		match_metadata: { total_turns: totalTurns },
		characters: characters.map((c) => ({
			death_turn: null,
			archetype: null,
			...c,
		})),
	} as unknown as FullGameData;
}

describe("deriveLeaderReigns", () => {
	it("ends a reign at the next accession, not at the leader's death", () => {
		// The predecessor outlives their own abdication by 20 turns — 87 of the
		// local corpus's 528 successions look like this, and reading death as
		// the boundary would credit both leaders with turns 30-50.
		const reigns = deriveLeaderReigns(
			blob(100, [
				{ xml_id: 1, player_xml_id: 0, became_leader_turn: 1, death_turn: 50 },
				{ xml_id: 2, player_xml_id: 0, became_leader_turn: 30 },
			]),
		);

		expect(reigns).toEqual([
			{
				player_index: 0,
				character_xml_id: 1,
				archetype: null,
				start_turn: 1,
				end_turn: 30,
			},
			{
				player_index: 0,
				character_xml_id: 2,
				archetype: null,
				start_turn: 30,
				end_turn: 100,
			},
		]);
		// Half-open: the successor holds turn 30, so the turns partition.
		const held = reigns.map((r) => r.end_turn - r.start_turn);
		expect(held).toEqual([29, 70]);
		expect(held[0] + held[1]).toBe(99);
	});

	it("falls back to the death turn, then to the game's last turn", () => {
		const reigns = deriveLeaderReigns(
			blob(80, [
				{ xml_id: 1, player_xml_id: 0, became_leader_turn: 1, death_turn: 40 },
				{ xml_id: 2, player_xml_id: 1, became_leader_turn: 1 },
			]),
		);

		// Seat 0's only leader died: the reign stops there rather than running
		// to the end of a game they did not see out.
		expect(reigns.find((r) => r.player_index === 0)?.end_turn).toBe(40);
		// Seat 1's leader is still on the throne when the save was written.
		expect(reigns.find((r) => r.player_index === 1)?.end_turn).toBe(80);
	});

	it("orders a seat's reigns by accession and breaks ties on xml_id", () => {
		// Two accessions on one turn happens 7 times in the local corpus. Both
		// reigns come out zero-length whichever way round they fall, so the
		// tiebreak costs no throne-time — but the order has to be total, or the
		// `end_turn` of one depends on Array#sort's stability.
		const reigns = deriveLeaderReigns(
			blob(60, [
				{ xml_id: 9, player_xml_id: 0, became_leader_turn: 20 },
				{ xml_id: 4, player_xml_id: 0, became_leader_turn: 20 },
				{ xml_id: 1, player_xml_id: 0, became_leader_turn: 1 },
			]),
		);

		expect(reigns.map((r) => r.character_xml_id)).toEqual([1, 4, 9]);
		expect(reigns.map((r) => r.end_turn - r.start_turn)).toEqual([19, 0, 40]);
	});

	it("never reports a negative reign", () => {
		// A leader whose accession postdates the save's last recorded turn. The
		// clamp is what keeps a negative from being summed into a band.
		const reigns = deriveLeaderReigns(
			blob(10, [{ xml_id: 1, player_xml_id: 0, became_leader_turn: 25 }]),
		);

		expect(reigns[0].end_turn).toBe(25);
		expect(reigns[0].end_turn - reigns[0].start_turn).toBe(0);
	});

	it("skips characters who never held a throne, and tribal ones", () => {
		const reigns = deriveLeaderReigns(
			blob(50, [
				// A royal who never acceded.
				{ xml_id: 1, player_xml_id: 0, became_leader_turn: null },
				// A tribal leader: Player="-1" in the save, so no seat owns them.
				{ xml_id: 2, player_xml_id: null, became_leader_turn: 1 },
				{ xml_id: 3, player_xml_id: 0, became_leader_turn: 1 },
			]),
		);

		expect(reigns.map((r) => r.character_xml_id)).toEqual([3]);
	});

	it("carries the archetype through, including its absence", () => {
		const reigns = deriveLeaderReigns(
			blob(50, [
				{
					xml_id: 1,
					player_xml_id: 0,
					became_leader_turn: 1,
					archetype: "TRAIT_JUDGE_ARCHETYPE",
				},
				// A child ruler, or a save too old for <TraitTurn>: 92 of the
				// corpus's 742 reigns have no archetype, and null is the honest
				// answer rather than a bucket.
				{ xml_id: 2, player_xml_id: 1, became_leader_turn: 1 },
			]),
		);

		expect(reigns.map((r) => r.archetype)).toEqual([
			"TRAIT_JUDGE_ARCHETYPE",
			null,
		]);
	});
});
