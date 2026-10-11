// Shared "which screenshots count" predicates over game_screenshots.
//
// Two selections, each asked by several surfaces that must not drift apart —
// the games-scope.ts shape, and the USER_MATCHES_WHERE one for the same reason
// (cloud/src/tournament/data.ts): a predicate written out at each site is a
// predicate that holds only while the copies happen to agree, and the symptom
// of a disagreement here is a tile rendered to the wrong viewer or a quota
// slot charged twice.
//
//   * VISIBLE_TO_VIEWER_WHERE — which rows one viewer is sent. The two gallery
//     reads and the profile's has_screenshots flag all apply it, which is what
//     makes the flag unable to disagree with the payload in either direction.
//   * OBJECT_STORED_WHERE — which rows still have bytes in R2, and so still
//     cost a quota slot and still pin their game public. Both caps' pre-checks,
//     both of the INSERT's own guards, and handleGamePatch's HAS_SCREENSHOTS
//     refusal ask exactly this.
//
// Separate module from handlers.ts because games.ts asks the second question
// and handlers.ts imports games.ts — a fragment exported from there would be a
// cycle, and these are const strings read at module load.

// A published row goes to everyone, a CLASSIFIER-QUEUED row (`hidden_at` set,
// `hidden_by` null) goes to its own uploader and nobody else, and a TAKEN-DOWN
// row (`hidden_by` set) goes to nobody, its uploader included — the object was
// deleted, so their tile could only render broken.
//
// The queued leg is what makes the HAS_SCREENSHOTS refusal honest: such a row
// holds a quota slot and pins its game public, so its owner needs a tile to
// delete it from.
//
// For a query that has aliased game_screenshots as `s`, and it binds ONE
// parameter: the viewer's user_id, or null for an anonymous reader —
// `user_id = NULL` is never true in SQLite, so the queued leg simply does not
// fire rather than needing a branch of its own. The alias is required rather
// than optional because the profile read joins `games`, which carries a
// `user_id` of its own that a bare column name would be ambiguous against.
export const VISIBLE_TO_VIEWER_WHERE = `(s.hidden_at IS NULL
	        OR (s.hidden_by IS NULL AND s.user_id = ?))`;

// A row whose object is still in the bucket. Binds nothing.
//
// A taken-down row is excluded from both of the jobs this predicate has: its
// object was deleted, so the slot it holds is empty — charging it would bill an
// account for a moderation record it cannot see, and would leave its game
// permanently public with no remedy its owner could carry out. A
// classifier-queued row IS included, because its object is in R2: bytes stored
// on the uploader's behalf, on a public host, and visible to them.
//
// Bare column names, because every site that asks this is a single-table count
// over game_screenshots.
export const OBJECT_STORED_WHERE = "hidden_by IS NULL";
