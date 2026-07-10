// Valibot schema for the self-service channel endpoints (POST
// /v1/auth/channels). The user pastes a channel URL or @handle; the Worker
// detects the platform and resolves it against the provider registry (see
// cloud/src/video/). We only bound the raw string here — platform recognition
// and resolution are the handler's job.

import * as v from "valibot";

export const AddChannelSchema = v.object({
	url: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(1, "channel url is required"),
		v.maxLength(500),
	),
});

export type AddChannel = v.InferOutput<typeof AddChannelSchema>;
