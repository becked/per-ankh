// Per-player summary derivation from FullGameData blob.
//
// `cloud/src/games.ts` calls `derivePlayerSummary()` once per roster entry
// during upload; the returned row is bound into the player_summaries
// INSERT alongside the identity columns the caller already has
// (game_id, player_index, player_name, nation, is_human, is_uploader,
// is_winner).
//
// Computed columns drive the cross-game dashboards in spec §3.5
// (ruler archetype win rate, time-to-4th-law, science vs win rate at T50,
// nation/family meta, etc.). The blob arrays we read here all live in
// FullGameData (spec §3 R2 Blob Schema); the parser produces them on
// every upload.
//
// Type philosophy: the Valibot schema (cloud/src/schemas/game.ts) bounds
// the array sizes but treats most entries as `v.unknown()` since the
// parser is the source of truth. We narrow inline with `as` casts whose
// shapes mirror the auto-generated wire types in src/lib/types/ and
// src/lib/parser/types.ts (referenced in comments below).

import type { FullGameData, PlayerRosterEntry } from "./schemas/game";

// ---------- Wire-shape mirrors (kept in sync with src/lib/parser/types.ts
// and src/lib/types/) ----------

interface PlayerHistoryEntry {
	player_id: number;
	history: Array<{
		turn: number;
		points: number | null;
		military_power: number | null;
		legitimacy: number | null;
	}>;
}

interface CityRow {
	city_id: number;
	owner_nation: string | null;
	first_owner_player_xml_id: number | null;
	founded_turn: number;
}

interface FamilyRow {
	family_class: string;
	player_xml_id: number;
}

interface CharacterRow {
	xml_id: number;
	player_xml_id: number | null;
	is_royal: boolean;
	became_leader_turn: number | null;
	death_turn: number | null;
	archetype: string | null;
}

interface CharacterTraitRow {
	character_xml_id: number;
	trait_name: string;
	acquired_turn: number;
}

interface CompletedTechRow {
	player_id: number;
}

interface LawAdoptionEntry {
	player_id: number;
	data: Array<{ turn: number; law_count: number; law_name: string | null }>;
}

// ---------- Per-game indexes (computed once per upload, reused per player) ----------

export interface SummaryGameContext {
	finalPointsByIndex: Map<number, number>;
	firstPlace: number | null;
	secondPlace: number | null;
	totalTurns: number;
}

export function buildSummaryGameContext(
	blob: FullGameData,
): SummaryGameContext {
	const finalPointsByIndex = new Map<number, number>();
	const playerHistory = blob.player_history as PlayerHistoryEntry[];
	for (const ph of playerHistory) {
		const last = ph.history[ph.history.length - 1];
		if (last && last.points != null) {
			finalPointsByIndex.set(ph.player_id, last.points);
		}
	}

	const sortedFinalPoints = Array.from(finalPointsByIndex.values()).sort(
		(a, b) => b - a,
	);

	return {
		finalPointsByIndex,
		firstPlace: sortedFinalPoints[0] ?? null,
		secondPlace: sortedFinalPoints[1] ?? null,
		totalTurns: blob.match_metadata.total_turns,
	};
}

// ---------- Per-player derivation ----------

export interface DerivedSummary {
	family_classes: string | null; // JSON array
	starting_ruler_archetype: string | null;
	starting_ruler_traits: string | null; // JSON array
	starting_ruler_reign_turns: number | null;
	succession_count: number;
	final_points: number | null;
	final_military_power: number | null;
	final_legitimacy: number | null;
	cities_total: number;
	cities_founded: number;
	techs_completed: number;
	laws_count: number | null;
	fifth_city_turn: number | null;
	tenth_city_turn: number | null;
	fourth_law_turn: number | null;
	seventh_law_turn: number | null;
	vp_margin: number | null;
}

export function derivePlayerSummary(
	blob: FullGameData,
	player: PlayerRosterEntry,
	ctx: SummaryGameContext,
): DerivedSummary {
	const idx = player.player_index;

	// family_classes — distinct family_class values for this player's families,
	// preserving first-seen order. Stored as JSON for simple round-trip.
	const families = blob.families as FamilyRow[];
	const familyClassSet = new Set<string>();
	for (const f of families) {
		if (f.player_xml_id === idx && f.family_class) {
			familyClassSet.add(f.family_class);
		}
	}
	const family_classes =
		familyClassSet.size > 0 ? JSON.stringify([...familyClassSet]) : null;

	// Starting ruler — earliest is_royal character whose became_leader_turn
	// is non-null for this player. Pinacotheca's clarification: a "starting
	// ruler" is whoever held the throne first, regardless of whether the
	// turn-0 leader was hand-picked or randomly rolled.
	const characters = blob.characters as CharacterRow[];
	let startingRuler: CharacterRow | null = null;
	let succession_count = 0;
	for (const c of characters) {
		if (c.player_xml_id !== idx || c.became_leader_turn === null) continue;
		succession_count += 1;
		if (
			startingRuler === null ||
			(c.became_leader_turn ?? Infinity) <
				(startingRuler.became_leader_turn ?? Infinity)
		) {
			startingRuler = c;
		}
	}
	const starting_ruler_archetype = startingRuler?.archetype ?? null;
	let starting_ruler_traits: string | null = null;
	let starting_ruler_reign_turns: number | null = null;
	if (startingRuler) {
		const traits = blob.character_traits as CharacterTraitRow[];
		const startTraits: string[] = [];
		for (const t of traits) {
			if (t.character_xml_id === startingRuler.xml_id && t.acquired_turn <= 0) {
				startTraits.push(t.trait_name);
			}
		}
		starting_ruler_traits =
			startTraits.length > 0 ? JSON.stringify(startTraits) : null;

		// Reign length: from became_leader_turn until death (or end of game).
		// abdicated_turn isn't yet populated by the parser (always null);
		// the spec accepts (death_turn ?? total_turns) - became_leader_turn
		// as the v1 approximation.
		const start = startingRuler.became_leader_turn;
		if (start !== null) {
			const end = startingRuler.death_turn ?? ctx.totalTurns;
			starting_ruler_reign_turns = Math.max(0, end - start);
		}
	}

	// Per-turn series — last entry of this player's history.
	const playerHistory = blob.player_history as PlayerHistoryEntry[];
	const ownHistory = playerHistory.find((h) => h.player_id === idx);
	const lastPoint = ownHistory?.history[ownHistory.history.length - 1] ?? null;
	const final_points = lastPoint?.points ?? null;
	const final_military_power = lastPoint?.military_power ?? null;
	const final_legitimacy = lastPoint?.legitimacy ?? null;

	// Cities — `cities_total` is current ownership (matched by nation since
	// the wire shape carries `owner_nation`, not player xml_id, on CityInfo).
	// `cities_founded` uses `first_owner_player_xml_id` (added in parser
	// 2.3.0), which is stable across captures.
	const cityStats = blob.city_statistics as { cities: CityRow[] };
	const cities = cityStats.cities;
	let cities_total = 0;
	const founderTurns: number[] = [];
	for (const c of cities) {
		if (player.nation !== null && c.owner_nation === player.nation) {
			cities_total += 1;
		}
		if (c.first_owner_player_xml_id === idx) {
			founderTurns.push(c.founded_turn);
		}
	}
	founderTurns.sort((a, b) => a - b);
	const cities_founded = founderTurns.length;
	const fifth_city_turn = founderTurns[4] ?? null;
	const tenth_city_turn = founderTurns[9] ?? null;

	// Techs completed
	const completedTechs = blob.completed_techs as CompletedTechRow[];
	let techs_completed = 0;
	for (const t of completedTechs) {
		if (t.player_id === idx) techs_completed += 1;
	}

	// Laws — `laws_count` is the final law_count from law_adoption_history;
	// `fourth_law_turn` / `seventh_law_turn` use the n-th adoption event
	// (data points where law_name is non-null; synthetic start/end points
	// have law_name === null).
	const lawHistory = blob.law_adoption_history as LawAdoptionEntry[];
	const ownLaws = lawHistory.find((e) => e.player_id === idx);
	let laws_count: number | null = null;
	let fourth_law_turn: number | null = null;
	let seventh_law_turn: number | null = null;
	if (ownLaws) {
		const lastLawPoint = ownLaws.data[ownLaws.data.length - 1];
		laws_count = lastLawPoint?.law_count ?? null;

		const adoptions = ownLaws.data
			.filter((d) => d.law_name !== null)
			.sort((a, b) => a.turn - b.turn);
		fourth_law_turn = adoptions[3]?.turn ?? null;
		seventh_law_turn = adoptions[6]?.turn ?? null;
	}

	// vp_margin — winners get distance to second place (positive), everyone
	// else gets distance to first place (negative). NULL when this player
	// has no points or there's only one ranked player (no margin to compute).
	let vp_margin: number | null = null;
	const ownFinal = ctx.finalPointsByIndex.get(idx);
	if (ownFinal != null && ctx.firstPlace != null) {
		const isLeader = ownFinal === ctx.firstPlace;
		if (isLeader) {
			vp_margin = ctx.secondPlace != null ? ownFinal - ctx.secondPlace : null;
		} else {
			vp_margin = ownFinal - ctx.firstPlace;
		}
	}

	return {
		family_classes,
		starting_ruler_archetype,
		starting_ruler_traits,
		starting_ruler_reign_turns,
		succession_count,
		final_points,
		final_military_power,
		final_legitimacy,
		cities_total,
		cities_founded,
		techs_completed,
		laws_count,
		fifth_city_turn,
		tenth_city_turn,
		fourth_law_turn,
		seventh_law_turn,
		vp_margin,
	};
}
