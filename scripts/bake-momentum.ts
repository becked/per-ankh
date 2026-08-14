// Fit the momentum model — a per-turn win-probability curve for duels — on a
// local corpus of game blobs, and bake the fitted weights + per-turn scales
// into generated modules for both the frontend and the Worker.
//
// The model, its maths, and the six data gotchas it must respect are specified
// in owglick's docs/momentum-model.md; this script is that spec rebuilt for
// per-ankh's blobs. In brief: six per-turn dimensions (cities, growth,
// orders, science, eco, military), each stored as the A−B difference (kills
// the bigger-empire-has-more-of-everything collinearity), standardised by the
// corpus SD at that turn (smoothed ±7 turns), scored by an antisymmetric
// no-intercept logistic fitted separately per game-progress bucket — because
// growth front-loads and military back-loads, one fixed weighting misreads
// both ends of every match. Cities is retained despite being ~redundant with
// growth (r ≈ +0.65) because it is independently interpretable.
//
// SOURCES (local-only): a directory of per-ankh game blobs (the JSON the
// /v1/games/:id endpoint serves), pointed at by MOMENTUM_CORPUS_DIR in .env.
// Only finished duels — exactly two humans, known winner — are used, deduped
// on the save's xml_game_id (a match both players uploaded must count once,
// not twice). ALL balance eras are kept, deliberately: a 2x2 held-out test
// on current-era games showed the extra ~170 old-era duels beat era purity
// (AUC 0.782 vs 0.773; confident-wrong rate at 50-85% progress halves) —
// the features are per-turn-standardised A−B differences, which are era-
// robust, and at n≈200 modern duels sample size binds harder than balance
// drift. Revisit the cutoff when the modern corpus alone reaches ~350.
//
// OUTPUT: src/lib/generated/momentum.ts AND cloud/src/generated/momentum.ts
// (identical, the law-classes dual-emit pattern): bucket weights, the
// smoothed SD table, and MOMENTUM_MODEL_VERSION. The scoring code that
// consumes these lives in src/lib/game-detail/momentum.ts with a byte-mirror
// in cloud/src/momentum.ts.
//
// The spec's validation suite runs here and FAILS THE BAKE on violation:
//   - Gotcha 5: map_tiles' positional index must equal tile_xml_id (checked
//     via founded_turn + 1 against each city centre's first ownership entry).
//   - Coverage: the median first scored turn must be early (Gotcha 1 — an
//     absent eco yield is zero income, not missing data).
//   - Shape: growth's weight must peak in an earlier bucket than military's
//     (the front-load/back-load signature; a corpus that fails this is
//     mis-parsed, not differently balanced).
//
// Run: npm run bake:momentum

import "dotenv/config";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format as prettierFormat, resolveConfig } from "prettier";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUTS = [
	resolve(REPO_ROOT, "src/lib/generated/momentum.ts"),
	resolve(REPO_ROOT, "cloud/src/generated/momentum.ts"),
];

// Bump when the model form changes (dimensions, buckets, standardisation) —
// refits on a new corpus keep the version and change the fitted numbers.
const MODEL_VERSION = 1;

const DIMS = ["cities", "growth", "orders", "science", "eco", "mil"] as const;
const ECO5 = [
	"YIELD_MONEY",
	"YIELD_FOOD",
	"YIELD_IRON",
	"YIELD_STONE",
	"YIELD_WOOD",
];
// Progress buckets (T / final turn). The single most important modelling
// decision — see the header comment.
const BUCKETS: [number, number][] = [
	[0.0, 0.3],
	[0.3, 0.5],
	[0.5, 0.7],
	[0.7, 0.85],
	[0.85, 1.01],
];
const L2 = 2.0;
const MIN_BUCKET_N = 40;

// ---------- Corpus loading ----------

interface Blob {
	player_roster?: { player_index: number; is_human?: boolean }[];
	match_metadata?: {
		winner?: { winner_player_xml_id?: number | null } | null;
		total_turns?: number;
		save_date?: string;
		xml_game_id?: string;
	};
	game_details?: { total_turns?: number };
	yield_history?: {
		player_id: number;
		yield_type: string;
		data: { turn: number; rate: number | null }[];
	}[];
	player_history?: {
		player_id: number;
		history: { turn: number; military_power: number | null }[];
	}[];
	map_tiles?: { is_city_center?: boolean }[];
	tile_ownership_history?: {
		tile_xml_id: number;
		turn: number;
		owner_player_xml_id: number | null;
	}[];
	city_statistics?: {
		cities: {
			founded_turn: number;
			first_owner_player_xml_id: number | null;
		}[];
	};
}

function corpusDir(): string {
	const fromEnv = process.env.MOMENTUM_CORPUS_DIR;
	if (fromEnv && fromEnv.trim() !== "") {
		const dir = resolve(fromEnv);
		if (existsSync(dir)) return dir;
		throw new Error(`MOMENTUM_CORPUS_DIR=${fromEnv} does not exist`);
	}
	throw new Error(
		"bake-momentum: set MOMENTUM_CORPUS_DIR in .env to a directory of per-ankh game blobs (one <id>.json per game)",
	);
}

// ---------- Per-game series (the spec's M / Y / C) ----------

type Series = Map<number, Map<string, Map<number, number>>>; // player → yield → turn → rate
type PowerSeries = Map<number, Map<number, number>>; // player → turn → power
type CitySeries = Map<number, Map<number, number>>; // player → turn → cities

interface Duel {
	a: number;
	b: number;
	winner: number;
	end: number;
	pts: { turn: number; f: Record<string, number> }[];
}

function citySeries(d: Blob, maxTurn: number): CitySeries | null {
	const tiles = d.map_tiles ?? [];
	const hist = d.tile_ownership_history ?? [];
	if (tiles.length === 0 || hist.length === 0) return null;
	// map_tiles is positional and its index IS the tile_xml_id used by the
	// ownership history (Gotcha 5, validated corpus-wide in main()).
	const byTile = new Map<number, { turn: number; owner: number | null }[]>();
	for (const e of hist) {
		const rows = byTile.get(e.tile_xml_id) ?? [];
		rows.push({ turn: e.turn, owner: e.owner_player_xml_id });
		byTile.set(e.tile_xml_id, rows);
	}
	const out: CitySeries = new Map();
	tiles.forEach((tile, index) => {
		if (!tile.is_city_center) return;
		const rows = byTile.get(index);
		if (!rows) return;
		rows.sort((x, y) => x.turn - y.turn);
		let owner: number | null = null;
		let k = 0;
		for (let t = 1; t <= maxTurn; t++) {
			while (k < rows.length && rows[k].turn <= t) owner = rows[k++].owner;
			if (owner == null) continue;
			const per = out.get(owner) ?? new Map<number, number>();
			per.set(t, (per.get(t) ?? 0) + 1);
			out.set(owner, per);
		}
	});
	return out;
}

/** Raw A−B features at turn T, or null when orders/science lack data. */
function featsAt(
	a: number,
	b: number,
	M: PowerSeries,
	Y: Series,
	C: CitySeries,
	T: number,
): Record<string, number> | null {
	const pa = M.get(a)?.get(T);
	const pb = M.get(b)?.get(T);
	if (pa == null || pb == null) return null;
	const ca = C.get(a)?.get(T);
	const cb = C.get(b)?.get(T);
	if (ca == null || cb == null) return null;
	const out: Record<string, number> = {
		cities: ca - cb,
		// Growth (the food→population engine) is the strongest single dimension
		// and a leading indicator of the others. Absent = zero income, like eco.
		growth:
			(Y.get(a)?.get("YIELD_GROWTH")?.get(T) ?? 0) -
			(Y.get(b)?.get("YIELD_GROWTH")?.get(T) ?? 0),
		// Relative, because absolute power grows ~20× over a match.
		mil: (pa - pb) / Math.max(1, (pa + pb) / 2),
	};
	for (const [key, name] of [
		["YIELD_ORDERS", "orders"],
		["YIELD_SCIENCE", "science"],
	] as const) {
		const va = Y.get(a)?.get(key)?.get(T);
		const vb = Y.get(b)?.get(key)?.get(T);
		// Orders and science exist from T2 — genuinely absent means no data.
		if (va == null || vb == null) return null;
		out[name] = va - vb;
	}
	let e = 0;
	for (const key of ECO5) {
		// Gotcha 1: an absent eco yield is ZERO income, not missing data.
		const va = Y.get(a)?.get(key)?.get(T) ?? 0;
		const vb = Y.get(b)?.get(key)?.get(T) ?? 0;
		// Gotcha 2: ties contribute 0, not −1.
		e += va > vb ? 1 : va < vb ? -1 : 0;
	}
	out.eco = e;
	return out;
}

function prepGame(d: Blob): Duel | null {
	const humans = (d.player_roster ?? []).filter((p) => p.is_human);
	if (humans.length !== 2) return null;
	const winner = d.match_metadata?.winner?.winner_player_xml_id;
	if (winner == null) return null;
	const end = d.game_details?.total_turns ?? d.match_metadata?.total_turns ?? 0;
	if (end < 10) return null;
	const [a, b] = [humans[0].player_index, humans[1].player_index];
	if (winner !== a && winner !== b) return null;

	const Y: Series = new Map();
	for (const row of d.yield_history ?? []) {
		const per = Y.get(row.player_id) ?? new Map<string, Map<number, number>>();
		const byTurn = per.get(row.yield_type) ?? new Map<number, number>();
		for (const p of row.data) if (p.rate != null) byTurn.set(p.turn, p.rate);
		per.set(row.yield_type, byTurn);
		Y.set(row.player_id, per);
	}
	const M: PowerSeries = new Map();
	for (const row of d.player_history ?? []) {
		const byTurn = new Map<number, number>();
		for (const p of row.history)
			if (p.military_power != null) byTurn.set(p.turn, p.military_power);
		M.set(row.player_id, byTurn);
	}
	const C = citySeries(d, end);
	if (!C) return null;

	const pts: Duel["pts"] = [];
	for (let t = 2; t <= end; t++) {
		const f = featsAt(a, b, M, Y, C, t);
		if (f) pts.push({ turn: t, f });
	}
	if (pts.length < 5) return null;
	return { a, b, winner, end, pts };
}

// ---------- Tiny linear algebra (5×5) ----------

function solve(A: number[][], g: number[]): number[] | null {
	const n = g.length;
	const m = A.map((row, i) => [...row, g[i]]);
	for (let col = 0; col < n; col++) {
		let piv = col;
		for (let r = col + 1; r < n; r++)
			if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
		if (Math.abs(m[piv][col]) < 1e-12) return null;
		[m[col], m[piv]] = [m[piv], m[col]];
		for (let r = 0; r < n; r++) {
			if (r === col) continue;
			const factor = m[r][col] / m[col][col];
			for (let c = col; c <= n; c++) m[r][c] -= factor * m[col][c];
		}
	}
	return m.map((row, i) => row[n] / m[i][i]);
}

/** Newton/IRLS logistic, no intercept, L2-regularised. */
function fitLogistic(X: number[][], y: number[]): number[] {
	const k = X[0].length;
	let w = new Array<number>(k).fill(0);
	for (let it = 0; it < 60; it++) {
		const H = Array.from({ length: k }, () => new Array<number>(k).fill(0));
		const gd = new Array<number>(k).fill(0);
		for (let i = 0; i < X.length; i++) {
			const zi = X[i].reduce((s, v, j) => s + v * w[j], 0);
			const p = 1 / (1 + Math.exp(-zi));
			const wt = Math.max(p * (1 - p), 1e-6);
			for (let r = 0; r < k; r++) {
				gd[r] += X[i][r] * (y[i] - p);
				for (let c = 0; c < k; c++) H[r][c] += X[i][r] * X[i][c] * wt;
			}
		}
		for (let r = 0; r < k; r++) {
			H[r][r] += L2;
			gd[r] -= L2 * w[r];
		}
		const step = solve(H, gd);
		if (!step) break;
		w = w.map((v, j) => v + step[j]);
		if (Math.max(...step.map(Math.abs)) < 1e-8) break;
	}
	return w;
}

// ---------- Main ----------

async function main(): Promise<void> {
	const dir = corpusDir();
	const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
	const duels: Duel[] = [];
	// A match both players uploaded appears as two blobs with one
	// xml_game_id — keep the longer upload so each match counts once.
	const byMatch = new Map<string, { turns: number; duel: Duel }>();
	let tileChecksOk = 0;
	let tileChecksTotal = 0;
	let read = 0;

	for (const f of files) {
		let d: Blob;
		try {
			d = JSON.parse(await readFile(resolve(dir, f), "utf-8")) as Blob;
		} catch {
			continue;
		}
		read++;

		// Gotcha 5 validation: each city centre's first ownership turn should be
		// founded_turn + 1 for SOME city (positional index == tile id). Sampled
		// per game; asserted corpus-wide below.
		const founded = new Set(
			(d.city_statistics?.cities ?? []).map((c) => c.founded_turn + 1),
		);
		const hist = d.tile_ownership_history ?? [];
		const firstOwn = new Map<number, number>();
		for (const e of hist) {
			const prev = firstOwn.get(e.tile_xml_id);
			if (prev == null || e.turn < prev) firstOwn.set(e.tile_xml_id, e.turn);
		}
		(d.map_tiles ?? []).forEach((tile, index) => {
			if (!tile.is_city_center) return;
			const t = firstOwn.get(index);
			if (t == null) return;
			tileChecksTotal++;
			if (founded.has(t)) tileChecksOk++;
		});

		const duel = prepGame(d);
		if (!duel) continue;
		const xid = d.match_metadata?.xml_game_id;
		const turns = duel.end;
		if (xid == null) {
			duels.push(duel);
		} else {
			const prev = byMatch.get(xid);
			if (!prev || turns > prev.turns) byMatch.set(xid, { turns, duel });
		}
	}
	duels.push(...[...byMatch.values()].map((v) => v.duel));
	console.log(
		`bake-momentum: ${read} blobs read, ${duels.length} deduped duels`,
	);

	if (tileChecksTotal > 0 && tileChecksOk / tileChecksTotal < 0.9) {
		throw new Error(
			`bake-momentum: Gotcha-5 tile-index validation failed — ${tileChecksOk}/${tileChecksTotal} city centres matched founded_turn+1. The map_tiles index ↔ tile_xml_id assumption does not hold on this corpus.`,
		);
	}
	if (duels.length < 100) {
		throw new Error(
			`bake-momentum: only ${duels.length} usable duels (of ${read} blobs) — too thin to fit.`,
		);
	}
	const firstTurns = duels.map((g) => g.pts[0].turn).sort((x, y) => x - y);
	const medianFirst = firstTurns[Math.floor(firstTurns.length / 2)];
	if (medianFirst > 8) {
		throw new Error(
			`bake-momentum: median first scored turn is ${medianFirst} — charts start late, which is the Gotcha-1 signature (absent eco yields treated as missing).`,
		);
	}

	// Per-turn SD, smoothed ±7 (Gotcha 4: raw per-turn jitter invents changes;
	// ±7 over the original ±3 cuts the Σch−Δlog-odds residual p95 ~13% with no
	// CV cost — owglick momentum-model.md §11.4).
	const atTurn = new Map<number, Map<string, number[]>>();
	for (const g of duels)
		for (const { turn, f } of g.pts) {
			const per = atTurn.get(turn) ?? new Map<string, number[]>();
			for (const k of DIMS) {
				const arr = per.get(k) ?? [];
				arr.push(f[k]);
				per.set(k, arr);
			}
			atTurn.set(turn, per);
		}
	const rawSd = new Map<number, Map<string, number>>();
	for (const [turn, per] of atTurn) {
		const out = new Map<string, number>();
		for (const k of DIMS) {
			const v = per.get(k) ?? [];
			if (v.length > 3) {
				const mean = v.reduce((s, x) => s + x, 0) / v.length;
				out.set(
					k,
					Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length),
				);
			}
		}
		rawSd.set(turn, out);
	}
	const sdTable = new Map<number, Record<string, number>>();
	for (const turn of rawSd.keys()) {
		const smoothed: Record<string, number> = {};
		let complete = true;
		for (const k of DIMS) {
			const vals: number[] = [];
			for (let t = turn - 7; t <= turn + 7; t++) {
				const v = rawSd.get(t)?.get(k);
				if (v) vals.push(v);
			}
			if (vals.length === 0) {
				complete = false;
				break;
			}
			smoothed[k] = vals.reduce((s, x) => s + x, 0) / vals.length;
		}
		if (complete) sdTable.set(turn, smoothed);
	}
	const goodTurns = [...sdTable.keys()].sort((x, y) => x - y);
	const sdAt = (T: number): Record<string, number> => {
		let best = goodTurns[0];
		for (const t of goodTurns)
			if (Math.abs(t - T) < Math.abs(best - T)) best = t;
		return sdTable.get(best)!;
	};
	const zOf = (f: Record<string, number>, T: number): number[] => {
		const s = sdAt(T);
		return DIMS.map((k) => f[k] / s[k]);
	};

	// Fit per bucket, both orientations (antisymmetry: f(−x) = 1 − f(x)).
	const weights: (number[] | null)[] = [];
	const bucketNs: number[] = [];
	for (const [lo, hi] of BUCKETS) {
		const X: number[][] = [];
		const y: number[] = [];
		for (const g of duels) {
			const label = g.winner === g.a ? 1 : 0;
			for (const { turn, f } of g.pts) {
				const prog = turn / g.end;
				if (prog >= lo && prog < hi) {
					X.push(zOf(f, turn));
					y.push(label);
				}
			}
		}
		bucketNs.push(y.length);
		if (y.length < MIN_BUCKET_N) {
			weights.push(null);
			continue;
		}
		const Xa = [...X, ...X.map((row) => row.map((v) => -v))];
		const ya = [...y, ...y.map((v) => 1 - v)];
		weights.push(fitLogistic(Xa, ya).map((v) => Math.round(v * 10000) / 10000));
	}

	// Shape check: growth must peak earlier than military, or the corpus is
	// mis-parsed (front-load/back-load is the model's signature; cities is
	// retained but redundant with growth, so it no longer anchors the check).
	const peak = (dim: number): number => {
		let best = 0;
		let bestV = -Infinity;
		weights.forEach((w, i) => {
			if (w && w[dim] > bestV) {
				bestV = w[dim];
				best = i;
			}
		});
		return best;
	};
	const growthPeak = peak(DIMS.indexOf("growth"));
	const milPeak = peak(DIMS.indexOf("mil"));
	if (!(growthPeak < milPeak)) {
		throw new Error(
			`bake-momentum: shape check failed — growth peaks in bucket ${growthPeak}, military in ${milPeak}; expected growth to front-load and military to back-load.`,
		);
	}

	// In-sample AUC at fixed progress points, for the PR body / sanity.
	const aucAt = (prog: number): string => {
		const scores: [number, number][] = [];
		for (const g of duels) {
			const T = Math.round(g.end * prog);
			const pt = g.pts.find((p) => p.turn >= T);
			if (!pt) continue;
			const bi = BUCKETS.findIndex(
				([lo, hi]) => pt.turn / g.end >= lo && pt.turn / g.end < hi,
			);
			const w = weights[bi === -1 ? BUCKETS.length - 1 : bi];
			if (!w) continue;
			const zz = zOf(pt.f, pt.turn);
			const s = zz.reduce((acc, v, j) => acc + v * w[j], 0);
			scores.push([s, g.winner === g.a ? 1 : 0]);
		}
		let concordant = 0;
		let pairs = 0;
		const pos = scores.filter(([, l]) => l === 1).map(([s]) => s);
		const neg = scores.filter(([, l]) => l === 0).map(([s]) => s);
		for (const p of pos)
			for (const n of neg) {
				pairs++;
				if (p > n) concordant++;
				else if (p === n) concordant += 0.5;
			}
		return pairs > 0 ? (concordant / pairs).toFixed(3) : "n/a";
	};

	// ---------- Emit ----------
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED by scripts/bake-momentum.ts. Do not edit.");
	lines.push("// Run `npm run bake:momentum` to refit on a local corpus.");
	lines.push("//");
	lines.push(
		`// Fitted on ${duels.length} finished duels (${read} blobs scanned).`,
	);
	lines.push(
		`// Gotcha-5 tile-index validation: ${tileChecksOk}/${tileChecksTotal} city centres matched.`,
	);
	lines.push(
		`// In-sample AUC at 30/50/70% of game: ${aucAt(0.3)} / ${aucAt(0.5)} / ${aucAt(0.7)}.`,
	);
	lines.push("");
	lines.push(
		"// Bump MODEL_VERSION in the bake when the model FORM changes; a refit",
	);
	lines.push("// on new data keeps the version and changes the numbers.");
	lines.push(`export const MOMENTUM_MODEL_VERSION = ${MODEL_VERSION};`);
	lines.push("");
	lines.push("/** Dimension order every weights row follows. */");
	lines.push(`export const MOMENTUM_DIMS = ${JSON.stringify(DIMS)} as const;`);
	lines.push("");
	lines.push(
		"/** Progress buckets over T / final turn, half-open [lo, hi). */",
	);
	lines.push(
		`export const MOMENTUM_BUCKETS: readonly [number, number][] = ${JSON.stringify(BUCKETS)};`,
	);
	lines.push("");
	lines.push(
		"/** Per-bucket weights (null = bucket too thin on this corpus). */",
	);
	lines.push(
		`export const MOMENTUM_WEIGHTS: readonly (readonly number[] | null)[] = ${JSON.stringify(weights)};`,
	);
	lines.push("");
	lines.push(
		"// Smoothed corpus SD of each dimension at each turn — the standardiser.",
	);
	lines.push(
		"// Sparse over turns; consumers snap to the nearest present turn.",
	);
	const sdObj: Record<string, Record<string, number>> = {};
	for (const t of goodTurns) {
		const row = sdTable.get(t)!;
		sdObj[t] = Object.fromEntries(
			DIMS.map((k) => [k, Math.round(row[k] * 10000) / 10000]),
		);
	}
	lines.push(
		`export const MOMENTUM_SD: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sdObj)};`,
	);
	lines.push("");

	const config = await resolveConfig(OUTPUTS[0]);
	const formatted = await prettierFormat(lines.join("\n"), {
		...config,
		parser: "typescript",
		filepath: OUTPUTS[0],
	});
	for (const out of OUTPUTS) {
		await mkdir(dirname(out), { recursive: true });
		await writeFile(out, formatted);
	}
	console.log(
		`bake-momentum: ${duels.length} duels, buckets n=[${bucketNs.join(", ")}], ` +
			`AUC@30/50/70% = ${aucAt(0.3)}/${aucAt(0.5)}/${aucAt(0.7)} → ${OUTPUTS.map((o) => o.replace(REPO_ROOT + "/", "")).join(", ")}`,
	);
	console.log(
		"weights per bucket:",
		weights.map((w) => (w ? w.map((v) => v.toFixed(2)).join(" ") : "thin")),
	);
}

await main();
