// Valibot schema for the cloud-rewrite /v1/auth/settings endpoint.

import * as v from "valibot";

// User-editable account preferences. Currently just the default visibility
// applied to newly uploaded saves (see handleSettings in cloud/src/auth.ts
// and the fresh-upload branch in cloud/src/games.ts).
export const UserSettingsSchema = v.object({
	default_game_public: v.boolean(),
});

export type UserSettings = v.InferOutput<typeof UserSettingsSchema>;
