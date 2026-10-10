// Screenshot limits that two sides of the wire both need (issue #289).
//
// The caption's ceiling is the Worker's rule — valibot refuses a longer one
// with a 400 — but the input that collects it wants the same number for its
// own `maxlength`, so the field refuses a 201st character instead of the
// round trip doing it. It lives here rather than in either consumer for the
// reason stored-variant.ts exists: a number two modules agree on by hand is
// a number that drifts. The Worker importing from $lib is the direction
// cloud/src/games.ts already reads shared domain code in.

// A caption is one line under a tile, not a description: long enough for
// "Turn 140, three cities on the Nile", short enough that the strip stays a
// row of images. Trimmed to empty counts as no caption, so the UI can send
// the field unconditionally.
export const SCREENSHOT_CAPTION_MAX = 200;
