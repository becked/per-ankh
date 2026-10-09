// Valibot schemas for the screenshot endpoints (issue #289).
//
// The image itself is not described here — it arrives as multipart bytes and
// is validated from its own header (screenshots/webp.ts) and by the
// classifier, neither of which a schema can express.

import * as v from "valibot";

// A caption is one line under a tile, not a description: long enough for
// "Turn 140, three cities on the Nile", short enough that the strip stays a
// row of images. Trimmed to empty counts as no caption, so the UI can send
// the field unconditionally.
export const SCREENSHOT_CAPTION_MAX = 200;

export const ScreenshotCaptionSchema = v.pipe(
	v.string(),
	v.trim(),
	v.maxLength(
		SCREENSHOT_CAPTION_MAX,
		`Caption must be ${SCREENSHOT_CAPTION_MAX} characters or fewer`,
	),
);

// The screenshot terms acceptance. An explicit affirmative in the body rather
// than an empty POST: this records that a person agreed to something, so the
// request carries the agreement instead of the route implying it.
export const AcceptScreenshotTermsSchema = v.object({
	accepted: v.literal(true),
});
