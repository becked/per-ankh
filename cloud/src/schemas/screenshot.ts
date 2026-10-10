// Valibot schemas for the screenshot endpoints (issue #289).
//
// The image itself is not described here — it arrives as multipart bytes and
// is validated from its own header (screenshots/webp.ts) and by the
// classifier, neither of which a schema can express.

import * as v from "valibot";

// The ceiling is shared with the caption input's own maxlength, so it lives
// in one module both sides read (src/lib/screenshots/limits.ts) — the shape
// cloud/src/games.ts and screenshots/handlers.ts already use for code the
// browser and the Worker both need.
import { SCREENSHOT_CAPTION_MAX } from "../../../src/lib/screenshots/limits";

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
