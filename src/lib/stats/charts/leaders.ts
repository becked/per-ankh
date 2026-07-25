// Leaders tab option builders — how a starting leader's roll fared.
//
// Old World rolls each player's starting leader: one archetype and the
// personality traits they begin with. Both bars are the shared wins/losses
// stack, so bar length reads as the distribution ("how often did this come
// up") and the split as the outcome ("how often did it win").

import type { ChartOption } from "$lib/echarts";
import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
import type { ChartBundleCore } from "../types";
import { fmtArchetype, fmtTrait, winLossStackedOption } from "./helpers";

// Archetype glyphs ship under the archetype trait's name with the _ARCHETYPE
// suffix dropped (TRAIT_SCHEMER_ARCHETYPE → traits/TRAIT_SCHEMER), the same
// mapping the game-detail leader cards use.
function archetypeIconUrl(archetype: string): string | undefined {
	return SPRITE_MANIFEST[`traits/${archetype.replace(/_ARCHETYPE$/, "")}`];
}

// The ten archetypes are a fixed, small set, so every one that appears fits on
// one chart. Typed against ChartBundleCore — it renders identically for a user
// library and a tournament corpus.
export function startingArchetypeWinLossOption(
	bundle: ChartBundleCore,
): ChartOption {
	return winLossStackedOption({
		rows: bundle.startingArchetypeWinRate.map((r) => ({
			key: r.archetype,
			games: r.games,
			wins: r.wins,
			rate: r.rate,
		})),
		label: fmtArchetype,
		iconUrl: archetypeIconUrl,
	});
}

// Starting traits have a long tail (~40 across a large corpus, most of them
// one-offs), so the chart keeps the traits with the most games behind them —
// the same cap the tech and law charts use to stay readable. No sprite ships
// for personality traits, so these are name-only rows.
const MAX_TRAIT_ROWS = 15;

export function startingTraitWinLossOption(
	bundle: ChartBundleCore,
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
		// Trait names run longer than nation names ("Compassionate"), so the
		// labels get more room than the shared default.
		labelWidth: 160,
	});
}

// Rows the trait chart actually draws — the registry sizes the container off
// the same cap, so the chart never scrolls past its box.
export function visibleTraitRowCount(bundle: ChartBundleCore): number {
	return Math.min(bundle.startingTraitWinRate.length, MAX_TRAIT_ROWS);
}
