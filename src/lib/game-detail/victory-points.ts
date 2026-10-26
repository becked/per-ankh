// What each player's victory points actually are at the end of the game.
//
// The save's `<PointsHistory>` is NOT that number. `Player.updateHistoryRates`
// (Player.cs:17065) stores `countVP()` against the current turn, and
// `Player.doTurn` (Player.cs:17017) calls it as its FIRST statement — before
// `processTurn` — so the value keyed to turn T describes the instant that
// seat's turn T began. `Player.setTurnPoints` (Player.cs:11378) then writes
// only on a change, so a seat's last entry can predate the save by many turns,
// and a dead seat's freezes at elimination. The game's own stats graph reads
// the same series and agrees with it; the victory screen does not, because
// `CompletedGame.Init` (CompletedGame.cs:95) takes `player.countVP()` live.
//
// So this module recomputes `Player.countVP` (Player.cs:19230) over the blob's
// end state, and holds the predicate for whether a game's points mean anything
// at all. Two surfaces read it — the game page's Victory Points metric bar and
// the Worker's `derivePlayerSummary`, which persists the answer as
// `player_summaries.final_points` for the stats corpus — so the definition
// lives here rather than once in each. What that does NOT buy is agreement
// about an already-stored game: the bar recomputes on every render, while
// `final_points` was written at upload and nothing rewrites it, so a game
// uploaded before this shipped keeps its old number in the corpus (and in
// `RecentSaveCard` and the per-nation average, which read the stored row)
// until an operator runs `./per-ankh admin reparse-all`.
//
// Like `gdp-basket.ts`, the module is reachable from `cloud/` across the
// package boundary, which means every import here is RELATIVE and itself
// dependency-free — the two generated tables and the semver compare — with no
// `$lib` aliases and nothing from the parser's type tree.
//
// What it CANNOT answer: `countVP` is `virtual`, so a scenario is free to
// score its own way. A save names the scenario and mods that were in force
// (`setup_parameters.Scenario`, `enabled_mods`) but says nothing about whether
// either replaced the scoring. The Hill is the corpus's one such save — a
// king-of-the-hill scenario whose Rome recorded 1207 points on turn 15,
// against a base-game rule that computes 0 — and its mod source does not ship
// with `Reference/`, so there is nothing to read the override from. The cost
// is a wrong answer rather than a missing one, and a conspicuous one: that
// seat won the game on points, and the base-game rule ranks it LAST, behind
// two Assyrian seats it pays 9 each. 1 of the 116 saves in `test-data/saves/`.

import { isNewer } from "../utils/semver";
import { VICTORY_POINT_VICTORIES } from "../generated/game-setup";
import {
	CULTURE_VP,
	IMPROVEMENT_VP,
	PROJECT_VP,
	TECH_VP,
} from "../generated/victory-points";

/**
 * The oldest blob this recomputation can read. Three optional fields have to
 * be there, and the newest of them sets the floor:
 *
 *   - `map_tiles[].owner_player_xml_id` (2.10.0) — the improvement term is
 *     credited to the TILE's owner, which is the only key that expresses it.
 *     `improvement_data` covers older blobs and answers a different question:
 *     it keys on the territory city's player and carries no pillaged flag.
 *   - `city_statistics.cities[].project_counts` (2.15.0) — the project term.
 *   - `map_tiles[].improvement_turns_left` (2.17.0) — without it an
 *     unfinished wonder counts as built, the defect `getActiveImprovement`
 *     (Tile.cs:5167) exists to prevent.
 *
 * `culture_step` (2.29.0) is deliberately NOT part of the floor: it is
 * additive and reads 0 on an older blob, which costs a Legendary city that
 * kept growing its extra point rather than making the whole total unreadable.
 * Below the floor there is no partial answer worth showing, so the callers
 * fall back to the game's own recorded series.
 */
const VICTORY_POINT_MIN_PARSER_VERSION = "2.17.0";

/** `city_statistics.cities[]`, narrowed to what `countVP` reads. */
interface VictoryPointCityLike {
	owner_player_xml_id?: number | null;
	culture_level: string | null;
	culture_step?: number;
	project_counts?: Array<{ project: string; count: number }>;
}

/** `map_tiles[]`, narrowed to what `countVP` reads. */
export interface VictoryPointTileLike {
	owner_player_xml_id?: number | null;
	owner_city: string | null;
	improvement: string | null;
	improvement_pillaged: boolean;
	improvement_turns_left?: number | null;
}

/** `completed_techs[]`, narrowed to what `countVP` reads. */
interface VictoryPointTechLike {
	player_id: number;
	tech: string;
}

/** `player_history[]`, narrowed to the seat list. */
interface VictoryPointHistoryLike {
	player_id: number;
	history: Array<{ points: number | null }>;
}

export interface VictoryPointSources {
	parserVersion: string;
	/**
	 * `victory_conditions`, the `+`-joined victory types the game enabled —
	 * `match_metadata`'s copy in the Worker, `game_details`' on the page
	 * (`derive/game-details.ts` writes both from one source).
	 */
	victoryConditions: string | null;
	playerHistory: readonly VictoryPointHistoryLike[];
	cities: readonly VictoryPointCityLike[];
	mapTiles: readonly VictoryPointTileLike[];
	completedTechs: readonly VictoryPointTechLike[];
}

/**
 * Whether the game can be won on victory points, so points mean something —
 * the game's own `isPointsVictory` (`buildGameParametersDesc`,
 * HelpText.Game.cs:3726): an ENABLED victory type whose `<iPercentVP>` is
 * non-zero, which `VICTORY_POINT_VICTORIES` is the baked set of.
 *
 * Not the same question as whether `VICTORY_POINTS` itself is on: Double
 * carries `iPercentVP` 50, so a game with only Double enabled still has a
 * points threshold. 0 of the 116 saves in `test-data/saves/` enable Double
 * without Points, so the corpus cannot tell the two answers apart — which is
 * why it is the game's rule here rather than the simpler test, and why the
 * Settings tab's Points to Win row and the victory-point charts read this one
 * predicate instead of two.
 *
 * A blob carrying no `victory_conditions` at all answers false — 1 of those
 * 116 saves. It cannot say, and it records no points either, so nothing is
 * lost by reading it as a game that was not played for them.
 */
export function hasVictoryPoints(victoryConditions: string | null): boolean {
	const enabled = new Set(victoryConditions?.split("+"));
	return VICTORY_POINT_VICTORIES.some((v) => enabled.has(v));
}

/**
 * Every seat's `countVP()` over the save's end state, keyed by player xml id —
 * or `null` when this blob cannot answer, which is the caller's signal to fall
 * back to the recorded series rather than to show a number that is short.
 *
 * `null` covers two cases:
 *   - the blob predates {@link VICTORY_POINT_MIN_PARSER_VERSION};
 *   - the game cannot be won on points, {@link hasVictoryPoints}. Recomputing
 *     there would print a victory-point total for a game that was never played
 *     for them.
 *
 * Deliberately NOT gated on whether the save recorded a points series: an
 * empty `<PointsHistory>` is an old build or a game too short to have written
 * one, not a victory setting. Across `test-data/saves/`, 4 saves record no
 * points with a points victory enabled — three of them 2022 builds, one a
 * turn-1 save — and 0 record points with none enabled, so the victory settings
 * answer the question the series only approximates.
 *
 * Within a game that can be won on points, every seat gets a number,
 * including a seat that never scored and one that was conquered out:
 * `Player.getTurnPoints` (Player.cs:11369) answers 0 for both, and so does
 * `countVP()`.
 */
export function victoryPointsByPlayer(
	src: VictoryPointSources,
): Map<number, number> | null {
	if (isNewer(VICTORY_POINT_MIN_PARSER_VERSION, src.parserVersion)) return null;
	if (!hasVictoryPoints(src.victoryConditions)) return null;

	const totals = new Map<number, number>();
	for (const p of src.playerHistory) totals.set(p.player_id, 0);
	const add = (playerId: number | null | undefined, vp: number): void => {
		if (playerId == null || vp === 0) return;
		const prev = totals.get(playerId);
		// A player the history doesn't list owns nothing `countVP` is summed
		// for — the seat list is the history's, not the board's.
		if (prev === undefined) return;
		totals.set(playerId, prev + vp);
	};

	// Culture: each owned city pays its own tier (`Player.countCultureCities`,
	// Player.cs:18540 — the game sums `countCultureCities(tier) * tier.miVP`
	// across tiers, which is the same thing per city), plus one per growth past
	// the top tier. The step only counts where there IS a tier, matching
	// `countCultureStepVPs`' own `culture().miVP > 0` gate (Player.cs:18556);
	// every tier carries a VP, so that gate is "the city has a culture level".
	for (const c of src.cities) {
		const tierVp =
			c.culture_level != null ? (CULTURE_VP[c.culture_level] ?? 0) : 0;
		if (tierVp > 0) add(c.owner_player_xml_id, tierVp + (c.culture_step ?? 0));
		for (const pc of c.project_counts ?? []) {
			add(c.owner_player_xml_id, (PROJECT_VP[pc.project] ?? 0) * pc.count);
		}
	}

	// Improvements: `Tile.changeImprovement` (Tile.cs:6550) credits the TILE's
	// owner with the effect player of `getActiveImprovement` (Tile.cs:5167) —
	// which is nothing while the improvement is pillaged or unfinished — and
	// only inside a city's territory, the `cityTerritory() != null` the whole
	// grant sits under. `owner_city` is that territory; it is non-null on every
	// VP-bearing tile in `test-data/saves/`, so the term is the game's rule
	// rather than a filter the corpus asked for.
	for (const t of src.mapTiles) {
		if (t.improvement == null || t.owner_city == null) continue;
		if (t.improvement_pillaged) continue;
		if ((t.improvement_turns_left ?? 0) > 0) continue;
		add(t.owner_player_xml_id, IMPROVEMENT_VP[t.improvement] ?? 0);
	}

	// Techs: `Player.setTechCount` (Player.cs:8452) grants the tech's effect
	// player on acquisition and nothing takes it back, so a seat that lost
	// every city still carries these.
	for (const t of src.completedTechs) add(t.player_id, TECH_VP[t.tech] ?? 0);

	return totals;
}
