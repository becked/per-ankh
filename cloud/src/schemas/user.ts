// Valibot schema for the cloud-rewrite /v1/auth/settings endpoint.

import * as v from "valibot";

import { StreamUrlSchema } from "./tournament";

// User-editable account preferences. Every field is optional so a caller
// updates only what it sends (see handleSettings in cloud/src/auth.ts):
//   - default_game_public: visibility applied to newly uploaded saves (the
//     fresh-upload branch in cloud/src/games.ts).
//   - stream_url: the user's casting stream link (twitch/youtube, same
//     allowlist as match-part streams). Auto-attached when they take the
//     streamer slot on a match part; null clears it (no auto-attach).
export const UserSettingsSchema = v.object({
	default_game_public: v.optional(v.boolean()),
	stream_url: v.optional(v.nullable(StreamUrlSchema)),
});

export type UserSettings = v.InferOutput<typeof UserSettingsSchema>;
