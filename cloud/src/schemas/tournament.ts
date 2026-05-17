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

// map_script is not nullable: match generation always assigns one for
// non-bye matches (assignMap throws on empty input), and the admin's only
// map-edit UI is for replacing it, not clearing it. Byes carry
// map_script=null because the bye row is INSERTed with null at round
// generation — there's no post-hoc clear path.
//
// Slot identity (slot_a_id, slot_b_id) is deliberately not patchable: the
// substitute-username flow (patchSlot.discord_username) covers the common
// "player X dropped, Y takes their seat" case, and we don't want to expose
// match-level slot swaps that leave the displaced slot without a make-up
// game.
export const PatchMatchMapSchema = v.object({
	map_script: v.optional(MapScriptSchema),
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
