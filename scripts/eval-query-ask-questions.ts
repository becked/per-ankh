// The test set for the Explore ask eval (scripts/eval-query-ask.ts, issue #380).
//
// Each question is paired with what the ask path should return for it:
//
//   * `selections` — the canonical selections that answer it. More than one
//     where the catalog has two honest spellings of the same question (a win
//     count per nation is `wins` by `nation` on seats, or `matches` by
//     `winner_nation` on games). The eval passes a reply that matches any one.
//   * `unsupported` — the catalog cannot express the question, so the model
//     should say so. These are the questions where the model's easy failure is
//     to answer a nearby, wider question, which reads like the right answer.
//   * `refused` — the question names something the rosters do not hold. Either
//     refusal passes: every reply failing the checks, or the model replying
//     "unsupported" once the retry has told it the name matched nothing. What
//     fails is a selection, which is the name moved into an unchecked filter
//     such as `player_name`, answered with zero rows.
//
// The first three are #272's acceptance questions.
//
// Player and tournament names are matched against the fixture rosters below,
// not against D1. The names are invented, so no real player's name is in the
// repository, and the IDs are 21-character tokens shaped like the nanoids the
// real rosters carry.

import type { CatalogRosterOption } from "../cloud/src/query/catalog";

export const FIXTURE_TOURNAMENTS: CatalogRosterOption[] = [
	{ value: "evalTournamentSpring1", label: "Per-Ankh Spring Cup 2026" },
	{ value: "evalTournamentWinter1", label: "Winter Duel League" },
];

export const FIXTURE_PLAYERS: CatalogRosterOption[] = [
	{ value: "evalPlayerNefertari01", label: "Nefertari" },
	{ value: "evalPlayerOstrakon001", label: "Ostrakon" },
	{ value: "evalPlayerZenobia4201", label: "Zenobia42" },
	{ value: "evalPlayerAlexios0001", label: "Alexios" },
];

const SPRING = FIXTURE_TOURNAMENTS[0].value;
const WINTER = FIXTURE_TOURNAMENTS[1].value;
const NEFERTARI = FIXTURE_PLAYERS[0].value;
const OSTRAKON = FIXTURE_PLAYERS[1].value;
const ZENOBIA = FIXTURE_PLAYERS[2].value;

export type Expected =
	{ selections: string[] } | { unsupported: true } | { refused: true };

export interface EvalQuestion {
	id: string;
	question: string;
	expected: Expected;
}

export const QUESTIONS: EvalQuestion[] = [
	// ── #272's acceptance questions ──
	{
		id: "pyramids-in-tournament",
		question: "Which players in the Spring Cup built the Pyramids?",
		expected: {
			selections: [
				`source=wonder_events&dim=player&measure=wonders_built&f=tournament:in:${SPRING}&f=wonder:in:IMPROVEMENT_PYRAMIDS`,
			],
		},
	},
	{
		id: "carthage-schemer",
		question:
			"How many times has a player played Carthage with a Schemer-archetype ruler?",
		expected: {
			selections: [
				"source=player_summaries&measure=seats&f=nation:in:NATION_CARTHAGE&f=starting_archetype:in:TRAIT_SCHEMER_ARCHETYPE",
				"source=player_summaries&dim=player&measure=seats&f=nation:in:NATION_CARTHAGE&f=starting_archetype:in:TRAIT_SCHEMER_ARCHETYPE",
			],
		},
	},
	{
		id: "ballistae-in-tournament",
		question: "Who built the most ballistae in the Per-Ankh Spring Cup 2026?",
		expected: {
			selections: [
				`source=player_units_produced&dim=player&measure=units_produced&f=tournament:in:${SPRING}&f=unit:in:UNIT_BALLISTA`,
			],
		},
	},

	// ── Expressible ──
	{
		id: "nation-wins",
		question: "Which nation wins the most?",
		expected: {
			selections: [
				"source=player_summaries&dim=nation&measure=wins",
				"source=games&dim=winner_nation&measure=matches",
			],
		},
	},
	{
		id: "dota-length",
		question: "What's the average game length on Duel of the Ancients maps?",
		expected: {
			selections: [
				"source=games&measure=avg_turns&f=map_class:in:MAPCLASS_MapScriptDota",
			],
		},
	},
	{
		id: "duel-archetypes",
		question:
			"What's the most popular starting archetype in multiplayer duels?",
		expected: {
			selections: [
				"source=player_summaries&dim=starting_archetype&measure=seats&f=game_mode:in:duel",
			],
		},
	},
	{
		id: "divine-rule-earliest",
		question: "What's the earliest turn anyone has adopted Divine Rule?",
		expected: {
			selections: [
				"source=law_events&measure=earliest_law_turn&f=law:in:LAW_DIVINE_RULE",
			],
		},
	},
	{
		id: "nefertari-games",
		question: "How many games has Nefertari played?",
		expected: {
			selections: [
				`source=player_summaries&measure=seats&f=player:in:${NEFERTARI}`,
				`source=player_summaries&measure=matches&f=player:in:${NEFERTARI}`,
			],
		},
	},
	{
		id: "ostrakon-wins-by-nation",
		question: "How many wins does Ostrakon have with each nation?",
		expected: {
			selections: [
				`source=player_summaries&dim=nation&measure=wins&f=player:in:${OSTRAKON}`,
			],
		},
	},
	{
		id: "wonders-most-built",
		question: "Which wonders get built most often?",
		expected: {
			selections: ["source=wonder_events&dim=wonder&measure=wonders_built"],
		},
	},
	{
		id: "ironworking-turn",
		question: "On average, what turn do players research Ironworking?",
		expected: {
			selections: [
				"source=tech_events&measure=avg_tech_turn&f=tech:in:TECH_IRONWORKING",
			],
		},
	},
	{
		id: "rome-high-score",
		question: "What's the highest final score anyone has reached playing Rome?",
		expected: {
			selections: [
				"source=player_summaries&measure=max_points&f=nation:in:NATION_ROME",
			],
		},
	},
	{
		id: "conquest-count",
		question: "How many matches ended in a conquest victory?",
		expected: {
			selections: [
				"source=games&measure=matches&f=victory_type:in:VICTORY_CONQUEST",
			],
		},
	},
	{
		id: "top-ten-duel-winners",
		question: "Top 10 players by multiplayer duel wins",
		expected: {
			selections: [
				"source=player_summaries&dim=player&measure=wins&f=game_mode:in:duel&limit=10",
			],
		},
	},
	{
		id: "fewest-reigns",
		question: "Which leader archetype has had the fewest reigns?",
		expected: {
			selections: [
				"source=leader_reigns&dim=reign_archetype&measure=reigns&sort=measure_asc",
			],
		},
	},
	{
		id: "2026-by-map-size",
		question: "How many games were played in 2026, by map size?",
		expected: {
			selections: [
				"source=games&dim=map_size&measure=matches&f=played:gte:2026-01-01&f=played:lte:2026-12-31",
			],
		},
	},
	{
		id: "hanging-gardens-pool",
		question: "In how many games were the Hanging Gardens available?",
		expected: {
			selections: [
				"source=game_wonder_pool&measure=wonders_available&f=pool_wonder:in:IMPROVEMENT_HANGING_GARDENS",
				"source=game_wonder_pool&measure=matches&f=pool_wonder:in:IMPROVEMENT_HANGING_GARDENS",
			],
		},
	},
	{
		id: "science-by-nation",
		question: "Which nations average the most science per turn?",
		expected: {
			selections: ["source=game_player_turn&dim=nation&measure=avg_science"],
		},
	},
	{
		id: "babylonia-long-games",
		question:
			"How many wins does Babylonia have in games of at least 100 turns?",
		expected: {
			selections: [
				"source=player_summaries&measure=wins&f=nation:in:NATION_BABYLONIA&f=total_turns:gte:100",
			],
		},
	},
	{
		id: "zenobia-hoplites",
		question: "How many hoplites has Zenobia42 trained?",
		expected: {
			selections: [
				`source=player_units_produced&measure=units_produced&f=player:in:${ZENOBIA}&f=unit:in:UNIT_HOPLITE`,
			],
		},
	},
	{
		id: "egypt-winter-league",
		question:
			"Which player has won the most games as Egypt in the Winter Duel League?",
		expected: {
			selections: [
				`source=player_summaries&dim=player&measure=wins&f=nation:in:NATION_EGYPT&f=tournament:in:${WINTER}`,
			],
		},
	},
	{
		id: "best-average-points",
		question: "Who has the highest average final points?",
		expected: {
			selections: ["source=player_summaries&dim=player&measure=avg_points"],
		},
	},
	{
		id: "family-cities",
		question: "On average, how many cities does each family class end up with?",
		expected: {
			selections: [
				"source=player_family_cities&dim=family_class&measure=avg_family_cities",
			],
		},
	},

	// ── Not expressible ──
	{
		id: "religion-founded",
		question: "Which religion gets founded first most often?",
		expected: { unsupported: true },
	},
	{
		id: "cities-lost-to-rebels",
		question: "How many cities have players lost to rebels?",
		expected: { unsupported: true },
	},
	{
		id: "assyria-win-rate",
		question: "What's Assyria's win rate?",
		expected: { unsupported: true },
	},
	{
		id: "win-streak",
		question: "Which player has the longest win streak?",
		expected: { unsupported: true },
	},
	{
		id: "first-tech",
		question: "What's the most common first tech players research?",
		expected: { unsupported: true },
	},
	{
		id: "characters-killed",
		question: "How many characters die in battle per game on average?",
		expected: { unsupported: true },
	},
	{
		id: "nation-matchups",
		question: "Which two nations face each other most often in duels?",
		expected: { unsupported: true },
	},
	{
		id: "resources-traded",
		question: "Who has traded the most resources?",
		expected: { unsupported: true },
	},

	// ── Names the rosters do not hold ──
	{
		id: "unknown-player",
		question: "How many games has Gilgamesh99 played?",
		expected: { refused: true },
	},
];
