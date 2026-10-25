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

import { cultureRank } from "./generated/wonders";
// Reaching across the package boundary, same rule as the gdp-basket import in
// games.ts: victory-points.ts is deliberately dependency-free (one relative
// import of its generated table, no $lib aliases) so the Worker bundle holds
// the one definition of countVP rather than a mirror of it that drifts from
// the game page's.
import { victoryPointsByPlayer } from "../../src/lib/game-detail/victory-points";
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
	owner_player_xml_id: number | null;
	first_owner_player_xml_id: number | null;
	// One entry per player who has ever owned the city (parser 2.10.0+);
	// absent on older blobs.
	player_families?: Array<{ player_xml_id: number }>;
	founded_turn: number;
	culture_level: string | null;
	// Culture growths past the top tier (parser 2.29.0+) and per-city project
	// completions (2.15.0+) — the two city-side terms of countVP; absent on
	// older blobs, where each reads as nothing granted.
	culture_step?: number;
	project_counts?: Array<{ project: string; count: number }>;
	is_capital: boolean;
	family_class: string | null;
}

// `map_tiles[]`, narrowed to the improvement term of countVP.
interface MapTileRow {
	owner_player_xml_id?: number | null;
	owner_city: string | null;
	improvement: string | null;
	improvement_pillaged: boolean;
	improvement_turns_left?: number | null;
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
	tech: string;
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
	const playerHistory = blob.player_history as PlayerHistoryEntry[];
	const cityStats = blob.city_statistics as { cities: CityRow[] };

	// Victory points as the game's own victory screen computes them, not as
	// its turn-start series records them — the recomputation is the number,
	// and the series is the fallback for a blob too old to answer (#340).
	// `vp_margin` below reads the same map, so a seat's margin can never be
	// measured against a total nobody is shown.
	const recomputed = victoryPointsByPlayer({
		parserVersion: blob.parser_version,
		playerHistory,
		cities: cityStats.cities,
		mapTiles: blob.map_tiles as MapTileRow[],
		completedTechs: blob.completed_techs as CompletedTechRow[],
	});

	const finalPointsByIndex = new Map<number, number>();
	for (const ph of playerHistory) {
		const fromBlob = recomputed?.get(ph.player_id);
		if (fromBlob !== undefined) {
			finalPointsByIndex.set(ph.player_id, fromBlob);
			continue;
		}
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
	capital_family_class: string | null;
	starting_ruler_archetype: string | null;
	starting_ruler_traits: string | null; // JSON array
	starting_ruler_reign_turns: number | null;
	succession_count: number;
	final_points: number | null;
	final_military_power: number | null;
	final_legitimacy: number | null;
	cities_total: number;
	cities_founded: number;
	best_culture_level: string | null;
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
			// The game stamps a starting leader's traits — their archetype plus
			// the personality trait(s) they begin with — on turn 1, not turn 0:
			// characters are born pre-game (birth_turn is negative) but no trait
			// row exists before the first played turn. The original `<= 0` bound
			// therefore matched nothing, leaving this column empty for every row.
			// Traits acquired later (events, aging) have higher turns and stay out.
			if (t.character_xml_id === startingRuler.xml_id && t.acquired_turn <= 1) {
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

	// Per-turn series — last entry of this player's history. Military power and
	// legitimacy are the recorded value; points are not, because the series
	// samples them at the top of the seat's own turn (see victory-points.ts) —
	// `ctx.finalPointsByIndex` holds the end-state recomputation, with the
	// recorded value as its fallback.
	const playerHistory = blob.player_history as PlayerHistoryEntry[];
	const ownHistory = playerHistory.find((h) => h.player_id === idx);
	const lastPoint = ownHistory?.history[ownHistory.history.length - 1] ?? null;
	const final_points = ctx.finalPointsByIndex.get(idx) ?? null;
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
	// Highest culture level across every city the player ever held — the wonder
	// charts' eligibility gate (a wonder needs a city at its <CulturePrereq>).
	// Keyed on player xml_id rather than nation so a mirror match doesn't credit
	// one side with the other's cities.
	//
	// "Ever held" rather than the end-state owner: culture only ever climbs per
	// CITY, but a player does not monotonically keep their cities. Reading the
	// final snapshot gives a player conquered out of the game no culture level
	// at all and so no eligibility for anything — and those are exactly the
	// players who didn't build wonders, so the denominator would close in around
	// the builders and inflate every build rate. Conquest finishes are common in
	// a 1v1 corpus, so that isn't a tail case.
	//
	// The cost: culture_level is an end-state value, so an earlier owner is
	// credited with culture the city reached after they lost it. That errs
	// toward counting a player eligible, which understates build rates instead
	// of flattering them — the safer direction for a chart about what gets
	// passed over. Resolving it exactly needs per-turn city culture, which the
	// blob doesn't carry (derive/city-statistics.ts reads one level per city).
	let best_culture_level: string | null = null;
	// The family running the capital — the city every early bonus compounds
	// through, so a distinct decision from which three families the player has.
	// Keyed on owner_player_xml_id rather than nation so a mirror match doesn't
	// credit one side with the other's capital.
	let capital_family_class: string | null = null;
	for (const c of cities) {
		if (player.nation !== null && c.owner_nation === player.nation) {
			cities_total += 1;
		}
		if (c.first_owner_player_xml_id === idx) {
			founderTurns.push(c.founded_turn);
		}
		// Pre-2.10.0 blobs carry no ownership record, leaving the end-state
		// owner as the only signal available.
		const everHeld =
			c.player_families?.some((f) => f.player_xml_id === idx) ??
			c.owner_player_xml_id === idx;
		if (
			everHeld &&
			cultureRank(c.culture_level) > cultureRank(best_culture_level)
		) {
			best_culture_level = c.culture_level;
		}
		// First match wins. A player holds one capital, so the guard should never
		// fire — but the blob is an unordered list, and without it a second
		// is_capital row would silently make attribution depend on array order.
		if (
			capital_family_class === null &&
			c.is_capital &&
			c.owner_player_xml_id === idx &&
			c.family_class
		) {
			capital_family_class = c.family_class;
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
		capital_family_class,
		starting_ruler_archetype,
		starting_ruler_traits,
		starting_ruler_reign_turns,
		succession_count,
		final_points,
		final_military_power,
		final_legitimacy,
		cities_total,
		cities_founded,
		best_culture_level,
		techs_completed,
		laws_count,
		fifth_city_turn,
		tenth_city_turn,
		fourth_law_turn,
		seventh_law_turn,
		vp_margin,
	};
}
