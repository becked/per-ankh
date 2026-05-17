// Valibot schemas for the tournament endpoints.

import * as v from "valibot";
import { CANONICAL_MAP_SCRIPTS_SET } from "../tournament/canonical-maps";

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

// Loose schema: shape-only check. Used for PatchMatchMapSchema, where the
// value is also intersected against the tournament's allowed_map_scripts
// at the handler layer — that effectively enforces canonical-ness for any
// new write, since allowed_map_scripts itself flows through StrictMapScriptSchema.
const MapScriptSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1),
	v.maxLength(128),
);

// Strict schema: only accepts canonical MAPCLASS_MapScript<Name> identifiers
// known to the SvelteKit lookup table. Used for create + patch of
// tournaments.allowed_map_scripts so the array can never contain a value
// that mapScriptLabel will fall back to formatMapClass for (which produced
// ugly "A R I D _ P L A T E A U" output before this gate existed).
const StrictMapScriptSchema = v.pipe(
	v.string(),
	v.trim(),
	v.check(
		(s) => CANONICAL_MAP_SCRIPTS_SET.has(s),
		"map_script must be a canonical MAPCLASS_MapScript<Name> identifier",
	),
);

// Constraint shared by Create + Patch (and reused by the admin CLI's
// equivalent local validation). 1–64 entries, each canonical.
const AllowedMapScriptsSchema = v.pipe(
	v.array(StrictMapScriptSchema),
	v.minLength(1, "allowed_map_scripts must be non-empty"),
	v.maxLength(64),
);

export const CreateTournamentSchema = v.object({
	// Optional. When absent, the handler derives a slug from `name` and
	// disambiguates collisions with a short random suffix. The admin CLI
	// passes an explicit slug; the public UI doesn't.
	slug: v.optional(
		v.pipe(
			v.string(),
			v.trim(),
			v.regex(slugRegex, "slug must match /^[a-z0-9][a-z0-9-]{0,63}$/"),
		),
	),
	name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
	description: v.optional(v.pipe(v.string(), v.maxLength(2000))),
	division_a_name: v.optional(
		v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64)),
	),
	division_b_name: v.optional(
		v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64)),
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
	allowed_map_scripts: AllowedMapScriptsSchema,
});

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
	allowed_map_scripts: v.optional(AllowedMapScriptsSchema),
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
	status: v.optional(v.picklist(["complete", "forfeit"])),
	notes: v.optional(v.pipe(v.string(), v.maxLength(2000))),
});

export const PatchMatchSchema = v.object({
	winner_slot_id: v.optional(
		v.nullable(v.pipe(v.string(), v.regex(nanoid21Regex))),
	),
	status: v.optional(v.picklist(["pending", "complete", "forfeit", "bye"])),
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
