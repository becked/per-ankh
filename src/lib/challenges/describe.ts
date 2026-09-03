// Challenge rules in words — the objective and criterion lines the create
// form, the challenge page, the upload preview and the game banner all
// render. One place, so "Build 2 Libraries by turn 40" reads the same
// everywhere. Names come from the baked reference tables the game-detail
// view already uses; formatEnum covers whatever isn't baked.

import { techName, improvementDisplayName } from "$lib/game-detail/helpers";
import { specialistName } from "$lib/game-detail/specialists";
import { DIFFICULTY_NAMES } from "$lib/generated/difficulty-names";
import { formatEnum, formatMapClass, nationName } from "$lib/utils/formatting";
import {
	ANY_RELIGION,
	ANY_WONDER,
	type ChallengeSetup,
	type Criterion,
	type Objective,
} from "./types";

/**
 * A unit's display name. The tribal units come in two tiers — `_1` is the
 * base unit, `_2` the one the game calls "Elite …" — and formatEnum drops the
 * trailing digit, so both would read the same without this.
 */
export function unitName(unit: string): string {
	const base = formatEnum(unit, "UNIT_");
	return /_2$/.test(unit) ? `Elite ${base}` : base;
}

/** A trait's display name; the game shows an archetype by its bare name. */
export function traitName(trait: string): string {
	return formatEnum(trait.replace(/_ARCHETYPE$/, ""), "TRAIT_");
}

function plural(n: number, noun: string, pluralNoun = `${noun}s`): string {
	return `${n} ${n === 1 ? noun : pluralNoun}`;
}

const byTurn = (turn: number | undefined): string =>
	turn === undefined ? "" : ` by turn ${turn}`;

function yieldLabel(metric: string): string {
	return metric.startsWith("YIELD_")
		? formatEnum(metric, "YIELD_")
		: formatEnum(metric, "");
}

// Counted-thing map: "Library ×2, Garrison ×1".
function countList(
	counts: Record<string, number>,
	name: (key: string) => string,
): string {
	return Object.entries(counts)
		.map(([k, n]) => (n === 1 ? name(k) : `${name(k)} ×${n}`))
		.join(", ");
}

export function describeObjective(o: Objective): string {
	switch (o.kind) {
		case "tech":
			return `Research ${techName(o.target)}${byTurn(o.by_turn)}`;
		case "build": {
			const verb = o.state === "started" ? "Start" : "Build";
			const count = o.count ?? 1;
			const what =
				o.target === ANY_WONDER
					? count === 1
						? "a wonder"
						: plural(count, "wonder")
					: count === 1
						? improvementDisplayName(o.target)
						: `${count}× ${improvementDisplayName(o.target)}`;
			return `${verb} ${what}${byTurn(o.by_turn)}`;
		}
		case "unit": {
			const count = o.count ?? 1;
			const name = unitName(o.target);
			return `Train ${count === 1 ? `a ${name}` : `${count}× ${name}`}`;
		}
		case "army": {
			const parts: string[] = [];
			if (o.min_strength !== undefined)
				parts.push(`strength ≥ ${o.min_strength}`);
			if (o.unique_only) parts.push("unique units only");
			if (o.land_only) parts.push("land units only");
			if (o.trained_only) parts.push("trained, not starting");
			// min_per_type says what makes a type count toward min_types, not
			// a floor on every type.
			if (o.min_types !== undefined)
				parts.push(
					`at least ${plural(o.min_types, "type")}${o.min_per_type !== undefined ? ` with ${o.min_per_type}+ each` : ""}`,
				);
			const what =
				o.types && o.types.length > 0
					? `${o.count}× ${o.types.map(unitName).join(" or ")}`
					: plural(o.count, "unit");
			return `Have ${what}${parts.length ? ` (${parts.join(", ")})` : ""}`;
		}
		case "city": {
			const count = o.count ?? 1;
			const parts: string[] = [];
			if (o.culture) parts.push(`${formatEnum(o.culture, "CULTURE_")} culture`);
			if (o.min_happiness !== undefined)
				parts.push(`happiness ≥ ${o.min_happiness}`);
			if (o.improvements)
				parts.push(`with ${countList(o.improvements, improvementDisplayName)}`);
			if (o.specialists)
				parts.push(`staffing ${countList(o.specialists, specialistName)}`);
			const subject = o.capital
				? "your capital"
				: count === 1
					? "a city"
					: plural(count, "city", "cities");
			return `Have ${subject}${parts.length ? ` — ${parts.join(", ")}` : ""}`;
		}
		case "capture": {
			const count = o.count ?? 1;
			const what = o.capital
				? "the enemy capital"
				: count === 1
					? "a city"
					: plural(count, "city", "cities");
			return `Capture ${what}${byTurn(o.by_turn)}`;
		}
		case "religion": {
			const name =
				o.target === ANY_RELIGION
					? "a religion"
					: formatEnum(o.target, "RELIGION_");
			const parts: string[] = [];
			if (o.state_religion) parts.push("adopt it as state religion");
			if (o.min_theology_tier !== undefined)
				parts.push(`reach theology tier ${o.min_theology_tier}`);
			return `Found ${name}${parts.length ? ` and ${parts.join(" and ")}` : ""}${byTurn(o.by_turn)}`;
		}
		case "cognomen":
			return `Earn the cognomen ${formatEnum(o.target, "COGNOMEN_")}`;
		case "metric": {
			const measure =
				o.measure === "cumulative"
					? "total"
					: o.metric.startsWith("YIELD_")
						? "per turn"
						: "";
			return `Reach ${o.value.toLocaleString()} ${yieldLabel(o.metric)}${measure ? ` ${measure}` : ""}${byTurn(o.by_turn)}`;
		}
		case "victory":
			return `Win the game${byTurn(o.by_turn)}`;
	}
}

export function describeCriterion(c: Criterion): string {
	switch (c.kind) {
		case "families": {
			const who = c.scope === "seated" ? "seated family" : "family";
			const count =
				c.count?.min !== undefined || c.count?.max !== undefined
					? ` (${[
							c.count.min !== undefined ? `at least ${c.count.min}` : null,
							c.count.max !== undefined ? `at most ${c.count.max}` : null,
						]
							.filter(Boolean)
							.join(", ")} families)`
					: "";
			return `No ${who} below ${c.min_opinion} opinion${count}`;
		}
		case "cities":
			return c.scope === "founded"
				? "No damaged cities you founded"
				: "No damaged cities";
		case "leader": {
			const parts: string[] = [];
			if (c.standard_traits_only)
				parts.push("no dynasty-unique traits on a custom leader");
			if (c.required_traits?.length)
				parts.push(
					`leader must have ${c.required_traits.map(traitName).join(", ")}`,
				);
			return parts.join("; ") || "Any leader";
		}
		case "economy":
			return `Positive economy: ${Object.entries(c.min_rates)
				.map(([y, n]) => `${yieldLabel(y)} ≥ ${n}`)
				.join(", ")}`;
		case "max_cities":
			return `At most ${plural(c.n, "city", "cities")}`;
	}
}

// "Rome · Romulus · Small Inland Sea · The Good · vs 1 AI" — the setup line.
export function describeSetup(s: ChallengeSetup): string[] {
	const parts: string[] = [];
	if (s.nation) parts.push(nationName(s.nation));
	if (s.leader_name)
		parts.push(
			s.leader_is_custom ? `${s.leader_name} (custom)` : s.leader_name,
		);
	const map = [
		s.map_size ? formatEnum(s.map_size, "MAPSIZE_") : null,
		s.map_class ? formatMapClass(s.map_class) : null,
	].filter(Boolean);
	if (map.length) parts.push(map.join(" "));
	if (s.difficulty)
		parts.push(
			DIFFICULTY_NAMES[s.difficulty] ?? formatEnum(s.difficulty, "DIFFICULTY_"),
		);
	parts.push(s.ai_count === 0 ? "no AI" : `vs ${plural(s.ai_count, "AI")}`);
	return parts;
}
