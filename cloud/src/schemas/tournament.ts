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
// with MAP_CONFIG_EMPTY before any match generation. In 'setup' the handler
// accepts arbitrary patch edits to this field; once the tournament has started
// it enforces append-only (existing instances frozen, new ones may be added).
// (The admin CLI does its own equivalent local validation; it doesn't use this
// schema.)
const MapPoolSchema = v.pipe(v.array(MapPoolEntrySchema), v.maxLength(64));

// A single external link in a tournament's "Links" menu: a display label and
// an http(s) URL. The label is what shows in the menu; the URL is rendered as
// an <a href> the public can click.
const LinkLabelSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1, "link label cannot be empty"),
	v.maxLength(80),
);
// SECURITY: v.url() alone is NOT enough — it just runs the URL constructor, and
// `new URL("javascript:alert(1)")` is a *valid* URL. Since these are rendered as
// hrefs, an unrestricted scheme is stored XSS. Pin the protocol to http(s). (The
// StreamUrlSchema below is safe only incidentally, via its host allowlist; a
// general link can't use one, so the scheme check is the load-bearing guard.)
const LinkUrlSchema = v.pipe(
	v.string(),
	v.trim(),
	v.maxLength(500),
	v.url("url must be a valid URL"),
	v.check((s) => {
		try {
			return ["https:", "http:"].includes(new URL(s).protocol);
		} catch {
			return false;
		}
	}, "url must be an http(s) link"),
);
const LinkSchema = v.object({ label: LinkLabelSchema, url: LinkUrlSchema });
// Capped to bound the stored blob. The whole list is replaced on each PATCH.
const LinksSchema = v.pipe(v.array(LinkSchema), v.maxLength(16));

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
	// Ordered list of external links shown in the tournament's "Links" menu.
	// Replaces the whole list on each PATCH (like map_pool). Not phase-locked —
	// editable in every status. See LinksSchema for the per-link rules.
	links: v.optional(LinksSchema),
	signups_open: v.optional(v.boolean()),
	// Admin-announced start time. Full ISO-8601 instant (the settings form
	// sends new Date(local).toISOString()); displayed date-only. `null` clears
	// a previously-set date. Only meaningful in setup/sign-ups but harmless to
	// edit later, so it's not gated by the post-start lock.
	starts_at: v.optional(v.nullable(v.pipe(v.string(), v.isoTimestamp()))),
	// Optional freeform prompt shown on the signup form (e.g. "what timezone /
	// time of day do you want to play?"). `null` (or empty, normalized to null
	// by the handler) clears it. Same nullable-clear pattern as description.
	signup_question: v.optional(
		v.nullable(v.pipe(v.string(), v.maxLength(2000))),
	),
});

// Body for POST /v1/tournaments/:id/signup. The caller must be signed in
// (the user_id and discord identity come from the session, not the body) —
// the only thing the player picks is which division to enter.
export const TournamentSignupSchema = v.object({
	division: DivisionSchema,
	// Answer to the tournament's optional signup_question. Always optional —
	// the question itself is optional, and even when set the answer isn't
	// required. Stored on the player's slot.
	signup_answer: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000))),
});

// Body for POST /v1/tournaments/:id/admins. The caller (an existing admin)
// names an existing Per-Ankh user by id; the autocomplete (/v1/users/search)
// supplies it. Identity is resolved server-side from the users table.
export const GrantAdminSchema = v.object({
	user_id: v.pipe(v.string(), v.regex(nanoid21Regex)),
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
	// Optional pre-link for a substitution via /v1/users/search autocomplete.
	// Mirrors BulkCreateSlotsSchema's field: when set, the handler resolves
	// the canonical discord_id + discord_username from the users table
	// (ignoring the body's discord_username) and links the slot to that user
	// immediately — no OAuth-callback claim needed. nanoid21Regex matches the
	// user_id shape; the handler validates existence and rejects unknown IDs.
	user_id: v.optional(v.pipe(v.string(), v.regex(nanoid21Regex))),
	// Admin edit of the player's answer to the tournament's optional signup
	// question. Same trim/length bound as TournamentSignupSchema; nullable to
	// clear (the handler also normalizes an empty string to null), mirroring
	// PatchTournamentSchema.signup_question.
	signup_answer: v.optional(
		v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000))),
	),
});

// Body for POST /v1/tournaments/:id/slots/reorder. Each division array is the
// desired display order; the server renumbers swiss_seed = 1..N within each
// division and reassigns division for any slot that moved across. The caller
// must include every swiss-phase slot exactly once across the two arrays —
// the handler rejects partial reorder payloads to avoid leaving orphan seeds.
// POST /v1/tournaments/:id/slots/swap body. Swaps the OCCUPANTS of two
// same-phase slots (identity moves; the seat — seed, division, match history —
// stays). The handler enforces that neither slot has any decided match, so a
// swap can never reattribute results.
export const SwapSlotsSchema = v.object({
	slot_a_id: v.pipe(v.string(), v.regex(nanoid21Regex)),
	slot_b_id: v.pipe(v.string(), v.regex(nanoid21Regex)),
});

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

// Allowed stream hosts for a scheduled match. Kept tight to the two platforms
// tournaments actually stream on; expand if a third appears.
const STREAM_HOSTS = new Set([
	"youtube.com",
	"www.youtube.com",
	"m.youtube.com",
	"youtu.be",
	"twitch.tv",
	"www.twitch.tv",
	"m.twitch.tv",
]);

// A stream URL for a part — a live stream or an after-the-fact recording, held to
// the same youtube/twitch host allowlist as the single stream link used before
// parts (migration 0025 → 0029).
const StreamUrlSchema = v.pipe(
	v.string(),
	v.trim(),
	v.maxLength(500),
	v.url("stream url must be a valid URL"),
	v.check((s) => {
		try {
			return STREAM_HOSTS.has(new URL(s).hostname.toLowerCase());
		} catch {
			return false;
		}
	}, "stream url must be a youtube.com or twitch.tv link"),
);

// One stream on a part: a stream/recording URL plus an optional human tag
// distinguishing it from the others ("alcaras POV", "Cast"). label omitted or
// blank → untagged.
const MatchPartStreamSchema = v.object({
	url: StreamUrlSchema,
	label: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(80)))),
});

// One caster on a part. Mirrors the slot-occupant model: user_id pre-links a
// Per-Ankh user (the handler snapshots that user's canonical username into name,
// ignoring any client-sent name), while name alone is free text. Casters are
// ordered — index 0 is the streamer, the rest co-casters.
// Single source for the per-part caster cap: the schema's maxLength and the
// caster self-service endpoints both read it.
export const MAX_CASTERS_PER_PART = 10;

const MatchPartCasterSchema = v.object({
	user_id: v.nullable(v.pipe(v.string(), v.regex(nanoid21Regex))),
	name: v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(80))),
});

// One part of a match: an optional scheduled instant, an ordered caster list
// (streamer first + co-casters), and a list of streams. id is stable within the
// match so edits/deletes target a part; a client may omit it when adding a new
// part (the handler mints one).
const MatchPartSchema = v.object({
	// A stable, URL-safe token (kept broader than the server-minted nanoid so a
	// client can echo an existing part's id) used to target a part for edit or
	// delete within the replace-all parts list.
	id: v.optional(v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,40}$/))),
	scheduled_at: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
	casters: v.pipe(
		v.array(MatchPartCasterSchema),
		v.maxLength(MAX_CASTERS_PER_PART),
	),
	streams: v.pipe(v.array(MatchPartStreamSchema), v.maxLength(20)),
});

// PATCH /v1/tournaments/:id/matches/:match_id/schedule body. Replace-all: the
// client sends the full ordered parts list, which the handler validates,
// resolves casters for, and writes over the match's `parts`. Capped so a single
// match can't accumulate an unbounded number of sittings.
export const PatchMatchPartsSchema = v.object({
	parts: v.pipe(v.array(MatchPartSchema), v.maxLength(30)),
	// The parts_rev the client's editor loaded. The handler rejects with 409
	// CONFLICT when the row has moved on, so a stale editor can't silently
	// erase a concurrent writer's changes. Omitted → last-write-wins (used by
	// tests and non-editor callers).
	expected_rev: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
});

// POST /v1/tournaments/:id/matches/:match_id/parts/:part_id/casters/me body.
// A caster adds/moves THEMSELVES on a part. role picks their slot: "streamer"
// takes index 0 (bumping the current streamer to co-caster); "cocaster"
// appends. Omitted → streamer when the part has no caster yet, else co-caster.
export const CastMatchPartSchema = v.object({
	role: v.optional(v.picklist(["streamer", "cocaster"])),
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
