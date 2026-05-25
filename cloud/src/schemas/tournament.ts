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

// Opaque instance id for a map_pool entry. The migration seeds 16-hex ids;
// the handler assigns nanoid-shaped ids to new entries. Both fit this regex.
const mapPoolIdRegex = /^[A-Za-z0-9_-]{1,32}$/;

// Strict schema: only accepts canonical MAPCLASS_MapScript<Name> identifiers
// known to the SvelteKit lookup table. Used for each map_pool entry's script
// so the pool can never contain a value that mapScriptLabel will fall back to
// formatMapClass for (which produced ugly "A R I D _ P L A T E A U" output
// before this gate existed).
const StrictMapScriptSchema = v.pipe(
	v.string(),
	v.trim(),
	v.check(
		(s) => CANONICAL_MAP_SCRIPTS_SET.has(s),
		"map_script must be a canonical MAPCLASS_MapScript<Name> identifier",
	),
);

// Shape-only schema for a single entry's options. Keys are MAP_OPTIONS_* /
// synthetic option zTypes; values are a string (select choice) or boolean
// (toggle). Semantic validation (option ∈ script's applicable set, value ∈
// option's choices) happens in the handler (validateInstanceOptions in
// admin.ts) since v.record can't express "value type depends on key" cleanly.
const MapScriptOptionValueSchema = v.union([v.string(), v.boolean()]);
const PerScriptOptionsSchema = v.record(v.string(), MapScriptOptionValueSchema);

// A map_pool entry: an instance of a script with its own options. The same
// script may appear in multiple entries (e.g. Continent @ Duel and
// Continent @ Tiny). `id` is optional on input — the handler assigns one to
// any entry that arrives without it (new entries from the maps panel).
const MapPoolEntrySchema = v.object({
	id: v.optional(v.pipe(v.string(), v.regex(mapPoolIdRegex))),
	script: StrictMapScriptSchema,
	options: v.optional(PerScriptOptionsSchema),
});

// Constraint shared by Create + Patch: 0–64 entries. Empty is intentionally
// allowed — the public create modal asks for name + description only, and the
// maps panel must be able to clear the pool back to empty while still in
// setup. Non-emptiness is enforced at the gate that actually needs it: the
// setup → swiss FSM transition (handleStartTournament) rejects an empty pool
// with MAP_CONFIG_EMPTY before any match generation. Patch edits to this field
// are locked to status='setup' in the handler. (The admin CLI does its own
// equivalent local validation; it doesn't use this schema.)
const MapPoolSchema = v.pipe(v.array(MapPoolEntrySchema), v.maxLength(64));

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
	map_pool: v.optional(MapPoolSchema),
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
	swiss_wins_to_advance: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20)),
	),
	swiss_losses_to_eliminate: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20)),
	),
	swiss_max_rounds: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20)),
	),
	map_pool: v.optional(MapPoolSchema),
	signups_open: v.optional(v.boolean()),
	// Admin-announced start time. Full ISO-8601 instant (the settings form
	// sends new Date(local).toISOString()); displayed date-only. `null` clears
	// a previously-set date. Only meaningful in setup/sign-ups but harmless to
	// edit later, so it's not gated by the post-start lock.
	starts_at: v.optional(v.nullable(v.pipe(v.string(), v.isoTimestamp()))),
});

// Body for POST /v1/tournaments/:id/signup. The caller must be signed in
// (the user_id and discord identity come from the session, not the body) —
// the only thing the player picks is which division to enter.
export const TournamentSignupSchema = v.object({
	division: DivisionSchema,
});

export const BulkCreateSlotsSchema = v.pipe(
	v.array(
		v.object({
			division: DivisionSchema,
			discord_username: DiscordUsernameSchema,
			swiss_seed: v.optional(
				v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000)),
			),
			// Optional pre-link via /v1/users/search autocomplete. When set,
			// the handler resolves the canonical discord_id + discord_username
			// from the users table (ignoring the body's discord_username) and
			// creates a slot that's "claimed" from the start — no OAuth-
			// callback dependency. nanoid21Regex matches the user_id shape;
			// the handler validates existence and rejects unknown IDs.
			user_id: v.optional(v.pipe(v.string(), v.regex(nanoid21Regex))),
		}),
	),
	v.minLength(1, "Must include at least one slot"),
	v.maxLength(200, "Too many slots"),
);

// Query schema for GET /v1/users/search. q must be at least 1 char to parse
// successfully; the handler enforces the practical "min 2 chars before we
// return matches" rule (returns empty for q.length < 2), keeping the
// validation surface and the autocomplete UX simple.
export const UserSearchQuerySchema = v.object({
	q: v.pipe(
		v.string(),
		v.trim(),
		v.toLowerCase(),
		v.minLength(1),
		v.maxLength(32),
	),
	limit: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20)),
	),
});

export const PatchSlotSchema = v.object({
	discord_username: v.optional(DiscordUsernameSchema),
	division: v.optional(DivisionSchema),
	swiss_seed: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000)),
	),
});

// Body for POST /v1/tournaments/:id/slots/reorder. Each division array is the
// desired display order; the server renumbers swiss_seed = 1..N within each
// division and reassigns division for any slot that moved across. The caller
// must include every swiss-phase slot exactly once across the two arrays —
// the handler rejects partial reorder payloads to avoid leaving orphan seeds.
export const ReorderSlotsSchema = v.object({
	divisions: v.object({
		A: v.pipe(
			v.array(v.pipe(v.string(), v.regex(nanoid21Regex))),
			v.maxLength(200),
		),
		B: v.pipe(
			v.array(v.pipe(v.string(), v.regex(nanoid21Regex))),
			v.maxLength(200),
		),
	}),
});

// The admin picks a map_pool instance for the match; the handler validates it
// against the tournament's pool and denormalizes its script onto the match.
// map_pool_id is not nullable: match generation always assigns one for non-bye
// matches (assignMap throws on an empty pool), and the admin's only map-edit UI
// is for replacing it, not clearing it. Byes carry map_pool_id=null because the
// bye row is INSERTed with null at round generation — there's no post-hoc clear
// path.
//
// Slot identity (slot_a_id, slot_b_id) is deliberately not patchable: the
// substitute-username flow (patchSlot.discord_username) covers the common
// "player X dropped, Y takes their seat" case, and we don't want to expose
// match-level slot swaps that leave the displaced slot without a make-up
// game.
export const PatchMatchMapSchema = v.object({
	map_pool_id: v.optional(v.pipe(v.string(), v.regex(mapPoolIdRegex))),
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

// Optional override body for /transition-championship. If provided, the
// handler uses this flat ordered list as the bracket seed order, bypassing
// the auto-promote-by-status logic entirely. The first slot becomes seed 1,
// the second seed 2, etc.
//
// Used to (a) resolve full-cascade ties at any seed, and (b) promote
// non-clinched slots in the underqualifier case (combined qualifier count
// from auto-promotion is < 2).
export const TransitionChampionshipSchema = v.object({
	override_ranks: v.optional(
		v.array(v.pipe(v.string(), v.regex(nanoid21Regex))),
	),
});

// Used by the user-facing dismiss-banner endpoint. Slug-or-id in path; no body.
export { slugRegex, nanoid21Regex, ianaTimezoneIshRegex };
