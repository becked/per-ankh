// `./per-ankh admin saves pull` — build a local save corpus by drawing a
// stratified sample of games out of the cloud and writing their original ZIPs
// into `test-data/saves/`.
//
// WHY THIS EXISTS. Every claim this repo measures "across the corpus" is
// measured across whatever is in `test-data/saves/`, and that directory is
// populated by hand out of one player's user-data folder. One person's saves
// cannot produce most of the shapes its README asks for — a realm eliminated
// mid-game, a city that changed hands, a spread of game versions — and no
// local tool could reach the ones that could: `./per-ankh backup` is D1 only
// (`scripts/restore.ts` prints `R2 / KV: untouched`), so a restored snapshot
// gives metadata rows and no archive. The archives themselves are durable:
// `handleGameUpload` puts `saves/{game_id}.zip` beside the parsed blob on
// every upload, and it is removed only when the game is — `handleGameDelete`
// drops the pair together. What was missing is a step that decides WHICH game
// ids, and a durable destination. This is that step.
//
// IT LIVES ON THE ADMIN SURFACE because it reads remote R2 — the same gated
// read `reparse-all` and `duel-event-titles` make, through the same
// `readCachedSave`, so target flags and bucket resolution are not
// reimplemented a third time.
//
// SELECTION — a coverage floor first, then proportional. The corpus spreads
// over `game_mode` × `map_size` × `victory_type`, and two in five of those
// cells hold a single game: a straight proportional draw of 100 reproduces
// the common case the hand-copied saves already cover and misses nearly every
// cell. So phase 1 is a greedy set cover over every cell AND every value of
// every dimension below, which is what buys the LAN games, the games with no
// recorded winner, the HUGE maps and the blobs still on an old parser — the
// half of the corpus that has actually caught defects. Phase 2 spends
// what is left proportionally, so the common case is represented too.
// `--seed` fixes the draw.
//
// THE POOL IS DEDUPED ON `xml_game_id`, not on game_id. An observer's upload
// and the player's own upload of the same match are two `games` rows —
// `UNIQUE (user_id, file_hash)` does not collapse them — so drawing over rows
// spends sample slots on duplicate saves. Where both exist the player's own
// upload wins, because it is the one that claimed a seat.
//
// GAME VERSION IS REPORTED, NOT SELECTED. The build version is not a column:
// it is parsed out of the Root `Version` attribute, which also carries the
// `+`-separated mod tokens (`src/lib/parser/parsers/match-metadata.ts`). So
// each pulled save is parsed once it lands and the realized build and mod
// spread is reported. A draw cannot target a version band, and a band that
// comes back empty is answered by raising `--sample` or changing `--seed`,
// never by a filter the pool can't express.
//
// PII. Saves carry other players' names and `online_id` whatever a game's
// visibility is, and `.gitignore` holds `test-data/saves/` to its README,
// `.gitkeep` and `sample.xml`, so nothing pulled here can be committed. The
// manifest is written beside the saves under the same rule, and carries game
// ids and shape columns only — no uploader, no game name.

import { existsSync } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { d1Query, getTarget, isLocal } from "../wrangler";
import { readCachedSave, readSaveFile, type CachedSave } from "../saves";
import { uploaderPlayerIndexSql } from "../../../cloud/src/games-scope";
// Deliberately the tournament engine's RNG rather than a second one, the way
// `cloud/src/ratings/recommend.ts` reaches for it: a seeded mulberry32 whose
// draw a re-run reproduces. Its only import is a type, so `tsx` can load it.
import { createRng, shuffle } from "../../../cloud/src/tournament/rng";
import type { CommandOpts } from "../../lib/cli";
import { flagInt, flagString, parseFlags, printJson } from "../../lib/cli";
import {
	bold,
	dim,
	formatBytes,
	info,
	ok,
	printTable,
	trunc,
	warn,
	type Column,
} from "../../lib/format";
import { mapLimit } from "../../lib/map-limit";
import {
	parseActivePlayerIndex,
	parseSaveXml,
} from "../../../src/lib/parser/parse-xml";
import { extractAllGameData } from "../../../src/lib/parser/parsers/index";

const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);

// This checkout's corpus directory. A git worktree is its own checkout, so a
// run under `.claude/worktrees/` populates that worktree — `--out` is how an
// operator points a worktree run at the primary checkout instead.
const DEFAULT_OUT = resolve(REPO_ROOT, "test-data", "saves");

const DEFAULT_SAMPLE = 100;

// Fixed rather than random, so a plain `saves pull` is reproducible and two
// machines end up with the same corpus. `--seed` is for wanting a *different*
// draw, not for wanting a repeatable one.
const DEFAULT_SEED = "per-ankh";

// Each in-flight save holds a decompressed archive and its parse tree in
// memory (~20 MB of tree per file — docs/save-file-format.md, "DOM memory
// caution"), so the ceiling bounds heap as much as it bounds wrangler spawns.
// Same value and same reason as the reparse sweep.
const DEFAULT_CONCURRENCY = 4;

// `game_mode`, `map_size`, `map_class` and `victory_type` are all nullable in
// `games` (migration 0002), and a null is a shape worth covering rather than a
// row to drop: the games with no recorded winner pre-date v1.0.62443 and
// import with the winner and victory-type cards both showing `-`.
const NULL_LABEL = "(null)";

// What a null becomes in a file name. Not `none`: `NONE` is a `game_mode` the
// corpus actually carries, and the two must not read the same.
const UNKNOWN_SLUG = "unknown";

const MANIFEST_NAME = "pull-manifest.json";

interface PoolRow {
	game_id: string;
	xml_game_id: string;
	game_mode: string | null;
	map_size: string | null;
	map_class: string | null;
	victory_type: string | null;
	total_turns: number;
	parser_version: string;
	// `player_summaries.is_uploader` — the seat the uploader claimed. Null
	// means an observer upload. Used only to break the `xml_game_id` tie;
	// never written out, because it is a fact about a person.
	uploader_player_index: number | null;
}

// ---------- dimensions ----------

interface Dimension {
	key: string;
	value: (g: PoolRow) => string;
}

// `total_turns` is NOT NULL (migration 0002), so every game lands in a band.
function turnBand(turns: number): string {
	if (turns < 40) return "<40";
	if (turns < 80) return "40-79";
	if (turns < 120) return "80-119";
	return "120+";
}

// Every dimension the draw covers. The first, second and fourth also compose
// the primary cell below; the rest are covered inside whatever cells the floor
// picks, which is why the floor is a set cover rather than one pick per cell —
// a game that is both the only HUGE map and the only LAN game pays twice.
const DIMENSIONS: readonly Dimension[] = [
	{ key: "game_mode", value: (g) => g.game_mode ?? NULL_LABEL },
	{ key: "map_size", value: (g) => g.map_size ?? NULL_LABEL },
	{ key: "map_class", value: (g) => g.map_class ?? NULL_LABEL },
	{ key: "victory_type", value: (g) => g.victory_type ?? NULL_LABEL },
	{ key: "total_turns", value: (g) => turnBand(g.total_turns) },
	{ key: "parser_version", value: (g) => g.parser_version },
];

// The primary stratum: who was playing, how big the board was, how it ended.
const cellKey = (g: PoolRow): string =>
	[
		g.game_mode ?? NULL_LABEL,
		g.map_size ?? NULL_LABEL,
		g.victory_type ?? NULL_LABEL,
	].join("|");

// What a single game would cover. The cell is one requirement among the
// dimension values rather than a separate pass, so the floor's greedy step
// trades them off against each other in one comparison.
function requirements(g: PoolRow): string[] {
	return [
		`cell:${cellKey(g)}`,
		...DIMENSIONS.map((d) => `${d.key}:${d.value(g)}`),
	];
}

// ---------- pool ----------

interface Pool {
	games: PoolRow[];
	// `games` rows read, before the xml_game_id collapse.
	rows: number;
	collapsed: number;
}

// Every game, deduped on the id the GAME wrote. Deduping in TS rather than in
// SQL keeps the tie-break readable and lets the run report how many uploads
// collapsed; the whole table is ~1k rows, so there is nothing to push down.
async function loadPool(): Promise<Pool> {
	const rows = await d1Query<PoolRow>(
		`SELECT g.game_id, g.xml_game_id, g.game_mode, g.map_size, g.map_class,
		        g.victory_type, g.total_turns, g.parser_version,
		        ${uploaderPlayerIndexSql("g")} AS uploader_player_index
		   FROM games g
		  ORDER BY g.xml_game_id, g.game_id`,
	);
	const best = new Map<string, PoolRow>();
	for (const row of rows) {
		const held = best.get(row.xml_game_id);
		// First row wins — the ORDER BY makes that the lowest game_id — except
		// that a row whose uploader claimed a seat displaces an observer upload
		// of the same match.
		if (
			held === undefined ||
			(held.uploader_player_index == null && row.uploader_player_index != null)
		) {
			best.set(row.xml_game_id, row);
		}
	}
	return {
		games: [...best.values()],
		rows: rows.length,
		collapsed: rows.length - best.size,
	};
}

// ---------- allocation ----------

type PickKind = "coverage" | "proportional";

interface Pick {
	game: PoolRow;
	kind: PickKind;
	// For a coverage pick, the requirements it was the first to satisfy —
	// literally why it is in the sample. Empty for a proportional pick.
	covers: string[];
}

interface Allocation {
	picks: Pick[];
	// Requirements no pick reached, which happens only when --sample is
	// smaller than the floor needs. Named, so a short draw says what it cost.
	uncovered: string[];
	cells: number;
	singletonCells: number;
}

function allocate(
	pool: readonly PoolRow[],
	sample: number,
	seed: string,
): Allocation {
	// One shuffle, used by both phases: it breaks ties without an index bias,
	// and it fixes the within-cell order the proportional phase draws in.
	const order = shuffle([...pool], createRng(seed));

	const byCell = new Map<string, PoolRow[]>();
	for (const g of order) {
		const key = cellKey(g);
		const held = byCell.get(key);
		if (held) held.push(g);
		else byCell.set(key, [g]);
	}

	const required = new Set<string>();
	for (const g of pool) for (const r of requirements(g)) required.add(r);

	const covered = new Set<string>();
	const picked = new Set<string>();
	const picks: Pick[] = [];

	// Phase 1 — the coverage floor. Greedy set cover: take the game that adds
	// the most uncovered requirements, until nothing adds any (every cell and
	// every dimension value is represented) or the sample runs out.
	while (picks.length < sample) {
		let best: PoolRow | null = null;
		let bestFresh: string[] = [];
		for (const g of order) {
			if (picked.has(g.game_id)) continue;
			const fresh = requirements(g).filter((r) => !covered.has(r));
			if (fresh.length > bestFresh.length) {
				best = g;
				bestFresh = fresh;
			}
		}
		if (best === null) break;
		picks.push({ game: best, kind: "coverage", covers: bestFresh });
		picked.add(best.game_id);
		for (const r of bestFresh) covered.add(r);
	}

	// Phase 2 — proportional for what is left. Highest averages (D'Hondt) over
	// cell size, counting the floor's picks, so a cell holding two thirds of
	// the corpus ends up with roughly two thirds of the slots the floor did not
	// claim. A cell with no unpicked game left simply stops competing, which is
	// what makes the apportionment need no leftover pass.
	const takenIn = new Map<string, number>();
	for (const p of picks) {
		const key = cellKey(p.game);
		takenIn.set(key, (takenIn.get(key) ?? 0) + 1);
	}
	while (picks.length < sample) {
		let best: { key: string; next: PoolRow; score: number } | null = null;
		for (const [key, games] of byCell) {
			const next = games.find((g) => !picked.has(g.game_id));
			if (next === undefined) continue;
			const score = games.length / ((takenIn.get(key) ?? 0) + 1);
			// Ties resolve on the cell key rather than on Map order, which the
			// shuffle would otherwise make the tie-break.
			if (
				best === null ||
				score > best.score ||
				(score === best.score && key < best.key)
			) {
				best = { key, next, score };
			}
		}
		if (best === null) break;
		picks.push({ game: best.next, kind: "proportional", covers: [] });
		picked.add(best.next.game_id);
		takenIn.set(best.key, (takenIn.get(best.key) ?? 0) + 1);
	}

	return {
		picks,
		uncovered: [...required].filter((r) => !covered.has(r)).sort(),
		cells: byCell.size,
		singletonCells: [...byCell.values()].filter((g) => g.length === 1).length,
	};
}

// ---------- file names ----------

// `map_size` and `victory_type` are stored as their full zTypes —
// MAPSIZE_SMALLEST, VICTORY_CONQUEST — where `game_mode` is stored bare.
// Dropped from file names only: the report and the manifest keep the stored
// value, because that is what a query against D1 would use, but a name
// carrying the prefix twice stops being readable. Listed rather than inferred
// by cutting at the first underscore, which would turn SINGLE_PLAYER into
// "player".
const FILE_NAME_PREFIXES = ["MAPSIZE_", "VICTORY_"];

function slug(value: string | null): string {
	let raw = value ?? UNKNOWN_SLUG;
	for (const prefix of FILE_NAME_PREFIXES) {
		if (raw.startsWith(prefix)) raw = raw.slice(prefix.length);
	}
	const cleaned = raw
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return cleaned === "" ? UNKNOWN_SLUG : cleaned;
}

// The shape in the name, so `ls` answers what the corpus covers without
// unzipping anything, and the game id last so a re-run recognizes its own
// output. `map_class` is left out — it is in the manifest, and four fields is
// already the length of a save's own name. The id keeps its case: a nanoid is
// case-sensitive.
const fileName = (g: PoolRow): string =>
	`${slug(g.game_mode)}-${slug(g.map_size)}-${slug(g.victory_type)}` +
	`-t${g.total_turns}-${g.game_id}.zip`;

// ---------- pull ----------

type PullStatus =
	// Downloaded on this run.
	| "pulled"
	// Already in the out directory from an earlier run — read off disk, no
	// remote read spent.
	| "present"
	// R2 holds no object for this game. Both other sweeps report the same miss.
	| "missing";

interface PullResult {
	pick: Pick;
	status: PullStatus;
	file: string | null;
	bytes: number | null;
	gameVersion: string | null;
	mods: string[] | null;
	// A save that landed but would not parse. Worth knowing before a
	// measurement is built on this corpus, so it is reported rather than
	// retried.
	parseError: string | null;
}

async function pullOne(
	pick: Pick,
	outDir: string,
	cacheDir: string,
): Promise<PullResult> {
	const name = fileName(pick.game);
	const dest = resolve(outDir, name);
	const result: PullResult = {
		pick,
		status: "pulled",
		file: name,
		bytes: null,
		gameVersion: null,
		mods: null,
		parseError: null,
	};

	// The destination is its own resume marker: a name is a function of the
	// game's D1 columns, so the same game always lands under the same name, and
	// a re-run after the download cache was cleaned still costs nothing. An
	// interrupted write can leave a zero-byte file, which must not count as a
	// hit — the same guard `readCachedSave` applies to its cache.
	let save: CachedSave;
	if (existsSync(dest) && (await stat(dest)).size > 0) {
		save = await readSaveFile(dest);
		result.status = "present";
	} else {
		const fetched = await readCachedSave(pick.game.game_id, cacheDir);
		if (!fetched) return { ...result, status: "missing", file: null };
		await writeFile(dest, fetched.zip);
		save = fetched;
	}
	result.bytes = save.zip.byteLength;

	// The second pass, in the same worker: the bytes are already here, and the
	// build version and mod list are only in the save. Through the real parser
	// rather than a regex over the Root attributes — `extractAllGameData` is
	// what the browser and the reparse sweep run, so the strings reported are
	// the ones an upload of this save would store, and a save this corpus
	// cannot parse surfaces here rather than in whatever measurement reads it
	// next.
	try {
		const data = extractAllGameData(
			parseSaveXml(save.xml),
			parseActivePlayerIndex(save.xml),
			save.entryName,
		);
		result.gameVersion = data.match_metadata.game_version;
		result.mods = data.match_metadata.enabled_mods?.split("+") ?? [];
	} catch (e) {
		result.parseError = e instanceof Error ? e.message : String(e);
	}
	return result;
}

// ---------- reporting ----------

interface SpreadRow {
	value: string;
	pool: number;
	drawn: number;
}

function spread(
	pool: readonly PoolRow[],
	drawn: readonly PoolRow[],
	d: Dimension,
): SpreadRow[] {
	const counts = new Map<string, SpreadRow>();
	const bump = (g: PoolRow, field: "pool" | "drawn"): void => {
		const value = d.value(g);
		const row = counts.get(value) ?? { value, pool: 0, drawn: 0 };
		row[field]++;
		counts.set(value, row);
	};
	for (const g of pool) bump(g, "pool");
	for (const g of drawn) bump(g, "drawn");
	return [...counts.values()].sort(
		(a, b) => b.pool - a.pool || a.value.localeCompare(b.value),
	);
}

interface CountRow {
	value: string;
	games: number;
}

function tally(values: readonly string[]): CountRow[] {
	const counts = new Map<string, number>();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	return [...counts.entries()]
		.map(([value, games]) => ({ value, games }))
		.sort((a, b) => b.games - a.games || a.value.localeCompare(b.value));
}

// Build versions read oldest-first, which is neither alphabetical nor by
// count: as a string, `1.0.84365` sorts before `1.0.9`.
function compareVersions(a: string, b: string): number {
	const pa = a.split(".");
	const pb = b.split(".");
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const na = Number(pa[i]);
		const nb = Number(pb[i]);
		if (Number.isFinite(na) && Number.isFinite(nb)) {
			if (na !== nb) return na - nb;
		} else {
			const cmp = (pa[i] ?? "").localeCompare(pb[i] ?? "");
			if (cmp !== 0) return cmp;
		}
	}
	return 0;
}

function printSpreads(
	pool: readonly PoolRow[],
	drawn: readonly PoolRow[],
	drawnHeader: string,
): void {
	const columns: Column[] = [
		{ header: "Value", width: 30 },
		{ header: "Pool", width: 6, align: "right" },
		{ header: drawnHeader, width: 7, align: "right" },
	];
	for (const d of DIMENSIONS) {
		process.stdout.write(`\n${bold(d.key)}\n`);
		printTable(
			columns,
			spread(pool, drawn, d).map((r) => [
				trunc(r.value, 30),
				String(r.pool),
				String(r.drawn),
			]),
		);
	}
}

// The primary strata, one row per cell. Printed by --dry-run only: it is the
// allocation an operator checks before spending a remote read per pick, where
// a finished run is read for the spread it actually achieved.
function printCells(pool: readonly PoolRow[], drawn: readonly PoolRow[]): void {
	const counts = new Map<string, { pool: number; drawn: number }>();
	for (const g of pool) {
		const row = counts.get(cellKey(g)) ?? { pool: 0, drawn: 0 };
		row.pool++;
		counts.set(cellKey(g), row);
	}
	for (const g of drawn) {
		// Every drawn game came out of the pool, so its cell is already here.
		const row = counts.get(cellKey(g));
		if (row) row.drawn++;
	}
	process.stdout.write(`\n${bold("game_mode × map_size × victory_type")}\n`);
	printTable(
		[
			{ header: "Mode", width: 20 },
			{ header: "Size", width: 18 },
			{ header: "Victory", width: 20 },
			{ header: "Pool", width: 6, align: "right" },
			{ header: "Drawn", width: 7, align: "right" },
		],
		[...counts.entries()]
			.sort((a, b) => b[1].pool - a[1].pool || a[0].localeCompare(b[0]))
			.map(([key, row]) => {
				const [mode, size, victory] = key.split("|");
				return [
					trunc(mode, 20),
					trunc(size, 18),
					trunc(victory, 20),
					String(row.pool),
					String(row.drawn),
				];
			}),
	);
}

// Shape columns only — no uploader, no game name (a game name carries the
// players' handles: "alcaras v Siontific g1").
function shapeJson(g: PoolRow): Record<string, unknown> {
	return {
		game_id: g.game_id,
		xml_game_id: g.xml_game_id,
		game_mode: g.game_mode,
		map_size: g.map_size,
		map_class: g.map_class,
		victory_type: g.victory_type,
		total_turns: g.total_turns,
		turn_band: turnBand(g.total_turns),
		parser_version: g.parser_version,
	};
}

function dimensionJson(
	pool: readonly PoolRow[],
	drawn: readonly PoolRow[],
): Record<string, SpreadRow[]> {
	const out: Record<string, SpreadRow[]> = {};
	for (const d of DIMENSIONS) out[d.key] = spread(pool, drawn, d);
	return out;
}

// ---------- the command ----------

interface PullFlags {
	sample: number;
	seed: string;
	outDir: string;
	cacheDir: string;
	concurrency: number;
	dryRun: boolean;
}

function readPullFlags(args: string[]): PullFlags {
	const { flags } = parseFlags(args);
	let sample = DEFAULT_SAMPLE;
	if (flags.sample !== undefined) {
		// flagInt falls back for a bare `--sample`, `--sample 0` and
		// `--sample abc`, and silently drawing the default 100 when an operator
		// asked for something else is the one case worth refusing.
		sample = flagInt(flags, "sample", 0);
		if (sample <= 0) throw new Error("--sample takes a positive integer");
	}
	return {
		sample,
		seed: flagString(flags, "seed") ?? DEFAULT_SEED,
		outDir: resolve(flagString(flags, "out") ?? DEFAULT_OUT),
		cacheDir: resolve(
			flagString(flags, "cache-dir") ??
				resolve(tmpdir(), "per-ankh-pull-saves"),
		),
		concurrency: flagInt(flags, "concurrency", DEFAULT_CONCURRENCY),
		dryRun: flags["dry-run"] !== undefined,
	};
}

function summary(
	pool: Pool,
	allocation: Allocation,
	flags: PullFlags,
): Record<string, unknown> {
	return {
		seed: flags.seed,
		sample: flags.sample,
		pool: {
			rows: pool.rows,
			games: pool.games.length,
			collapsed: pool.collapsed,
			cells: allocation.cells,
			singleton_cells: allocation.singletonCells,
		},
		allocation: {
			coverage: allocation.picks.filter((p) => p.kind === "coverage").length,
			proportional: allocation.picks.filter((p) => p.kind === "proportional")
				.length,
			uncovered_requirements: allocation.uncovered,
		},
	};
}

async function runPull(args: string[], opts: CommandOpts): Promise<void> {
	const flags = readPullFlags(args);

	const pool = await loadPool();
	if (pool.games.length === 0) {
		warn(`No games in ${getTarget()} D1 to draw from.`);
		return;
	}
	const allocation = allocate(pool.games, flags.sample, flags.seed);
	const coverage = allocation.picks.filter((p) => p.kind === "coverage").length;
	const drawn = allocation.picks.map((p) => p.game);

	info(
		`Pool: ${pool.games.length} games from ${pool.rows} rows ` +
			`(${pool.collapsed} duplicate upload(s) collapsed on xml_game_id)`,
	);
	info(
		`${allocation.cells} cells over game_mode × map_size × victory_type, ` +
			`${allocation.singletonCells} holding one game`,
	);
	info(
		`Draw: ${allocation.picks.length} of ${flags.sample} requested — ` +
			`${coverage} for coverage, ${allocation.picks.length - coverage} ` +
			`proportional (seed ${flags.seed})`,
	);
	if (allocation.uncovered.length > 0) {
		warn(
			`--sample ${flags.sample} is below the coverage floor: ` +
				`${allocation.uncovered.length} requirement(s) unrepresented, ` +
				`starting with ${allocation.uncovered.slice(0, 5).join(", ")}. ` +
				`Raise --sample to reach them.`,
		);
	}

	if (flags.dryRun) {
		if (opts.json) {
			printJson({
				target: getTarget(),
				dry_run: true,
				...summary(pool, allocation, flags),
				dimensions: dimensionJson(pool.games, drawn),
				saves: allocation.picks.map((p) => ({
					file: fileName(p.game),
					...shapeJson(p.game),
					reason: p.kind,
					picked_for: p.covers,
				})),
			});
			return;
		}
		printSpreads(pool.games, drawn, "Drawn");
		printCells(pool.games, drawn);
		process.stdout.write(
			`\n${bold(`${allocation.picks.length} saves would be pulled`)} into ${flags.outDir}\n` +
				`${dim("nothing downloaded — drop --dry-run to pull them")}\n`,
		);
		return;
	}

	if (isLocal()) {
		warn(
			"Targeting local .wrangler state: its R2 bucket holds only saves " +
				"uploaded locally, so picks the cloud has may report as missing.",
		);
	}

	await mkdir(flags.outDir, { recursive: true });
	await mkdir(flags.cacheDir, { recursive: true });
	info(
		`Pulling into ${flags.outDir} (${flags.concurrency} at a time), ` +
			`cache: ${flags.cacheDir}`,
	);

	// Written by index rather than appended: the workers finish out of order,
	// and the manifest has to be a function of the seed alone or two runs of
	// the same draw produce different files.
	const slots: Array<PullResult | null> = allocation.picks.map(() => null);
	const errors: Array<{ game_id: string; error: string }> = [];
	await mapLimit(allocation.picks, flags.concurrency, async (pick, i) => {
		try {
			slots[i] = await pullOne(pick, flags.outDir, flags.cacheDir);
		} catch (e) {
			errors.push({
				game_id: pick.game.game_id,
				error: e instanceof Error ? e.message : String(e),
			});
		}
		if ((i + 1) % 10 === 0) info(`  …${i + 1}/${allocation.picks.length}`);
	});
	const results = slots.filter((r): r is PullResult => r !== null);
	errors.sort((a, b) => a.game_id.localeCompare(b.game_id));

	const landed = results.filter((r) => r.status !== "missing");
	const present = landed.filter((r) => r.status === "present");
	const missing = results.filter((r) => r.status === "missing");
	const unparseable = landed.filter((r) => r.parseError !== null);
	const bytes = landed.reduce((sum, r) => sum + (r.bytes ?? 0), 0);

	// Only the saves that parsed carry a build version, so a parse failure is
	// counted as a failure rather than as a game with no version attribute.
	const parsed = landed.filter((r) => r.parseError === null);
	const versions = tally(parsed.map((r) => r.gameVersion ?? NULL_LABEL)).sort(
		(a, b) => compareVersions(a.value, b.value),
	);
	const mods = tally(parsed.flatMap((r) => r.mods ?? []));
	const unmodded = parsed.filter((r) => r.mods?.length === 0).length;

	const manifestPath = resolve(flags.outDir, MANIFEST_NAME);
	const manifest = {
		generated_at: new Date().toISOString(),
		target: getTarget(),
		...summary(pool, allocation, flags),
		totals: {
			landed: landed.length,
			downloaded: landed.length - present.length,
			already_present: present.length,
			missing: missing.length,
			unparseable: unparseable.length,
			errored: errors.length,
			bytes,
		},
		dimensions: dimensionJson(
			pool.games,
			landed.map((r) => r.pick.game),
		),
		game_versions: versions,
		mods,
		unmodded_games: unmodded,
		missing_game_ids: missing.map((r) => r.pick.game.game_id),
		errors,
		saves: results.map((r) => ({
			file: r.file,
			...shapeJson(r.pick.game),
			reason: r.pick.kind,
			picked_for: r.pick.covers,
			status: r.status,
			bytes: r.bytes,
			game_version: r.gameVersion,
			mods: r.mods,
			parse_error: r.parseError,
		})),
	};
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

	for (const e of errors) warn(`${e.game_id}: ${e.error}`);
	for (const r of unparseable)
		warn(`${r.file}: did not parse — ${r.parseError}`);
	if (missing.length > 0) {
		warn(`${missing.length} pick(s) had no object in R2 — ids in the manifest`);
	}

	if (opts.json) {
		printJson(manifest);
		return;
	}

	printSpreads(
		pool.games,
		landed.map((r) => r.pick.game),
		"Pulled",
	);
	process.stdout.write(`\n${bold("game_version")}\n`);
	printTable(
		[
			{ header: "Build", width: 30 },
			{ header: "Games", width: 7, align: "right" },
		],
		versions.map((v) => [v.value, String(v.games)]),
	);
	process.stdout.write(`\n${bold("mods")}\n`);
	printTable(
		[
			{ header: "Mod", width: 44 },
			{ header: "Games", width: 7, align: "right" },
		],
		[
			["(none)", String(unmodded)],
			...mods.map((m) => [trunc(m.value, 44), String(m.games)]),
		],
	);

	// Every other archive sitting in the directory — hand-copied saves, an
	// earlier draw under another seed, the zero-byte remains of an interrupted
	// write. Counted rather than pruned: deleting someone's corpus is not this
	// command's call, and the next run overwrites what it needs.
	const others = (await readdir(flags.outDir)).filter(
		(f) => f.endsWith(".zip") && !landed.some((r) => r.file === f),
	).length;

	ok(
		`${landed.length} save(s) in ${flags.outDir}, ${formatBytes(bytes)} ` +
			`(${landed.length - present.length} downloaded, ${present.length} ` +
			`already there)`,
	);
	process.stdout.write(
		`${dim(
			`missing ${missing.length}, unparseable ${unparseable.length}, ` +
				`errored ${errors.length}\n` +
				`the directory holds ${others} further zip(s)\n` +
				`manifest: ${manifestPath}`,
		)}\n`,
	);
	if (errors.length > 0) process.exitCode = 1;
}

function printHelp(): void {
	process.stdout.write(
		[
			"./per-ankh admin saves <subcommand>",
			"",
			"  pull [--sample N] [--seed S] [--out DIR] [--dry-run]",
			"       [--concurrency N] [--cache-dir DIR]",
			"        Draw a stratified sample of games and write their original",
			"        save ZIPs into test-data/saves/, with a manifest.",
			"",
			`  --sample       How many saves to pull (default ${DEFAULT_SAMPLE})`,
			`  --seed         Fixes the draw (default "${DEFAULT_SEED}")`,
			"  --out          Destination directory (default test-data/saves/)",
			"  --dry-run      Print the allocation without downloading anything",
			`  --concurrency  Saves in flight (default ${DEFAULT_CONCURRENCY})`,
			"  --cache-dir    Where downloads are kept (default under $TMPDIR)",
			"",
		].join("\n"),
	);
}

export async function run(argv: string[], opts: CommandOpts): Promise<void> {
	const sub = argv[0];
	const rest = argv.slice(1);
	switch (sub) {
		case "pull":
			return runPull(rest, opts);
		case undefined:
		case "--help":
		case "-h":
			printHelp();
			return;
		default:
			throw new Error(`Unknown saves subcommand: ${sub}`);
	}
}
