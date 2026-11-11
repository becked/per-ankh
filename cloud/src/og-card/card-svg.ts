// The per-game link-preview card, as an SVG string.
//
// This is a second rendering of `src/lib/RecentSaveCard.svelte` — the home
// feed's card — and it is deliberately not pixel-exact. The component's
// sparkline is drawn by ECharts on a canvas, inside an `$effect` behind a
// deferred 200 KB import, so a server-rendered copy of the component is an
// empty div and reproducing it exactly would mean headless Chromium per game.
// What is reproduced is the card's *content and structure*: the same header
// row, the same two rows of five stat tiles in the same order, the same
// momentum-or-VP choice of chart, and the same colours. Issue #363 §Consequence
// names the cost: a tile added to the component does not reach the embed until
// it is added here too.
//
// Two things in the component are not here, and both are absences rather than
// substitutions. The per-tile sprite icons and the uploader's avatar: the
// sprites are gitignored build output from a pinacotheca checkout and the
// avatar is a remote cdn.discordapp.com URL, and resvg resolves neither — it
// makes no network requests and silently skips a remote `<image href>`.
//
// Geometry is computed, not laid out: the card is a fixed 1200×630 with two
// rows of five equal tiles, so every coordinate falls out of the constants
// below. Text that overflows its box is hard-clipped with a `<clipPath>`
// rather than ellipsised, which is what lets the whole thing be built with no
// font metrics at all.

import {
	escapeHtml,
	formatDate,
	formatEnum,
	formatGameTitle,
	nationName,
} from "../../../src/lib/utils/formatting";
import {
	mapScriptLabel,
	mapSizeLabel,
	prosperityName,
} from "../../../src/lib/map-settings";
import { getNationChartColor } from "../../../src/lib/config/nations";
import { CHART_REFERENCE_LINE_COLOR } from "../../../src/lib/config/charts";
import { withEndStateTotal } from "../../../src/lib/utils/victory-point-series";
import { CARD_FONT_FAMILY } from "../generated/card-fonts";
import type { PublicGameCard, PublicGameCardPlayer } from "../games";

// ─── Canvas ───────────────────────────────────────────────────────────────

// 1200×630 is the size every unfurl consumer sizes its large-image slot for.
// Fixed regardless of what the game carries — a card with no series centres
// its rows instead of shrinking, so one declared pair is true of every game.
//
// Restated as GAME_CARD_WIDTH / GAME_CARD_HEIGHT in src/lib/api-cloud.ts,
// which is what `og:image:width` / `og:image:height` are built from. Two
// copies because the frontend bundle cannot import a Worker module; change
// both, and the integration test asserts the rendered PNG against the pair.
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

// The component's Tailwind spacing, doubled. Everything below is `<value in
// RecentSaveCard.svelte> × 2`, which is what keeps the two legible as the same
// card: 12px of `p-3` padding is 24 here, `gap-2` is 16, `text-sm` is 28.
const SCALE = 2;
const CARD_PAD = 12 * SCALE; // p-3
const CARD_RADIUS = 8 * SCALE; // rounded-lg
const TILE_GAP = 8 * SCALE; // gap-2
const TILE_RADIUS = 4 * SCALE; // rounded
const TILE_PAD = 8 * SCALE; // p-2
const ROW_GAP = 8 * SCALE; // mb-2
const CHART_GAP = 12 * SCALE; // mb-3 above the chart
const CHART_PAD = 4 * SCALE; // p-1 inside the chart box

const LABEL_SIZE = 10 * SCALE; // text-[10px]
const VALUE_SIZE = 14 * SCALE; // text-sm
const TITLE_SIZE = 18 * SCALE; // text-lg
const PILL_SIZE = 12 * SCALE; // text-xs
const LABEL_GAP = 2 * SCALE; // mb-0.5 between a tile's label and its value

const WEIGHT_NORMAL = 400;
const WEIGHT_BOLD = 700;

// Line box and baseline, in ems. Inter's ascender is 0.969em and its
// descender 0.241em, so a line is 1.21em tall and its baseline sits 0.8 of the
// way down. Stated here rather than measured per string: nothing in this card
// needs a text *width*, which is what hard-clipping buys.
const LINE_HEIGHT = 1.21;
const BASELINE = 0.8;

function lineBox(fontSize: number): number {
	return Math.round(fontSize * LINE_HEIGHT);
}

function baselineIn(top: number, fontSize: number): number {
	return top + Math.round(fontSize * LINE_HEIGHT * BASELINE);
}

// ─── Colours ──────────────────────────────────────────────────────────────

// The card's surfaces and text, mirroring the CSS variables in src/app.css
// (which is the source of truth) and Tailwind's own `gray-400`. Hex rather
// than `rgb(var(--color-…))` for the same reason the chart theme is hex: this
// paints to a raster with no stylesheet to resolve a variable against.
const SURFACE_RAISED = "#35302b"; // --color-surface-raised, the card itself
const SURFACE = "#2a2622"; // --color-surface, a stat tile
const SURFACE_SUNKEN = "#241f1b"; // --color-surface-sunken, the chart box
const TEXT_BRIGHT = "#dbdee3"; // --color-bright, a tile's value
const TEXT_LABEL = "#9ca3af"; // text-gray-400, a tile's label
const TEXT_WHITE = "#ffffff"; // text-white, the uploader
const TEXT_TAN = "#d2b48c"; // --color-tan, the game title
const PILL_FILL = "#b45309"; // bg-amber-700, at the 40% opacity below
const PILL_FILL_OPACITY = 0.4;
const PILL_TEXT = "#fcd34d"; // text-amber-300

// Area fill under the momentum line, matching the component's areaStyle.
const MOMENTUM_FILL_OPACITY = 0.25;

// Stroke widths: the component's 1.5px series line and 1px reference rule.
const SERIES_STROKE = 1.5 * SCALE;
const RULE_STROKE = 1 * SCALE;

// ─── Primitives ───────────────────────────────────────────────────────────

function rect(
	x: number,
	y: number,
	w: number,
	h: number,
	fill: string,
	radius = 0,
	opacity?: number,
): string {
	const r = radius > 0 ? ` rx="${radius}"` : "";
	const o = opacity != null ? ` fill-opacity="${opacity}"` : "";
	return `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" fill="${fill}"${r}${o}/>`;
}

type Anchor = "start" | "middle" | "end";

function text(
	x: number,
	baseline: number,
	value: string,
	opts: {
		size: number;
		fill: string;
		weight: number;
		anchor?: Anchor;
		clip?: string;
	},
): string {
	const anchor = opts.anchor ?? "start";
	const clip = opts.clip ? ` clip-path="url(#${opts.clip})"` : "";
	return (
		`<text x="${round(x)}" y="${round(baseline)}" font-family="${CARD_FONT_FAMILY}"` +
		` font-size="${opts.size}" font-weight="${opts.weight}" fill="${opts.fill}"` +
		` text-anchor="${anchor}"${clip}>${escapeHtml(value)}</text>`
	);
}

// Two decimals is finer than a device pixel at this size and keeps the chart
// paths from carrying float noise.
function round(n: number): number {
	return Math.round(n * 100) / 100;
}

// ─── Card model ───────────────────────────────────────────────────────────

// The component's derivations, in its order. Each mirrors a `$derived` in
// RecentSaveCard.svelte and carries the same fallbacks — see there for why
// each one is what it is.
function orderPlayers(game: PublicGameCard): PublicGameCardPlayer[] {
	// Uploader first, then by player_index — anchors sparkline colours.
	return [...game.players].sort((a, b) => {
		if (a.is_uploader !== b.is_uploader) return a.is_uploader ? -1 : 1;
		return a.player_index - b.player_index;
	});
}

function featuredPlayer(
	ordered: readonly PublicGameCardPlayer[],
): PublicGameCardPlayer | null {
	return (
		ordered.find((p) => p.is_winner) ??
		[...ordered]
			.filter((p) => p.final_points != null)
			.sort((a, b) => (b.final_points ?? 0) - (a.final_points ?? 0))[0] ??
		null
	);
}

function winnerLabel(game: PublicGameCard): string {
	const winning = game.players.find(
		(p) => p.is_winner || p.nation === game.winner_nation,
	);
	const name = game.winner_name ?? winning?.player_name ?? null;
	if (name && game.winner_nation) {
		return `${name} (${nationName(game.winner_nation)})`;
	}
	if (game.winner_nation) return nationName(game.winner_nation);
	return "—";
}

interface Tile {
	label: string;
	value: string;
}

function headerTiles(game: PublicGameCard): Tile[] {
	const humanNation =
		game.user_nation ??
		game.players.find((p) => p.is_uploader)?.nation ??
		game.players[0]?.nation ??
		null;
	// MP = >1 human seat, the same count the component makes.
	const isMultiplayer = game.players.filter((p) => p.is_human).length > 1;
	return [
		{ label: "Player", value: humanNation ? nationName(humanNation) : "—" },
		{ label: "Winner", value: winnerLabel(game) },
		{
			label: "Victory Type",
			value: game.victory_type
				? formatEnum(game.victory_type, "VICTORY_")
				: "—",
		},
		{
			label: "Map",
			value: game.map_class
				? mapScriptLabel(game.map_class)
				: game.map_size
					? mapSizeLabel(game.map_size)
					: "—",
		},
		isMultiplayer
			? { label: "Multiplayer", value: "Multiplayer" }
			: {
					label: "Prosperity",
					value: game.difficulty ? prosperityName(game.difficulty) : "—",
				},
	];
}

function featuredTiles(
	game: PublicGameCard,
	featured: PublicGameCardPlayer | null,
): Tile[] | null {
	if (
		!featured ||
		(featured.cities_total == null &&
			featured.techs_completed == null &&
			featured.laws_count == null &&
			featured.final_points == null)
	) {
		return null;
	}
	const num = (v: number | null): string => (v == null ? "—" : String(v));
	return [
		{ label: "Cities", value: num(featured.cities_total) },
		{ label: "Techs", value: num(featured.techs_completed) },
		{ label: "Laws", value: num(featured.laws_count) },
		{ label: "VP", value: num(featured.final_points) },
		{ label: "Turns", value: String(game.total_turns) },
	];
}

// ─── Charts ───────────────────────────────────────────────────────────────

interface Plot {
	x: number;
	y: number;
	width: number;
	height: number;
}

// Map a [turn, value] pair into the plot box. y grows downward in SVG, so the
// value axis is inverted here rather than at every call site.
function project(
	plot: Plot,
	xMin: number,
	xMax: number,
	yMin: number,
	yMax: number,
	turn: number,
	value: number,
): [number, number] {
	const xSpan = xMax - xMin || 1;
	const ySpan = yMax - yMin || 1;
	return [
		plot.x + ((turn - xMin) / xSpan) * plot.width,
		plot.y + plot.height - ((value - yMin) / ySpan) * plot.height,
	];
}

function polyline(points: Array<[number, number]>): string {
	return points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
}

// The momentum chart (duels): one line for the first player, and the area
// between it and the 50% midline filled in whoever-leads' colour. The y domain
// is a fixed [0, 100] in the component too, so nothing here autoscales. The
// second player's series is `lineStyle: { opacity: 0 }` there — it exists only
// to name both sides in the tooltip, which a raster has none of, so it is not
// drawn.
function momentumChart(
	plot: Plot,
	players: readonly PublicGameCardPlayer[],
): string {
	const series = players[0]?.momentum_series ?? [];
	if (series.length === 0) return "";
	const xMin = 1;
	const xMax = Math.max(xMin + 1, series[series.length - 1].turn);
	const at = (turn: number, value: number): [number, number] =>
		project(plot, xMin, xMax, 0, 100, turn, value);

	const parts: string[] = [];
	// Two clamped copies of the one series, each closed back along y=50 —
	// the component's two silent area series.
	for (const side of [0, 1] as const) {
		const clamped = series.map((pt) =>
			at(
				pt.turn,
				side === 0 ? Math.max(50, pt.p * 100) : Math.min(50, pt.p * 100),
			),
		);
		const [, midY] = at(xMin, 50);
		const [startX] = clamped[0];
		const [endX] = clamped[clamped.length - 1];
		parts.push(
			`<polygon points="${polyline([
				[startX, midY],
				...clamped,
				[endX, midY],
			])}" fill="${getNationChartColor(players[side]?.nation ?? null, side)}" fill-opacity="${MOMENTUM_FILL_OPACITY}"/>`,
		);
	}
	// The 50% rule, under the line, as the component's markLine is.
	const [, midY] = at(xMin, 50);
	parts.push(
		`<line x1="${round(plot.x)}" y1="${round(midY)}" x2="${round(plot.x + plot.width)}" y2="${round(midY)}" stroke="${CHART_REFERENCE_LINE_COLOR}" stroke-width="${RULE_STROKE}"/>`,
	);
	parts.push(
		`<polyline points="${polyline(series.map((pt) => at(pt.turn, pt.p * 100)))}" fill="none" stroke="${getNationChartColor(players[0]?.nation ?? null, 0)}" stroke-width="${SERIES_STROKE}" stroke-linejoin="round" stroke-linecap="round"/>`,
	);
	return parts.join("");
}

// The VP sparkline (everything else): one polyline per player, y from 0 to the
// highest point any of them reach.
//
// The component's `smooth: true` and `sampling: "lttb"` are dropped. Neither
// reproduces from a polyline, and at this size the curve a spline would add is
// below a pixel — what the reader sees is the shape of the race, which the
// straight segments carry. The y max is the data's own rather than ECharts'
// next nice round number above it, so the lines sit a little taller here.
function vpChart(
	plot: Plot,
	ordered: readonly PublicGameCardPlayer[],
	totalTurns: number,
): string {
	const series = ordered.map((p, i) => ({
		color: getNationChartColor(p.nation, i),
		// `final_points` is this seat's end-state total, written at upload.
		// The card has no blob to recompute from, so the same substitution the
		// three chart surfaces share applies here too.
		points: withEndStateTotal(
			p.vp_series.map((pt): [number, number | null] => [pt.turn, pt.vp ?? 0]),
			p.final_points,
		),
	}));
	const all = series.flatMap((s) => s.points);
	if (all.length === 0) return "";
	const xMax = Math.max(
		1,
		totalTurns > 0 ? totalTurns : Math.max(...all.map(([turn]) => turn)),
	);
	const yMax = Math.max(1, ...all.map(([, v]) => v ?? 0));
	return series
		.filter((s) => s.points.length > 0)
		.map(
			(s) =>
				`<polyline points="${polyline(
					s.points.map(([turn, v]) =>
						project(plot, 0, xMax, 0, yMax, turn, v ?? 0),
					),
				)}" fill="none" stroke="${s.color}" stroke-width="${SERIES_STROKE}" stroke-linejoin="round" stroke-linecap="round"/>`,
		)
		.join("");
}

// ─── Assembly ─────────────────────────────────────────────────────────────

/**
 * The card for one public game, as an SVG document string.
 *
 * Pure: no fetches, no fonts, no wasm. `renderCardPng` (raster.ts) is what
 * turns it into the bytes the route serves.
 */
export function buildCardSvg(game: PublicGameCard): string {
	const ordered = orderPlayers(game);
	const rows: Tile[][] = [headerTiles(game)];
	const featured = featuredTiles(game, featuredPlayer(ordered));
	if (featured) rows.push(featured);

	// Momentum takes over for duels — both humans carry a fitted per-turn win
	// probability. Everything else falls back to the VP sparkline.
	const momentumPlayers = ordered.filter((p) => p.momentum_series.length > 0);
	const hasMomentum = momentumPlayers.length === 2;
	const hasSparkline = ordered.some((p) => p.vp_series.length > 0);
	const hasChart = hasMomentum || hasSparkline;

	const titleLine = lineBox(TITLE_SIZE);
	const tileHeight =
		TILE_PAD + lineBox(LABEL_SIZE) + LABEL_GAP + lineBox(VALUE_SIZE) + TILE_PAD;
	const blockHeight = titleLine + rows.length * (ROW_GAP + tileHeight);

	// With a chart the block sits at the top and the chart takes the rest.
	// Without one there is nothing to take it, so the block is centred instead
	// of leaving a third of the card empty below it.
	const top = hasChart ? CARD_PAD : Math.round((CARD_HEIGHT - blockHeight) / 2);

	const body: string[] = [];
	const defs: string[] = [];
	body.push(rect(0, 0, CARD_WIDTH, CARD_HEIGHT, SURFACE_RAISED, CARD_RADIUS));

	// Header: uploader (left) + game title (centre) + save date (right), on
	// three equal columns, as the component's equal-flex side columns are.
	const contentWidth = CARD_WIDTH - 2 * CARD_PAD;
	const colWidth = (contentWidth - 2 * TILE_GAP) / 3;
	const titleBaseline = baselineIn(top, TITLE_SIZE);
	defs.push(
		`<clipPath id="hdr-l"><rect x="${round(CARD_PAD)}" y="${top}" width="${round(colWidth)}" height="${titleLine}"/></clipPath>`,
		`<clipPath id="hdr-c"><rect x="${round(CARD_PAD + colWidth + TILE_GAP)}" y="${top}" width="${round(colWidth)}" height="${titleLine}"/></clipPath>`,
	);
	body.push(
		text(CARD_PAD, titleBaseline, game.uploader_display_name, {
			size: TITLE_SIZE,
			fill: TEXT_WHITE,
			weight: WEIGHT_BOLD,
			clip: "hdr-l",
		}),
	);
	body.push(
		text(
			CARD_WIDTH / 2,
			titleBaseline,
			formatGameTitle({
				display_name: game.display_name,
				game_name: game.game_name,
				save_owner_nation: game.user_nation,
				total_turns: game.total_turns,
				// match_id 0 is only consulted when name, nation and turns are
				// all missing — the same degenerate case the component passes.
				match_id: 0,
			}),
			{
				size: TITLE_SIZE,
				fill: TEXT_TAN,
				weight: WEIGHT_BOLD,
				anchor: "middle",
				clip: "hdr-c",
			},
		),
	);

	// The date chip. Fixed width rather than shrink-wrapped: `formatDate`
	// returns `YYYY-MM-DD` or "Unknown" and nothing else, so one width holds
	// every card — and sizing it to the string is the one thing on this card
	// that would need a text measurement.
	//
	// The one constant below not derived from the component's spacing × SCALE,
	// so it is derived from the string instead: in the baked 400 face, the
	// widest ten characters `formatDate` can return ("4" is the widest digit)
	// advance 146.1px at PILL_SIZE, and "Unknown" 107.6px. 150 is the next
	// round number above the worst case.
	const pillText =
		game.save_date && formatDate(game.save_date) !== "Unknown"
			? formatDate(game.save_date)
			: formatDate(game.created_at);
	const pillHeight = lineBox(PILL_SIZE);
	const pillWidth = 150;
	const pillX = CARD_WIDTH - CARD_PAD - pillWidth;
	const pillY = top + Math.round((titleLine - pillHeight) / 2);
	body.push(
		rect(
			pillX,
			pillY,
			pillWidth,
			pillHeight,
			PILL_FILL,
			TILE_RADIUS,
			PILL_FILL_OPACITY,
		),
	);
	body.push(
		text(pillX + pillWidth / 2, baselineIn(pillY, PILL_SIZE), pillText, {
			size: PILL_SIZE,
			fill: PILL_TEXT,
			weight: WEIGHT_NORMAL,
			anchor: "middle",
		}),
	);

	// Stat tiles: two rows of five equal columns.
	const tileWidth = (contentWidth - 4 * TILE_GAP) / 5;
	let y = top + titleLine + ROW_GAP;
	rows.forEach((row, rowIndex) => {
		row.forEach((tile, col) => {
			const x = CARD_PAD + col * (tileWidth + TILE_GAP);
			const clipId = `t${rowIndex}-${col}`;
			defs.push(
				`<clipPath id="${clipId}"><rect x="${round(x + TILE_PAD)}" y="${round(y)}" width="${round(tileWidth - 2 * TILE_PAD)}" height="${round(tileHeight)}"/></clipPath>`,
			);
			body.push(rect(x, y, tileWidth, tileHeight, SURFACE, TILE_RADIUS));
			const labelTop = y + TILE_PAD;
			body.push(
				text(x + TILE_PAD, baselineIn(labelTop, LABEL_SIZE), tile.label, {
					size: LABEL_SIZE,
					fill: TEXT_LABEL,
					weight: WEIGHT_BOLD,
					clip: clipId,
				}),
			);
			const valueTop = labelTop + lineBox(LABEL_SIZE) + LABEL_GAP;
			body.push(
				text(x + TILE_PAD, baselineIn(valueTop, VALUE_SIZE), tile.value, {
					size: VALUE_SIZE,
					fill: TEXT_BRIGHT,
					weight: WEIGHT_BOLD,
					clip: clipId,
				}),
			);
		});
		y += tileHeight + ROW_GAP;
	});

	if (hasChart) {
		// The chart takes everything left. It is a larger share of this card
		// than of the component's (where it is a 60px strip), because at the
		// size an unfurl is actually looked at it is the element that still
		// reads.
		const boxY = y - ROW_GAP + CHART_GAP;
		const boxHeight = CARD_HEIGHT - CARD_PAD - boxY;
		body.push(
			rect(
				CARD_PAD,
				boxY,
				contentWidth,
				boxHeight,
				SURFACE_SUNKEN,
				TILE_RADIUS,
			),
		);
		// The component's grid insets, doubled: 2px sides on momentum, 4px all
		// round on the VP sparkline, both inside the box's own `p-1`.
		const inset = (hasMomentum ? 2 : 4) * SCALE;
		const plot: Plot = {
			x: CARD_PAD + CHART_PAD + inset,
			y: boxY + CHART_PAD + inset,
			width: contentWidth - 2 * (CHART_PAD + inset),
			height: boxHeight - 2 * (CHART_PAD + inset),
		};
		body.push(
			hasMomentum
				? momentumChart(plot, momentumPlayers)
				: vpChart(plot, ordered, game.total_turns),
		);
	}

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">` +
		`<defs>${defs.join("")}</defs>` +
		body.join("") +
		`</svg>`
	);
}
