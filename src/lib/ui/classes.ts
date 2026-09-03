// The button and input class strings the challenge surfaces share — the
// dark scheme the game-detail tabs use: tan text on dark surfaces, no bright
// accents. One place so the create page, the challenge page and the upload
// modal can't drift.

export const PRIMARY_BTN =
	"rounded bg-surface-raised px-4 py-2 text-sm font-bold text-tan transition-colors hover:bg-surface-raised-hover disabled:cursor-not-allowed disabled:opacity-50";

export const SECONDARY_BTN =
	"whitespace-nowrap rounded border border-tan px-3 py-1.5 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50";

export const INPUT_CLASS =
	"rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none";
