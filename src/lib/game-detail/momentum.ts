// Momentum scoring — the per-turn win-probability curve for a finished duel,
// with the exact decomposition of why the line is where it is (level) and
// what moved it (change).
//
// Consumes the fitted weights/scales from $lib/generated/momentum (baked by
// scripts/bake-momentum.ts, where the model and its data gotchas are
// documented). Everything here is pure arithmetic over blob fields; the same
// file is byte-mirrored at cloud/src/momentum.ts for the Worker's derive step,
// with a drift test keeping the two identical — change one, copy to the other.
//
// Honesty note for any consumer: this is a retrospective reading of a
// finished match, not a forecast. Weights are fitted over the corpus and the
// progress buckets need the final turn. Present it as "who was winning", not
// "who would have won".

import {
	MOMENTUM_BUCKETS,
	MOMENTUM_DIMS,
	MOMENTUM_SD,
	MOMENTUM_WEIGHTS,
} from "../generated/momentum";

const ECO5 = [
	"YIELD_MONEY",
	"YIELD_FOOD",
	"YIELD_IRON",
	"YIELD_STONE",
	"YIELD_WOOD",
];

export interface MomentumInput {
	/** The two duellists' player xml ids, in display order. */
	a: number;
	b: number;
	finalTurn: number;
	yieldHistory: {
		player_id: number;
		yield_type: string;
		data: { turn: number; rate: number | null }[];
	}[];
	playerHistory: {
		player_id: number;
		history: { turn: number; military_power: number | null }[];
	}[];
	/** Positional — the index IS the tile_xml_id (validated at bake time). */
	mapTiles: { is_city_center?: boolean }[];
	tileOwnership: {
		tile_xml_id: number;
		turn: number;
		owner_player_xml_id: number | null;
	}[];
}

export interface MomentumPoint {
	turn: number;
	/** P(player `a` wins), 0..1. */
	p: number;
	/** Per-dimension contribution to the current log-odds; Σ lv = log-odds. */
	lv: number[];
	/**
	 * Per-dimension contribution to the move since the previous point, with
	 * weight and scale held fixed at the later turn — an unchanged stat
	 * contributes exactly 0 (differencing lv instead folds in normaliser
	 * drift and invents phantom changes).
	 */
	ch: number[];
	/** Raw A−B leads, MOMENTUM_DIMS order — for tooltips. */
	raw: number[];
}

export interface MomentumCurve {
	points: MomentumPoint[];
	dims: readonly string[];
}

// ---------- Series assembly ----------

type ByTurn = Map<number, number>;

function yieldSeries(
	input: MomentumInput,
	playerId: number,
): Map<string, ByTurn> {
	const out = new Map<string, ByTurn>();
	for (const row of input.yieldHistory) {
		if (row.player_id !== playerId) continue;
		const byTurn = new Map<number, number>();
		for (const p of row.data) if (p.rate != null) byTurn.set(p.turn, p.rate);
		out.set(row.yield_type, byTurn);
	}
	return out;
}

function powerSeries(input: MomentumInput, playerId: number): ByTurn {
	const byTurn = new Map<number, number>();
	for (const row of input.playerHistory) {
		if (row.player_id !== playerId) continue;
		for (const p of row.history)
			if (p.military_power != null) byTurn.set(p.turn, p.military_power);
	}
	return byTurn;
}

/** Per-turn city counts reconstructed from the tile ownership timeline. */
function citySeries(input: MomentumInput): Map<number, ByTurn> | null {
	if (input.mapTiles.length === 0 || input.tileOwnership.length === 0)
		return null;
	const byTile = new Map<number, { turn: number; owner: number | null }[]>();
	for (const e of input.tileOwnership) {
		const rows = byTile.get(e.tile_xml_id) ?? [];
		rows.push({ turn: e.turn, owner: e.owner_player_xml_id });
		byTile.set(e.tile_xml_id, rows);
	}
	const out = new Map<number, ByTurn>();
	input.mapTiles.forEach((tile, index) => {
		if (!tile.is_city_center) return;
		const rows = byTile.get(index);
		if (!rows) return;
		rows.sort((x, y) => x.turn - y.turn);
		let owner: number | null = null;
		let k = 0;
		for (let t = 1; t <= input.finalTurn; t++) {
			while (k < rows.length && rows[k].turn <= t) owner = rows[k++].owner;
			if (owner == null) continue;
			const per = out.get(owner) ?? new Map<number, number>();
			per.set(t, (per.get(t) ?? 0) + 1);
			out.set(owner, per);
		}
	});
	return out;
}

// ---------- Features / standardisation / scoring ----------

function featsAt(
	ya: Map<string, ByTurn>,
	yb: Map<string, ByTurn>,
	ma: ByTurn,
	mb: ByTurn,
	ca: ByTurn | undefined,
	cb: ByTurn | undefined,
	T: number,
): number[] | null {
	const pa = ma.get(T);
	const pb = mb.get(T);
	if (pa == null || pb == null) return null;
	const citiesA = ca?.get(T);
	const citiesB = cb?.get(T);
	if (citiesA == null || citiesB == null) return null;
	const ordersA = ya.get("YIELD_ORDERS")?.get(T);
	const ordersB = yb.get("YIELD_ORDERS")?.get(T);
	const sciA = ya.get("YIELD_SCIENCE")?.get(T);
	const sciB = yb.get("YIELD_SCIENCE")?.get(T);
	// Orders and science exist from T2 — genuinely absent means no data.
	if (ordersA == null || ordersB == null || sciA == null || sciB == null)
		return null;
	let eco = 0;
	for (const key of ECO5) {
		// Absent eco yield = zero income, not missing data; ties contribute 0.
		const va = ya.get(key)?.get(T) ?? 0;
		const vb = yb.get(key)?.get(T) ?? 0;
		eco += va > vb ? 1 : va < vb ? -1 : 0;
	}
	// MOMENTUM_DIMS order: cities, orders, science, eco, mil.
	return [
		citiesA - citiesB,
		ordersA - ordersB,
		sciA - sciB,
		eco,
		// Relative, because absolute power grows ~20× over a match.
		(pa - pb) / Math.max(1, (pa + pb) / 2),
	];
}

const SD_TURNS = Object.keys(MOMENTUM_SD)
	.map(Number)
	.sort((x, y) => x - y);

function sdAt(T: number): Readonly<Record<string, number>> {
	let best = SD_TURNS[0];
	for (const t of SD_TURNS) if (Math.abs(t - T) < Math.abs(best - T)) best = t;
	return MOMENTUM_SD[String(best)];
}

function zOf(raw: number[], T: number): number[] {
	const s = sdAt(T);
	return raw.map((v, j) => v / s[MOMENTUM_DIMS[j]]);
}

function weightsAt(progress: number): readonly number[] | null {
	for (let i = 0; i < MOMENTUM_BUCKETS.length; i++) {
		const [lo, hi] = MOMENTUM_BUCKETS[i];
		if (progress >= lo && progress < hi) return MOMENTUM_WEIGHTS[i];
	}
	return MOMENTUM_WEIGHTS[MOMENTUM_WEIGHTS.length - 1];
}

/**
 * The full curve, or null when the game isn't scoreable (missing series,
 * fewer than five scoreable turns). Callers decide who `a` and `b` are;
 * antisymmetry guarantees swapping them yields exactly 1 − p.
 */
export function momentumCurve(input: MomentumInput): MomentumCurve | null {
	if (input.finalTurn < 10) return null;
	const ya = yieldSeries(input, input.a);
	const yb = yieldSeries(input, input.b);
	const ma = powerSeries(input, input.a);
	const mb = powerSeries(input, input.b);
	const cities = citySeries(input);
	if (!cities) return null;
	const ca = cities.get(input.a);
	const cb = cities.get(input.b);

	const pts: { turn: number; raw: number[] }[] = [];
	for (let t = 2; t <= input.finalTurn; t++) {
		const raw = featsAt(ya, yb, ma, mb, ca, cb, t);
		if (raw) pts.push({ turn: t, raw });
	}
	if (pts.length < 5) return null;

	const points: MomentumPoint[] = [];
	for (let i = 0; i < pts.length; i++) {
		const { turn, raw } = pts[i];
		const w = weightsAt(turn / input.finalTurn);
		if (!w) continue;
		const z = zOf(raw, turn);
		const lv = z.map((v, j) => w[j] * v);
		const logOdds = lv.reduce((s, v) => s + v, 0);
		// Change: weight and scale fixed at the LATER turn (see header).
		let ch = new Array<number>(MOMENTUM_DIMS.length).fill(0);
		if (i > 0) {
			const prev = pts[i - 1];
			const s1 = sdAt(turn);
			ch = raw.map((v, j) => w[j] * ((v - prev.raw[j]) / s1[MOMENTUM_DIMS[j]]));
		}
		points.push({
			turn,
			p: 1 / (1 + Math.exp(-logOdds)),
			// `+ 0` folds IEEE −0 (a negative weight times a zero change) into 0,
			// which would otherwise display as "−0.00".
			lv: lv.map((v) => Math.round(v * 100) / 100 + 0),
			ch: ch.map((v) => Math.round(v * 100) / 100 + 0),
			raw,
		});
	}
	return points.length >= 5 ? { points, dims: MOMENTUM_DIMS } : null;
}

/**
 * Drama metrics over a curve, from the eventual winner's perspective.
 * `lead_changes` uses 55/45 hysteresis — counting bare 50% crossings
 * inflates hovering-at-even matches past genuine comebacks.
 */
export function momentumDrama(
	points: MomentumPoint[],
	aWon: boolean,
): {
	low: number;
	behind: number;
	move: number;
	swing: number;
	leadChanges: number;
} {
	const ps = points.map((pt) => pt.p);
	const pw = ps.map((p) => (aWon ? p : 1 - p));
	let flips = 0;
	let state: "a" | "b" | null = null;
	for (const p of ps) {
		if (p > 0.55 && state !== "a") {
			if (state !== null) flips++;
			state = "a";
		} else if (p < 0.45 && state !== "b") {
			if (state !== null) flips++;
			state = "b";
		}
	}
	let move = 0;
	let swing = 0;
	for (let i = 1; i < ps.length; i++) {
		const d = Math.abs(ps[i] - ps[i - 1]);
		move += d;
		swing = Math.max(swing, d);
	}
	return {
		low: Math.min(...pw),
		behind: pw.filter((v) => v < 0.5).length / pw.length,
		move,
		swing,
		leadChanges: flips,
	};
}
