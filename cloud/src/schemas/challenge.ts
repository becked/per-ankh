// Valibot schemas for the challenge endpoints. The objective/criterion
// vocabulary is the scorer's (challenges/types.ts, §3.2/§3.3 of the design);
// the handler stores exactly what validates here, so an unknown kind is
// refused at the door and a key a kind doesn't carry (a deadline on a
// snapshot objective) is dropped by v.object, as every schema in this
// directory drops unknown keys.

import * as v from "valibot";
import { ANY_WONDER, SCALAR_METRICS } from "../challenges/types";
import { WONDER_CULTURE_PREREQ } from "../generated/wonders";

const zType = (prefix: string) =>
	v.pipe(v.string(), v.regex(new RegExp(`^${prefix}[A-Z0-9_]{1,80}$`)));
const turn = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000));
const count = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(500));
const countByKey = (prefix: string) =>
	v.pipe(
		v.record(zType(prefix), count),
		v.check((r) => Object.keys(r).length <= 20),
	);

const ObjectiveSchema = v.variant("kind", [
	v.object({
		kind: v.literal("tech"),
		target: zType("TECH_"),
		by_turn: v.optional(turn),
	}),
	v.pipe(
		v.object({
			kind: v.literal("build"),
			target: v.union([zType("IMPROVEMENT_"), v.literal(ANY_WONDER)]),
			state: v.optional(v.picklist(["completed", "started"])),
			count: v.optional(count),
			by_turn: v.optional(turn),
		}),
		// Only a completed wonder is dated (the WONDER_ACTIVITY log); the save
		// never records when a tile was improved or a build began, so a
		// deadline anywhere else would be advertised and unenforceable.
		v.check(
			(o) =>
				o.by_turn == null ||
				(o.state !== "started" &&
					(o.target === ANY_WONDER || o.target in WONDER_CULTURE_PREREQ)),
			"by_turn only applies to a completed wonder",
		),
	),
	v.object({
		kind: v.literal("unit"),
		target: zType("UNIT_"),
		count: v.optional(count),
	}),
	v.pipe(
		v.object({
			kind: v.literal("army"),
			count,
			types: v.optional(
				v.pipe(v.array(zType("UNIT_")), v.minLength(1), v.maxLength(20)),
			),
			min_strength: v.optional(
				v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(30)),
			),
			unique_only: v.optional(v.boolean()),
			land_only: v.optional(v.boolean()),
			min_types: v.optional(count),
			min_per_type: v.optional(count),
			trained_only: v.optional(v.boolean()),
		}),
		// min_per_type only qualifies which types count toward min_types; on
		// its own it would be stored and never read.
		v.check(
			(o) => o.min_per_type == null || o.min_types != null,
			"min_per_type needs min_types",
		),
	),
	v.object({
		kind: v.literal("city"),
		count: v.optional(count),
		culture: v.optional(zType("CULTURE_")),
		capital: v.optional(v.boolean()),
		min_happiness: v.optional(
			v.pipe(v.number(), v.integer(), v.minValue(-10), v.maxValue(10)),
		),
		improvements: v.optional(countByKey("IMPROVEMENT_")),
		specialists: v.optional(countByKey("SPECIALIST_")),
	}),
	v.object({
		kind: v.literal("capture"),
		capital: v.optional(v.boolean()),
		count: v.optional(count),
		by_turn: v.optional(turn),
	}),
	v.object({
		kind: v.literal("religion"),
		target: v.union([zType("RELIGION_"), v.literal("ANY")]),
		state_religion: v.optional(v.boolean()),
		min_theology_tier: v.optional(
			v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3)),
		),
		by_turn: v.optional(turn),
	}),
	v.object({ kind: v.literal("cognomen"), target: zType("COGNOMEN_") }),
	v.object({
		kind: v.literal("metric"),
		metric: v.union([zType("YIELD_"), v.picklist([...SCALAR_METRICS])]),
		measure: v.optional(v.picklist(["rate", "cumulative"])),
		value: v.pipe(v.number(), v.minValue(1), v.maxValue(10_000_000)),
		by_turn: v.optional(turn),
	}),
	v.object({ kind: v.literal("victory"), by_turn: v.optional(turn) }),
]);

const CriterionSchema = v.variant("kind", [
	v.object({
		kind: v.literal("families"),
		min_opinion: v.pipe(
			v.number(),
			v.integer(),
			v.minValue(-1000),
			v.maxValue(1000),
		),
		scope: v.picklist(["seated", "all"]),
		count: v.optional(
			v.object({
				min: v.optional(
					v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(4)),
				),
				max: v.optional(
					v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(4)),
				),
			}),
		),
	}),
	v.object({
		kind: v.literal("cities"),
		scope: v.picklist(["founded", "all"]),
	}),
	v.object({
		kind: v.literal("leader"),
		standard_traits_only: v.boolean(),
		required_traits: v.optional(
			v.pipe(v.array(zType("TRAIT_")), v.maxLength(10)),
		),
	}),
	v.object({
		kind: v.literal("economy"),
		min_rates: v.pipe(
			v.record(
				zType("YIELD_"),
				v.pipe(v.number(), v.minValue(-100_000), v.maxValue(100_000)),
			),
			v.check((r) => Object.keys(r).length >= 1 && Object.keys(r).length <= 20),
		),
	}),
	v.object({ kind: v.literal("max_cities"), n: count }),
]);

const RulesFields = {
	title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
	description: v.optional(v.pipe(v.string(), v.maxLength(4000))),
	// Days from creation; the handler turns it into closes_at.
	duration_days: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365)),
	),
	objectives: v.pipe(v.array(ObjectiveSchema), v.minLength(1), v.maxLength(20)),
	criteria: v.pipe(
		v.array(CriterionSchema),
		v.maxLength(10),
		v.check(
			(cs) => new Set(cs.map((c) => c.kind)).size === cs.length,
			"each criterion kind at most once",
		),
	),
};

// The `meta` part of the multipart create request (alongside `data` — the
// gzipped parsed blob — and `save`, the map ZIP).
export const CreateChallengeSchema = v.object(RulesFields);

// PATCH body: title/description/duration always editable; objectives and
// criteria only while the challenge has no submission (handler-enforced).
export const PatchChallengeSchema = v.pipe(
	v.partial(v.object(RulesFields)),
	v.check((b) => Object.keys(b).length > 0, "no fields to update"),
);

export type CreateChallengeInput = v.InferOutput<typeof CreateChallengeSchema>;
export type PatchChallengeInput = v.InferOutput<typeof PatchChallengeSchema>;
