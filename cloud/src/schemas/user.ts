// Valibot schemas for the user's own account: the /v1/auth/settings
// preferences and the /v1/users/me/slug profile URL.

import * as v from "valibot";

import { StreamUrlSchema } from "./tournament";
import {
	normalizeUserSlug,
	RESERVED_USER_SLUGS,
	USER_SLUG_FORMAT_MESSAGE,
	USER_SLUG_RESERVED_MESSAGE,
	userSlugRegex,
} from "./user-slug";

// User-editable account preferences. Every field is optional so a caller
// updates only what it sends (see handleSettings in cloud/src/auth.ts):
//   - default_game_public: visibility applied to newly uploaded saves (the
//     fresh-upload branch in cloud/src/games.ts).
//   - stream_url: the user's casting stream link (twitch/youtube, same
//     allowlist as match-part streams). Auto-attached when they take the
//     streamer slot on a match part; null clears it (no auto-attach).
//   - open_to_matches: whether other players may be shown this user as a
//     suggested opponent (cloud/src/ratings/recommend.ts). Off removes them
//     from everyone's list; it does not stop them getting their own.
export const UserSettingsSchema = v.object({
	default_game_public: v.optional(v.boolean()),
	stream_url: v.optional(v.nullable(StreamUrlSchema)),
	open_to_matches: v.optional(v.boolean()),
});

export type UserSettings = v.InferOutput<typeof UserSettingsSchema>;

// The user slug — the <slug> in per-ankh.app/u/<slug>. The rule itself lives
// in ./user-slug, valibot-free, because the admin CLI and the login path's
// slugifier apply the same rule and can't import valibot; this is only the pipe
// that puts it on the wire. Normalization (trim → lowercase) runs BEFORE the
// rules, so a user may type mixed case and still claim the name they meant, and
// the rules see the value that would be stored. Two actions rather than one so
// each rejection carries its own message — the endpoint shows them to the user
// verbatim.
export const SlugSchema = v.pipe(
	v.string(),
	v.transform(normalizeUserSlug),
	v.regex(userSlugRegex, USER_SLUG_FORMAT_MESSAGE),
	v.check((slug) => !RESERVED_USER_SLUGS.has(slug), USER_SLUG_RESERVED_MESSAGE),
);

// The set request envelope. The field is a bare string here, validated
// against SlugSchema by the handler, so a malformed *body* (missing key, wrong
// type) and an invalid *slug* stay distinguishable on the wire — see
// handleSetSlug in cloud/src/users.ts. The release path (DELETE) has no body.
export const ClaimSlugSchema = v.object({
	slug: v.string(),
});
