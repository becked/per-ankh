// Valibot schemas for the Explore query endpoints.

import * as v from "valibot";

// The ceiling is shared with the ask input's own maxlength, so it lives in a
// module both sides read, as the screenshot caption's does.
import { ASK_QUESTION_MAX } from "../../../src/lib/query/limits";

// POST /v1/query/ask — one question in plain language.
export const AskQuestionSchema = v.object({
	question: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(1, "Ask a question"),
		v.maxLength(
			ASK_QUESTION_MAX,
			`A question must be ${ASK_QUESTION_MAX} characters or fewer`,
		),
	),
});
