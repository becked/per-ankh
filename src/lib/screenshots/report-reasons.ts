// Why a viewer reported a screenshot (issue #289, step 6) — the vocabulary
// both sides of the wire need, for the reason limits.ts and stored-variant.ts
// exist: the Worker's valibot schema validates against this list, the
// reporter's radio group renders its labels, and the admin queue renders the
// same labels beside the classifier's own numbers. Three readers of one list.
//
// The ids mirror the classifier's questions (cloud/src/screenshots/clef.ts)
// wherever a question exists for them, because a report is a claim that the
// classifier got that question wrong on this image — `not_old_world` against
// `is_old_world`, `sexual_content` against `contains_nsfw`, `graphic_violence`
// against `contains_gore`, `real_person` against `is_a_photograph`. That makes
// a report directly comparable to the probabilities stored on the row, which
// is what the queue puts side by side.
//
// Two of them have no question behind them and are here anyway:
// `personal_information` is a real-world harm the gate cannot see (a stream
// overlay with an email in it is still an Old World screenshot), and `other`
// is the route for a viewer who cannot classify what is wrong. Neither is
// free text — the admin looks at the image, which is the actual evidence, and
// a free-text field on a moderation table is unbounded reporter content
// stored indefinitely.
export const SCREENSHOT_REPORT_REASONS = [
	"not_old_world",
	"sexual_content",
	"graphic_violence",
	"real_person",
	"personal_information",
	"other",
] as const;

export type ScreenshotReportReason = (typeof SCREENSHOT_REPORT_REASONS)[number];

// What a reporter picks from, and what the admin queue shows. Written as the
// claim being made rather than as a category name, because the reporter is
// choosing a sentence about the image in front of them.
//
// Not formatEnum(): these are app vocabulary with no baked name table and no
// game string behind them, and "Not old world" is not the sentence.
export const SCREENSHOT_REPORT_REASON_LABELS: Record<
	ScreenshotReportReason,
	string
> = {
	not_old_world: "Not an Old World screenshot",
	sexual_content: "Sexual content",
	graphic_violence: "Graphic violence",
	real_person: "A photograph of a real person",
	personal_information: "Someone's personal information",
	other: "Something else",
};

export function screenshotReportReasonLabel(reason: string): string {
	// A reason the client does not know is still rendered rather than dropped:
	// the row came from the Worker, and a label map that silently empties a
	// cell would hide a report from the queue. Only reachable across a deploy
	// where the Worker's list is ahead of the browser's.
	return (
		SCREENSHOT_REPORT_REASON_LABELS[reason as ScreenshotReportReason] ?? reason
	);
}
