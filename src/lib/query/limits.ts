// Explore limits that both sides of the wire need.
//
// The Worker refuses a longer question with a 400 (cloud/src/query/handlers.ts),
// and the ask input on /stats/explore uses the same number as its `maxlength`.
// It lives here for the reason src/lib/screenshots/limits.ts does: a number two
// modules agree on by hand drifts.

// A question is one sentence. A few hundred characters leaves room for a long
// tournament name and two player names.
export const ASK_QUESTION_MAX = 300;
