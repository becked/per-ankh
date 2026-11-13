// The class strings the app's surfaces share — buttons and inputs in the dark
// scheme the game-detail tabs use (tan text on dark surfaces, no bright
// accents), and the two table families at the foot of the file. One place so
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
// Distinct from the card-row family below, which is the border-separate look
// with a rounded box per row. A table picks one family or the other; these
// four move together.
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

// ─── The card-row table ──────────────────────────────────────────────
//
// The other family, which the game-detail data tabs and the ad-hoc query's
// results table use: a blue-gray frame holding one rounded card row per
// record, under a sunken header bar. Round the first and last cell of each row inline with
// `rounded-l-lg border-l` / `rounded-r-lg border-r`.
//
// The frame is a flex row because the data tabs stand a filter column beside
// the table; the table goes in a `min-w-0 flex-1 overflow-x-auto` child, and
// a mount with no filter column keeps that child so the two read the same.
//
// Here rather than in $lib/game-detail/helpers because a surface outside the
// game-detail tabs needs these four strings and not that module's baked
// tables.
export const TABLE_FRAME_CLASS = "flex gap-4 rounded-lg bg-blue-gray p-3";
export const TABLE_CLASS = "w-full border-separate border-spacing-y-1.5";
export const TABLE_HEADER_TH_CLASS =
	"sticky -top-4 z-10 cursor-pointer select-none whitespace-nowrap border-y border-surface bg-surface-sunken px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-100 shadow-lg transition-colors hover:text-orange";
export const TABLE_CELL_TD_CLASS =
	"bg-surface p-3 text-left text-tan transition-colors duration-200 group-hover:bg-surface-hover";
