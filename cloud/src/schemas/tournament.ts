// Valibot schemas for the tournament endpoints.
//
// Tournament creation is CLI-only (see scripts/admin/commands/tournament.ts);
// the API only exposes PATCH for metadata edits and the various
// slot/round/match endpoints below.

import * as v from "valibot";

const slugRegex = /^[a-z0-9][a-z0-9-]{0,63}$/;
const nanoid21Regex = /^[A-Za-z0-9_-]{21}$/;
const ianaTimezoneIshRegex = /^[A-Za-z0-9_./+-]{1,64}$/;

const DivisionSchema = v.picklist(["A", "B"]);

const DiscordUsernameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1, "discord_username cannot be empty"),
	v.maxLength(64),
	// Discord usernames are lowercased alphanumerics + . _ as of the 2023
	// migration. We're permissive here — the canonical form is whatever the
	// admin types, which we lowercase before storing.
	v.toLowerCase(),
);

const MapScriptSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1),
	v.maxLength(128),
);

export const PatchTournamentSchema = v.object({
	name: v.optional(
		v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
	),
	description: v.optional(v.pipe(v.string(), v.maxLength(2000))),
	division_a_name: v.optional(
		v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64)),
	),
	division_b_name: v.optional(
		v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64)),
	),
	swiss_advance_count: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(64)),
	),
	swiss_wins_to_advance: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20)),
	),
	swiss_losses_to_eliminate: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20)),
	),
	swiss_max_rounds: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20)),
	),
	allowed_map_scripts: v.optional(
		v.pipe(
			v.array(MapScriptSchema),
			v.minLength(1, "allowed_map_scripts must be non-empty"),
			v.maxLength(64),
		),
	),
});

export const BulkCreateSlotsSchema = v.pipe(
	v.array(
		v.object({
			division: DivisionSchema,
			discord_username: DiscordUsernameSchema,
			swiss_seed: v.optional(
				v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000)),
			),
		}),
	),
	v.minLength(1, "Must include at least one slot"),
	v.maxLength(200, "Too many slots"),
);

export const PatchSlotSchema = v.object({
	discord_username: v.optional(DiscordUsernameSchema),
	division: v.optional(DivisionSchema),
	swiss_seed: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000)),
	),
});

export const GenerateRoundSchema = v.object({
	// Optional — handler infers the next round if not provided. Phase always
	// matches the tournament's current status. Division is required for swiss,
	// ignored for championship.
	division: v.optional(DivisionSchema),
});

export const PatchPairingSchema = v.object({
	slot_a_id: v.optional(v.pipe(v.string(), v.regex(nanoid21Regex))),
	slot_b_id: v.optional(v.nullable(v.pipe(v.string(), v.regex(nanoid21Regex)))),
	map_script: v.optional(MapScriptSchema),
	pick_order_winner_slot_id: v.optional(
		v.nullable(v.pipe(v.string(), v.regex(nanoid21Regex))),
	),
});

export const ReportMatchSchema = v.object({
	winner_slot_id: v.pipe(v.string(), v.regex(nanoid21Regex)),
	game_id: v.optional(v.nullable(v.pipe(v.string(), v.regex(nanoid21Regex)))),
	status: v.optional(v.picklist(["reported", "forfeit"])),
	notes: v.optional(v.pipe(v.string(), v.maxLength(2000))),
});

export const PatchMatchSchema = v.object({
	winner_slot_id: v.optional(
		v.nullable(v.pipe(v.string(), v.regex(nanoid21Regex))),
	),
	status: v.optional(v.picklist(["pending", "reported", "forfeit", "bye"])),
	game_id: v.optional(v.nullable(v.pipe(v.string(), v.regex(nanoid21Regex)))),
	notes: v.optional(v.pipe(v.string(), v.maxLength(2000))),
});

// Optional override body for /transition-championship. If admin provides
// explicit ranking, the handler uses it instead of the cascade. Used to
// resolve ties that the wins → MB → Solkoff cascade can't.
export const TransitionChampionshipSchema = v.object({
	override_ranks: v.optional(
		v.object({
			A: v.array(v.pipe(v.string(), v.regex(nanoid21Regex))),
			B: v.array(v.pipe(v.string(), v.regex(nanoid21Regex))),
		}),
	),
});

// Used by the user-facing dismiss-banner endpoint. Slug-or-id in path; no body.
export { slugRegex, nanoid21Regex, ianaTimezoneIshRegex };
