// Shared helpers for the stats chart option builders. Reuses the
// existing chart-theme constants from $lib/config.

import { CHART_THEME } from "$lib/config";
import { formatEnum } from "$lib/utils/formatting";

// Strip leaderless enum prefix for axis labels. The stats SQL returns
// raw values (NATION_PERSIA, ARCHETYPE_BUILDER, etc.); the chart axes
// need humanized text.
export function fmtNation(value: string): string {
	return formatEnum(value, "NATION_");
}
export function fmtArchetype(value: string): string {
	return formatEnum(value, "ARCHETYPE_");
}
export function fmtTrait(value: string): string {
	return formatEnum(value, "TRAIT_");
}
export function fmtClass(value: string): string {
	// Stored values are FAMILYCLASS_* (e.g. FAMILYCLASS_CHAMPIONS).
	return formatEnum(value, "FAMILYCLASS_");
}
export function fmtTech(value: string): string {
	return formatEnum(value, "TECH_");
}
export function fmtLaw(value: string): string {
	return formatEnum(value, "LAW_");
}

// Sentinel selector value for the cross-nation aggregate ("All nations")
// option shared by the nation-selector panels (Families, Opening laws). Not a
// real NATION_* enum, so it never collides with one.
export const ALL_NATIONS = "__all__";
export function nationLabel(value: string): string {
	return value === ALL_NATIONS ? "All nations" : fmtNation(value);
}

// Common option fragments. Each chart starts from CHART_THEME and
// overrides as needed; small helpers cut repetition for the most
// common patterns.
export const COMMON_GRID = { left: 60, right: 30, top: 40, bottom: 60 };

// Axis-title placement, mirroring the game-detail charts: the title sits
// centered along the axis (x below it, y reading vertically beside it)
// rather than ECharts' default corner placement. Spread alongside `name`.
export const AXIS_NAME_X = { nameLocation: "middle", nameGap: 30 } as const;
export const AXIS_NAME_Y = { nameLocation: "middle", nameGap: 40 } as const;

// Left-aligned category axisLabel that renders each value as its crest icon
// followed by its display name (name only when there's no crest). Spread
// into a category axis's `axisLabel`; the axis `data` must be the raw values
// (not pre-formatted). `crestUrl` maps a raw value to its sprite URL;
// `margin` left-aligns the labels at the grid's left edge (set ≈ grid.left).
// Shared by the nations and families charts.
export function crestAxisLabel(
	values: string[],
	crestUrl: (value: string) => string | undefined,
	name: (value: string) => string,
	margin: number,
	size = 16,
	fontSize?: number,
) {
	const key = (v: string) => v.replace(/^[A-Z]+_/, "").toLowerCase();
	const rich: Record<string, object> = {};
	for (const v of values) {
		const url = crestUrl(v);
		if (url)
			rich[key(v)] = {
				height: size,
				width: size,
				backgroundColor: { image: url },
			};
	}
	return {
		interval: 0,
		align: "left" as const,
		margin,
		// `fontSize` styles the name text (the rich `{crest|}` tag only sizes the
		// icon); color comes from the chart theme's white axis-label default.
		...(fontSize != null ? { fontSize } : {}),
		formatter: (value: string) =>
			crestUrl(value) ? `{${key(value)}|} ${name(value)}` : name(value),
		rich,
	};
}

export { CHART_THEME };
