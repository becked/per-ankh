// The class strings the app's surfaces share — buttons and inputs in the dark
// scheme the game-detail tabs use (tan text on dark surfaces, no bright
// accents), and the framed-table chrome at the foot of the file. One place so
// the create page, the challenge page, the upload modal and the tournament
// settings popover can't drift.

export const PRIMARY_BTN =
	"rounded bg-surface-raised px-4 py-2 text-sm font-bold text-tan transition-colors hover:bg-surface-raised-hover disabled:cursor-not-allowed disabled:opacity-50";

export const SECONDARY_BTN =
	"whitespace-nowrap rounded border border-tan px-3 py-1.5 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50";

// The outlined red button an irreversible action gets — deleting a challenge
// or a tournament. A brighter red than `--color-danger`, which app.css
// defines as the eliminate/loss status colour.
export const DESTRUCTIVE_BTN =
	"whitespace-nowrap rounded border border-red-400 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-400 hover:text-black disabled:opacity-50";

export const INPUT_CLASS =
	"rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none";

// ─── The framed table ────────────────────────────────────────────────
//
// The framed-box table treatment the tournament match table introduced and
// the profile's Games table now shares: a raised header bar
// (surface-raised-hover, deliberately *lighter* than both zebra tones so it
// reads as chrome and never blends into a stripe — the page itself is the
// ramp's darkest tone), a contiguous zebra body with no per-cell rounding,
// and transparent cells so the row's stripe shows through.
//
// Distinct from game-detail's TABLE_CLASS family ($lib/game-detail/helpers),
// which is the border-separate look with a rounded box per row. A table picks
// one family or the other; these four move together.
//
// Each mount layers its own modifiers on top (a sticky header offset, the
// pointer affordance on a sortable column) — those depend on the pane the
// table scrolls in, so they stay at the call site.
export const FRAMED_TABLE_WRAPPER =
	"overflow-x-auto rounded-lg border border-black";

export const FRAMED_TABLE_TH =
	"select-none whitespace-nowrap border-b border-black bg-surface-raised-hover px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-100 shadow-lg";

// align-top so a multi-line cell doesn't vertically center the shorter cells
// beside it.
export const FRAMED_TABLE_TD =
	"whitespace-nowrap px-3 py-2 text-left align-top text-tan";

// The <tr> carries the stripe + hover background (the cells stay transparent).
export const FRAMED_TABLE_ROW =
	"transition-colors odd:bg-surface even:bg-surface-raised hover:bg-surface-hover";
