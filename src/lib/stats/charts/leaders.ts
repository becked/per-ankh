// Leaders tab option builders — who sat the throne, and how they fared.
//
// Two of the three charts read the STARTING leader, whose archetype and
// personality traits Old World rolls at game start. The third reads every
// reign, banded by turn, because the starting leader holds under half the
// throne-time and so answers a narrower question than the chart beside it
// looks like it answers (cloud/src/stats/leader-reigns.ts has the measurement).
//
// All three are the shared wins/losses stack, so bar length reads as the
// distribution ("how much of this came up") and the split as the outcome ("how
// often did it win") — the same shape, a different unit on the banded one.

import type { ChartOption } from "$lib/echarts";
import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
import { archetypeSpriteKey, formatArchetype } from "$lib/utils/formatting";
import type { ArchetypeThroneTimeBand, ChartBundleCore } from "../types";
import { fmtTrait, winLossStackedOption } from "./helpers";

// One empty state per chart, each naming the domain its panel is short of and
// referenced from the panel and the tournament page rather than retyped at
// each. The three charts read three separate sources — two player_summaries
// columns (starting_ruler_archetype, starting_ruler_traits) and the
// leader_reigns table — and go empty independently.
export const ARCHETYPE_EMPTY_MESSAGE = "No leader archetype data available.";
export const TRAIT_EMPTY_MESSAGE = "No leader trait data available.";
// Its own message, and not the archetype one: this chart goes empty for a
// reason that one can't — a corpus whose games all end before the band starts
// has leaders and archetypes aplenty, just none in the turns being asked about.
export const THRONE_TIME_EMPTY_MESSAGE =
	"No games in the corpus reach these turns.";

function archetypeIconUrl(archetype: string): string | undefined {
	return SPRITE_MANIFEST[`traits/${archetypeSpriteKey(archetype)}`];
}

// The ten archetypes are a fixed, small set, so every one that appears fits on
// one chart. Typed against ChartBundleCore — it renders identically for a user
// library and a tournament corpus.
//
// `title` is the in-chart ECharts title the panel-rendered categories set on
// the option itself (the laws and families charts do the same). Omitted by the
// tournament stats page, which heads each chart with an HTML h2 instead.
export function startingArchetypeWinLossOption(
	bundle: ChartBundleCore,
	title?: string,
): ChartOption {
	return winLossStackedOption({
		rows: bundle.startingArchetypeWinRate.map((r) => ({
			key: r.archetype,
			games: r.games,
			wins: r.wins,
			rate: r.rate,
		})),
		label: formatArchetype,
		iconUrl: archetypeIconUrl,
		title,
	});
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

// --- Every reign, banded -------------------------------------------
//
// Bar length is leader-turns, not games, and the two are not interchangeable:
// a band is not single-valued per seat (a seat can hold three leaders inside
// turns 41-70), so counting reigns equally would let a two-turn leader weigh
// as much as a forty-turn one — the distortion this chart exists to remove.
// That makes the default tooltip wrong twice over ("Wins: 2100 / 4000" of
// what?), so both it and the bar label are replaced with copy that names the
// unit.

// "Turns 1–40" / "Turns 71+". An en dash, matching the range labels elsewhere
// in the catalog, and the open-ended band says so rather than inventing a
// ceiling the data doesn't have.
export function throneTimeBandLabel(band: ArchetypeThroneTimeBand): string {
	return band.to === null
		? `Turns ${band.from}+`
		: `Turns ${band.from}–${band.to}`;
}

// What the band's numbers rest on, in a line the panel renders beside the
// chart — the UNCERTAIN_NOTE idiom from TechsTab, where a caveat sits next to
// the value rather than in a chart subtitle (subtitles read as explanatory
// text and get removed again).
//
// Two caveats, both load-bearing and both only knowable from the band itself:
// how many games ran long enough to be in it at all (the last band is
// survivorship-selected — 81 of the local corpus's 116 games reach turn 71),
// and how much of its throne-time no archetype could be credited for. Returns
// null when the band is empty, where the empty state says more than a 0 would.
export function throneTimeBandNote(
	band: ArchetypeThroneTimeBand,
	totalGames: number,
): string | null {
	if (band.turns === 0) return null;
	const parts = [`${band.turns.toLocaleString()} leader-turns`];
	// Only where some game failed to reach the band. The opening band is every
	// game by construction, and "116 of 116" reads as a caveat about nothing —
	// which teaches a reader to skip the line on the band that has a real one.
	if (band.games < totalGames) {
		parts.push(
			band.to === null
				? `${band.games} of ${totalGames} games reach turn ${band.from}`
				: `${band.games} of ${totalGames} games reach these turns`,
		);
	}
	// Likewise: the share is of throne-time, not of reigns — the saves carrying
	// no archetype are the old ones, which are also the short ones, so the two
	// numbers differ.
	const unknown = Math.round((100 * band.unattributed_turns) / band.turns);
	if (unknown > 0) {
		parts.push(
			`${unknown}% under a leader whose archetype the save doesn't record`,
		);
	}
	return `${parts.join(" · ")}.`;
}

export function archetypeThroneTimeOption(
	band: ArchetypeThroneTimeBand,
	title?: string,
): ChartOption {
	// Shares are of ATTRIBUTED throne-time, so the rows add to 100%. Dividing
	// by band.turns instead would quietly subtract the unattributed share from
	// every row, and the note above is where that share is reported.
	const attributed = band.turns - band.unattributed_turns;
	return winLossStackedOption({
		rows: band.rows.map((r) => ({
			key: r.archetype,
			games: r.turns,
			wins: r.win_turns,
			rate: r.rate,
		})),
		label: formatArchetype,
		iconUrl: archetypeIconUrl,
		tooltipFormatter: (row) =>
			`${formatArchetype(row.key)}<br/>Turns held: ${row.games.toLocaleString()}` +
			` (${((100 * row.games) / attributed).toFixed(1)}% of the band)` +
			`<br/>Held by eventual winners: ${row.wins.toLocaleString()}` +
			` (${Math.round(row.rate * 100)}%)`,
		barLabel: (row) => `${((100 * row.games) / attributed).toFixed(1)}%`,
		title,
	});
}

// Rows the banded chart draws — the panel sizes its container off this, and an
// archetype nobody held in the band has no row rather than a zero-length bar.
export function throneTimeRowCount(band: ArchetypeThroneTimeBand): number {
	return band.rows.length;
}
