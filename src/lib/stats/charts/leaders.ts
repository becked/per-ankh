// Leaders tab option builders — who sat the throne, and how they fared.
//
// Three charts over two sources. The starting leader's archetype and
// personality traits are the roll Old World hands a seat at game start; the
// third counts every leader the seat went on to have, banded by the turn each
// took the throne, because the starting one is 214 of the local corpus's 742
// (cloud/src/stats/leader-reigns.ts has the measurement).
//
// All three are the shared wins/losses stack, so bar length reads as "how many
// of these there were" and the split as "how many of those won". The two
// archetype charts count different things — seats for the starting roll,
// leaders for the rest — and both being counts is what makes them readable
// against each other.

import type { ChartOption } from "$lib/echarts";
import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
import { archetypeSpriteKey, formatArchetype } from "$lib/utils/formatting";
import type { ChartBundleCore, LeaderArchetypeBand } from "../types";
import { fmtTrait, winLossStackedOption, type WinLossRow } from "./helpers";

// The two starting charts' empty states, each naming the domain its panel is
// short of and referenced from the panel and the tournament page rather than
// retyped at each. The three charts read three separate sources — two
// player_summaries columns (starting_ruler_archetype, starting_ruler_traits)
// and the leader_reigns table — and go empty independently; the third chart's
// messages are leaderBandEmptyMessage's, which has four of them.
export const ARCHETYPE_EMPTY_MESSAGE = "No leader archetype data available.";
export const TRAIT_EMPTY_MESSAGE = "No leader trait data available.";

function archetypeIconUrl(archetype: string): string | undefined {
	return SPRITE_MANIFEST[`traits/${archetypeSpriteKey(archetype)}`];
}

// Both archetype bars, from one builder. The mark is the same — bar length is
// how many, the split is how many of those won — and only the thing being
// counted differs, so the two charts cannot drift apart in labelling, icon
// lookup or axis inset.
//
// The ten archetypes are a fixed, small set, so every one that appears fits on
// one chart. Typed against ChartBundleCore — both render identically for a user
// library and a tournament corpus.
//
// `title` is the in-chart ECharts title the panel-rendered categories set on
// the option itself (the laws and families charts do the same). Omitted by the
// tournament stats page, which heads each chart with an HTML h2 instead.
function archetypeWinLossOption(
	rows: WinLossRow[],
	title?: string,
): ChartOption {
	return winLossStackedOption({
		rows,
		label: formatArchetype,
		iconUrl: archetypeIconUrl,
		title,
	});
}

export function startingArchetypeWinLossOption(
	bundle: ChartBundleCore,
	title?: string,
): ChartOption {
	return archetypeWinLossOption(
		bundle.startingArchetypeWinRate.map((r) => ({
			key: r.archetype,
			games: r.games,
			wins: r.wins,
			rate: r.rate,
		})),
		title,
	);
}

// Starting traits have a long tail (~40 across a large corpus, most of them
// one-offs), so the chart keeps the traits with the most games behind them —
// the same cap the tech and law charts use to stay readable.
const MAX_TRAIT_ROWS = 15;

export function startingTraitWinLossOption(
	bundle: ChartBundleCore,
	title?: string,
): ChartOption {
	const rows = [...bundle.startingTraitWinRate]
		.sort((a, b) => b.games - a.games)
		.slice(0, MAX_TRAIT_ROWS)
		.map((r) => ({
			key: r.trait,
			games: r.games,
			wins: r.wins,
			rate: r.rate,
		}));
	return winLossStackedOption({
		rows,
		label: fmtTrait,
		// No icon resolver — these are name-only rows. `trait.xml` is the
		// authority through zIconName, and only 28 of its 306 records declare
		// art: the ten bArchetype archetypes (each pointing at the bare id,
		// which is what archetypeSpriteKey reproduces), seventeen
		// TRAIT_CLERGY_* pointing into the `religions` sprite category, and
		// TRAIT_PRESET_ARCHETYPE. The sprite manifest is not the authority
		// here — its `traits` category is baked from the art folder, so it also
		// carries HUD icons that aren't trait records at all (TRAIT_STRENGTH,
		// TRAIT_WEAKNESS: a trait's classification is bStrength/bWeakness on
		// the record) plus one DLC connection trait. None of those is a trait a
		// leader can start with, so a `traits/<trait>` lookup can only miss.
		//
		// Trait names run longer than nation names ("Compassionate"), so the
		// labels get more room than the shared default.
		labelWidth: 160,
		title,
	});
}

// Rows the trait chart actually draws — the registry sizes the container off
// the same cap, so the chart never scrolls past its box.
export function visibleTraitRowCount(bundle: ChartBundleCore): number {
	return Math.min(bundle.startingTraitWinRate.length, MAX_TRAIT_ROWS);
}

// --- Every leader, banded by accession -----------------------------
//
// Bar length is a number of leaders. The bands are a cut of that count by when
// each leader took the throne, and the default cut is all of them: the request
// asked for the archetypes of every leader in the game, and the turn bands
// were its hedged addition.

export const ALL_TURNS_KEY = "all";

interface LeaderBandSegment {
	key: string;
	label: string;
	band: LeaderArchetypeBand;
}

// "Turns 1–40" / "Turns 71+". An en dash, matching the range labels elsewhere
// in the catalog, and the open-ended band says so rather than inventing a
// ceiling the data doesn't have.
function leaderBandLabel(band: LeaderArchetypeBand): string {
	return band.to === null
		? `Turns ${band.from}+`
		: `Turns ${band.from}–${band.to}`;
}

// The All-turns cut: the bands added up. Every leader is in exactly one band —
// their accession turn puts them there — so the sum is the whole distribution.
// A fourth cut built in the Worker could disagree with its own parts; a sum
// cannot, which is why the bundle carries three bands and not four.
function allTurnsBand(bands: LeaderArchetypeBand[]): LeaderArchetypeBand {
	const tally = new Map<string, { leaders: number; wins: number }>();
	let leaders = 0;
	for (const b of bands) {
		leaders += b.leaders;
		for (const r of b.rows) {
			const t = tally.get(r.archetype) ?? { leaders: 0, wins: 0 };
			t.leaders += r.leaders;
			t.wins += r.wins;
			tally.set(r.archetype, t);
		}
	}
	return {
		from: bands[0].from,
		// Open-ended, because that is what "all turns" is. It also keeps this
		// cut's `games` equal to the denominator below, so the count label
		// prints no games line on the segment where every game qualifies.
		to: null,
		// Every game reaches the first band, so the first band's count is the
		// corpus — and the denominator the later bands' counts are read
		// against.
		games: bands[0].games,
		leaders,
		rows: [...tally.entries()].map(([archetype, t]) => ({
			archetype,
			leaders: t.leaders,
			wins: t.wins,
			rate: t.leaders > 0 ? t.wins / t.leaders : 0,
		})),
	};
}

// All turns first, and the panel's default: it is the question the request
// actually asked and has to read without anyone touching the switch. The bands
// follow in turn order, each keyed on its own first turn so a bundle cached
// before an edge moved keeps a selection that still means something.
export function leaderBandSegments(
	bands: LeaderArchetypeBand[],
): LeaderBandSegment[] {
	if (bands.length === 0) return [];
	return [
		{ key: ALL_TURNS_KEY, label: "All turns", band: allTurnsBand(bands) },
		...bands.map((b) => ({
			key: `${b.from}`,
			label: leaderBandLabel(b),
			band: b,
		})),
	];
}

// Leaders in the band whose archetype the save recorded — what the rows sum
// to, and so what the bars are drawn from.
function attributedLeaders(band: LeaderArchetypeBand): number {
	return band.rows.reduce((sum, r) => sum + r.leaders, 0);
}

// The count label the stats catalog puts above a panel's content
// (GameLengthPanel, RecordsPanel): how many leaders the bars are drawn from,
// plus the two things that number rests on, each printed only where it says
// something.
//
// Leaders carrying no archetype at all are 92 of the corpus's 742 — a child
// ruler has none, and a save old enough to write <Trait> instead of
// <TraitTurn> records none for anyone. The games denominator goes beside the
// count where some game failed to reach the band: every game reaches turn 1 by
// construction, and "116 of 116" reads as a caveat about nothing, which
// teaches a reader to skip the line on the band that has a real one.
export function leaderBandCountLabel(
	band: LeaderArchetypeBand,
	totalGames: number,
): string {
	const n = (v: number) => v.toLocaleString("en-US");
	const parts = [
		`${n(band.leaders)} ${band.leaders === 1 ? "Leader" : "Leaders"}`,
	];
	const unattributed = band.leaders - attributedLeaders(band);
	if (unattributed > 0) {
		parts.push(`${n(unattributed)} with no recorded archetype`);
	}
	if (band.games < totalGames) {
		parts.push(
			band.to === null
				? `${n(band.games)} of ${n(totalGames)} games reach turn ${band.from}`
				: `${n(band.games)} of ${n(totalGames)} games reach these turns`,
		);
	}
	return parts.join(" · ");
}

// Four reasons this chart can have no bars, and they are four different
// claims — so each gets its own sentence rather than the shortest one standing
// in for the rest. One message for all of them told a reader whose corpus is
// simply too old that their games were too short, and on a database that had
// only just been migrated it said that about turns 1-40.
export function leaderBandEmptyMessage(
	band: LeaderArchetypeBand,
	corpusHasLeaders: boolean,
): string {
	// No rows anywhere: a library of blobs indexed before the table existed, or
	// a database that has only just been migrated.
	if (!corpusHasLeaders) return "No leader data available.";
	if (band.games === 0) return "No games in the corpus reach these turns.";
	if (band.leaders === 0) return "No leader took the throne in these turns.";
	return "No leader who took the throne in these turns has a recorded archetype.";
}

export function leaderArchetypeOption(
	band: LeaderArchetypeBand,
	title?: string,
): ChartOption {
	return archetypeWinLossOption(
		band.rows.map((r) => ({
			key: r.archetype,
			games: r.leaders,
			wins: r.wins,
			rate: r.rate,
		})),
		title,
	);
}
