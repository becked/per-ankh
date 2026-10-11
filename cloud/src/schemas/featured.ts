// Valibot schemas for the two featured-videos writes: the site-admin set (POST
// /v1/admin/featured-videos) and a user's own (POST /v1/auth/featured-videos).
//
// The admin body below is a snapshot; the owner body at the bottom of the file
// is two fields naming a video, because that write takes its own snapshot.
//
// The body is a snapshot of the video the admin is looking at, sent straight
// from the card they clicked: a featured video outlives the feed it came from,
// so the fields YouTube owns travel with it (see migration 0041). Uploader
// identity does not — `user_id` names a Per-Ankh uploader, joined at read time,
// and uploader_name/uploader_url carry the unlinked-channel case.

import * as v from "valibot";
import { HttpUrlSchema } from "./tournament";
import { supportedPlatforms } from "../video/registry";

const nanoid21Regex = /^[A-Za-z0-9_-]{21}$/;

// Optional-and-nullable, defaulting to null: the three attribution fields and
// the thumbnail are each absent on some card shapes, and a caller that omits
// one means "no value" rather than "leave it alone" — the write is a whole-row
// upsert, not a patch.
const OptionalHttpUrl = v.optional(v.nullable(HttpUrlSchema), null);

export const FeatureVideoSchema = v.object({
	// Only platforms with a registered provider (cloud/src/video/registry.ts) —
	// the same set the channel endpoints resolve against, so a featured row can
	// always name a provider that knows the video.
	platform: v.picklist(supportedPlatforms()),
	// Provider-native video id (YouTube: the 11-char watch id).
	video_id: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(1, "video_id is required"),
		v.maxLength(64),
	),
	url: HttpUrlSchema,
	title: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(1, "title is required"),
		v.maxLength(500),
	),
	thumbnail_url: OptionalHttpUrl,
	// ISO 8601, as the feed normalized it (cloud/src/video/types.ts).
	published_at: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(1, "published_at is required"),
		v.maxLength(40),
	),
	user_id: v.optional(
		v.nullable(v.pipe(v.string(), v.regex(nanoid21Regex))),
		null,
	),
	uploader_name: v.optional(
		v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200))),
		null,
	),
	uploader_url: OptionalHttpUrl,
});

export type FeatureVideo = v.InferOutput<typeof FeatureVideoSchema>;

// Valibot schema for the owner-curated write (POST /v1/auth/featured-videos).
//
// Deliberately NOT a snapshot body, unlike the admin schema above: the two
// fields here name a video, and the Worker takes the snapshot itself from the
// user's own channel feeds (see handleFeatureMyVideo in channels.ts). The admin
// path can trust the card it was clicked from; this one renders on a public
// profile under the owner's name, so nothing a caller types reaches the row —
// a video that isn't in one of their linked channels is refused outright.
export const FeatureMyVideoSchema = v.object({
	platform: v.picklist(supportedPlatforms()),
	video_id: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(1, "video_id is required"),
		v.maxLength(64),
	),
});

export type FeatureMyVideo = v.InferOutput<typeof FeatureMyVideoSchema>;
