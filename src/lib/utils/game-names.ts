// Display names for tech and improvement zTypes.
//
// Relative imports only, so the Worker can import this module across the
// package boundary, as og-card/card-svg.ts imports formatting.ts. The Worker
// has no `$lib` alias. The Explore ask endpoint labels its prompt's vocabulary
// lists through these, so the model reads each value under the name the
// builder's picker shows.
//
// Not in formatting.ts. That module is imported almost everywhere, and the
// three tables below would land in the eager chunk with it.

import { IMPROVEMENT_NAMES } from "../generated/improvement-names";
import { SHRINE_TYPE } from "../generated/science-yields";
import { TECH_NAMES } from "../generated/tech-names";
import { formatEnum } from "./formatting";

// Tech display name — the baked override, else the generic formatter. Shared by
// the Military rail and the Techs tab (comparison table + science rail).
export const techName = (tech: string): string =>
	TECH_NAMES[tech] ?? formatEnum(tech, "TECH_");

/**
 * Display name for an improvement zType: the baked IMPROVEMENT_NAMES
 * override (tiers, monasteries, shrine-of-X) with formatEnum as fallback,
 * plus a pagan shrine's domain appended: "Shrine of Nabu (Wisdom)".
 */
export function improvementDisplayName(zType: string): string {
	const named = IMPROVEMENT_NAMES[zType] ?? formatEnum(zType, "IMPROVEMENT_");
	const domain = SHRINE_TYPE[zType];
	return domain ? `${named} (${domain})` : named;
}
