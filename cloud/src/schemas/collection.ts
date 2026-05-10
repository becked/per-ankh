// Valibot schema for the cloud-rewrite /v1/collections endpoints.

import * as v from "valibot";

export const COLLECTION_NAME_MAX = 64;

export const CreateCollectionSchema = v.object({
	name: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(1, "Name cannot be empty"),
		v.maxLength(COLLECTION_NAME_MAX, "Name too long"),
	),
});

export type CreateCollection = v.InferOutput<typeof CreateCollectionSchema>;
