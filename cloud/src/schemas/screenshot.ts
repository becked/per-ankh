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
import { SCREENSHOT_REPORT_REASONS } from "../../../src/lib/screenshots/report-reasons";

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

// POST /v1/games/:id/screenshots/:screenshot_id/report — a viewer's report.
//
// A reason from the shared list rather than free text, so the value is
// comparable to the classifier's own questions and the admin queue can render
// it from a label map (src/lib/screenshots/report-reasons.ts says why). The
// reporter's identity comes from the session, not the body.
export const ReportScreenshotSchema = v.object({
	reason: v.picklist(SCREENSHOT_REPORT_REASONS),
});

// The admin actions on one screenshot. The whole moderation vocabulary, which
// is what makes a closed picklist right rather than five routes: `hide` and
// `unhide` are not symmetric (a hide deletes the object, so only a
// classifier-queued row can be put back), and the handler has to say so in
// one place.
//
//   hide             the terminal decision: hidden_at + hidden_by, the object
//                    deleted, both URLs purged, open reports resolved, and
//                    the home-strip star cleared.
//   unhide           approve what the classifier queued. Refused once an
//                    admin has hidden the row, because the bytes are gone.
//   star / unstar    the home strip's curation (step 7 renders it).
//   resolve_reports   the reports were looked at and the image stays up.
export const SCREENSHOT_MODERATION_ACTIONS = [
	"hide",
	"unhide",
	"star",
	"unstar",
	"resolve_reports",
] as const;

export type ScreenshotModerationAction =
	(typeof SCREENSHOT_MODERATION_ACTIONS)[number];

export const ModerateScreenshotSchema = v.object({
	action: v.picklist(SCREENSHOT_MODERATION_ACTIONS),
});
