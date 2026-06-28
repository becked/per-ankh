// Pure aggregation for the Specialists tab.
//
// Specialists live on ImprovementInfo — one row per placed specialist tile. The
// baked tables in src/lib/generated/specialists.ts supply each specialist's
// class, urban/rural kind and tier, and the set of specialist-eligible
// improvements (the coverage denominator). Everything here is a final-turn
// snapshot: in Old World specialists don't move and don't die, so the board as
// saved is the complete picture.

import type { ImprovementInfo } from "$lib/types/ImprovementInfo";
import {
	SPECIALISTS,
	SPECIALIST_CLASSES,
	ELIGIBLE_IMPROVEMENTS,
	type SpecialistInfo,
} from "$lib/generated/specialists";
import { formatEnum } from "$lib/utils/formatting";
import { ownedByPlayer, type DetailPlayer } from "./helpers";

export type SpecialistKind = "urban" | "rural";
export type KindFilter = "all" | SpecialistKind;

// Baked metadata for a placed specialist zType, or null when the tile has no
// specialist or carries an unknown zType (mod / pre-Reference data).
export function specialistInfo(zType: string | null): SpecialistInfo | null {
	if (!zType) return null;
	return SPECIALISTS[zType] ?? null;
}

// The class line name ("Priest"), falling back to the generic formatter.
export function classLabel(classKey: string): string {
	return (
		SPECIALIST_CLASSES[classKey]?.name ??
		formatEnum(classKey, "SPECIALISTCLASS_")
	);
}

// The level-distinct specialist name ("Elder Priest"), falling back to the
// generic formatter (which would drop the tier — only hit on unknown zTypes).
export function specialistName(zType: string): string {
	return SPECIALISTS[zType]?.name ?? formatEnum(zType, "SPECIALIST_");
}

function isEligibleImprovement(improvement: string): boolean {
	return ELIGIBLE_IMPROVEMENTS[improvement] !== undefined;
}

// Per-player headline metrics. `coverage` is the staffed share of the
// specialist-eligible improvements the player has built (null when they've built
// none); `avgUrbanLevel` is the mean tier across their urban specialists (null
// when they have none).
export type SpecialistSummary = {
	total: number;
	urban: number;
	rural: number;
	coverage: number | null;
	avgUrbanLevel: number | null;
};

export function summarizeForPlayer(
	improvements: ImprovementInfo[],
	player: DetailPlayer,
): SpecialistSummary {
	const owned = ownedByPlayer(
		improvements,
		player,
		(i) => i.owner_player_xml_id,
		(i) => i.nation,
	);

	let urban = 0;
	let rural = 0;
	let urbanLevelSum = 0;
	let eligibleBuilt = 0;
	let staffed = 0;

	for (const imp of owned) {
		if (isEligibleImprovement(imp.improvement)) {
			eligibleBuilt++;
			if (imp.specialist) staffed++;
		}
		const info = specialistInfo(imp.specialist);
		if (!info) continue;
		if (info.kind === "urban") {
			urban++;
			if (info.level != null) urbanLevelSum += info.level;
		} else {
			rural++;
		}
	}

	return {
		total: urban + rural,
		urban,
		rural,
		coverage: eligibleBuilt > 0 ? staffed / eligibleBuilt : null,
		avgUrbanLevel: urban > 0 ? urbanLevelSum / urban : null,
	};
}

// Specialist counts split into the four stacked-bar segments (rural + the three
// urban tiers) for one player — drives the breadth×depth composition chart.
export type LevelBreakdown = {
	rural: number;
	urban1: number;
	urban2: number;
	urban3: number;
};

export function levelBreakdownForPlayer(
	improvements: ImprovementInfo[],
	player: DetailPlayer,
): LevelBreakdown {
	const owned = ownedByPlayer(
		improvements,
		player,
		(i) => i.owner_player_xml_id,
		(i) => i.nation,
	);

	const out: LevelBreakdown = { rural: 0, urban1: 0, urban2: 0, urban3: 0 };
	for (const imp of owned) {
		const info = specialistInfo(imp.specialist);
		if (!info) continue;
		if (info.kind === "rural") out.rural++;
		else if (info.level === 1) out.urban1++;
		else if (info.level === 2) out.urban2++;
		else if (info.level === 3) out.urban3++;
	}
	return out;
}
