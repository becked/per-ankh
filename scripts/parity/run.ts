// Parser parity driver.
//
// Enumerates a corpus of save files, runs Rust + TS dumps + diff per save
// (parallelized across saves), aggregates a CorpusReport. See
// docs/cloud-rewrite-spec.md §2 for design.
//
// Usage:
//   tsx scripts/parity/run.ts \
//     --corpus <dir> [--corpus <dir>]... \
//     --out    <reports-dir> \
//     --manifest scripts/parity/parity.config.json \
//     [--smoke | --full] \
//     [--mode rust-vs-ts | rust-vs-rust | ts-vs-ts] \
//     [--concurrency N] \
//     [--filter <substring>] \
//     [--no-cache]

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { availableParallelism, cpus, tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
	cachePath,
	readCachedDump,
	sha256File,
	sha256Of,
	writeCachedDump,
} from "./cache.js";
import type {
	CorpusReport,
	DiffCategory,
	PerSaveReport,
	SaveStatus,
} from "./types.js";

type Mode = "rust-vs-ts" | "rust-vs-rust" | "ts-vs-ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const SRC_TAURI = join(REPO_ROOT, "src-tauri");
const RUST_BIN = join(SRC_TAURI, "target", "release", "dump_parsed");
const SMOKE_LIST = join(__dirname, "smoke-saves.txt");
const DEFAULT_REPORTS_DIR = join(__dirname, "reports");
const CACHE_DIR = join(REPO_ROOT, ".cache", "parity");

interface CliArgs {
	corpus: string[];
	out: string;
	manifest: string;
	smoke: boolean;
	full: boolean;
	smokeList: string;
	mode: Mode;
	concurrency: number;
	filter: string | null;
	noCache: boolean;
}

function parseArgs(argv: string[]): CliArgs {
	const a: CliArgs = {
		corpus: [],
		out: DEFAULT_REPORTS_DIR,
		manifest: join(__dirname, "parity.config.json"),
		smoke: false,
		full: false,
		smokeList: SMOKE_LIST,
		mode: "rust-vs-ts",
		concurrency: defaultConcurrency(),
		filter: null,
		noCache: false,
	};
	const it = argv[Symbol.iterator]();
	for (let next = it.next(); !next.done; next = it.next()) {
		const arg = next.value;
		const need = (label: string): string => {
			const v = it.next();
			if (v.done) throw new Error(`${label} requires a value`);
			return v.value;
		};
		switch (arg) {
			case "--corpus":
				a.corpus.push(need("--corpus"));
				break;
			case "--out":
				a.out = need("--out");
				break;
			case "--manifest":
				a.manifest = need("--manifest");
				break;
			case "--smoke":
				a.smoke = true;
				break;
			case "--smoke-list":
				a.smokeList = need("--smoke-list");
				a.smoke = true;
				break;
			case "--full":
				a.full = true;
				break;
			case "--mode": {
				const m = need("--mode");
				if (m !== "rust-vs-ts" && m !== "rust-vs-rust" && m !== "ts-vs-ts") {
					throw new Error(`--mode must be one of rust-vs-ts, rust-vs-rust, ts-vs-ts (got ${m})`);
				}
				a.mode = m;
				break;
			}
			case "--concurrency":
				a.concurrency = Number(need("--concurrency"));
				break;
			case "--filter":
				a.filter = need("--filter");
				break;
			case "--no-cache":
				a.noCache = true;
				break;
			case "-h":
			case "--help":
				console.error(
					"usage: run.ts --corpus <dir> [--corpus <dir>]... [--out DIR] [--manifest PATH] [--smoke|--full] [--smoke-list PATH] [--mode rust-vs-ts|rust-vs-rust|ts-vs-ts] [--concurrency N] [--filter SUBSTR] [--no-cache]",
				);
				process.exit(0);
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
	}
	if (a.smoke && a.full) throw new Error("pick one of --smoke or --full");
	if (!a.smoke && !a.full) a.smoke = true; // default to smoke
	if (a.full && a.corpus.length === 0) {
		throw new Error("--full requires at least one --corpus <dir>");
	}
	return a;
}

function defaultConcurrency(): number {
	const cores = (availableParallelism?.() ?? cpus().length) || 4;
	return Math.max(1, Math.min(6, Math.floor(cores / 2)));
}

async function listSaves(args: CliArgs): Promise<string[]> {
	let candidates: string[] = [];
	if (args.smoke) {
		if (!existsSync(args.smokeList)) {
			throw new Error(
				`smoke list ${args.smokeList} does not exist. Create it with one save path per line (relative paths resolve from the repo root).`,
			);
		}
		const raw = await readFile(args.smokeList, "utf8");
		candidates = raw
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("#"))
			.map((l) => resolve(REPO_ROOT, l));
	} else {
		for (const dir of args.corpus) {
			const absDir = resolve(REPO_ROOT, dir);
			candidates.push(...(await walkZips(absDir)));
		}
	}
	if (args.filter) {
		const f = args.filter;
		candidates = candidates.filter((c) => c.includes(f));
	}
	return candidates;
}

async function walkZips(dir: string): Promise<string[]> {
	const out: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const ent of entries) {
		const p = join(dir, ent.name);
		if (ent.isDirectory()) {
			out.push(...(await walkZips(p)));
		} else if (ent.isFile() && extname(p).toLowerCase() === ".zip") {
			out.push(p);
		}
	}
	return out;
}

/**
 * SHA over a set of source files. Used as the cache key for either side's
 * dumper so cached dumps invalidate when source changes.
 */
async function shaOverFiles(files: string[]): Promise<string> {
	const h = createHash("sha256");
	for (const f of files.slice().sort()) {
		h.update(f);
		try {
			h.update(await readFile(f));
		} catch {
			// File missing — include the absence in the hash so re-creating
			// the file later invalidates the cache.
			h.update("MISSING");
		}
	}
	return h.digest("hex");
}

async function rustSourceSha(): Promise<string> {
	const files = [
		join(SRC_TAURI, "src", "bin", "dump_parsed.rs"),
		...(await collectFiles(join(SRC_TAURI, "src", "parser"), ".rs")),
	];
	return shaOverFiles(files);
}

async function tsSourceSha(): Promise<string> {
	const files = [
		join(__dirname, "dump.ts"),
		...(await collectFiles(join(REPO_ROOT, "src", "lib", "parser"), ".ts")),
	];
	return shaOverFiles(files);
}

async function collectFiles(root: string, extension: string): Promise<string[]> {
	const out: string[] = [];
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const ent of entries) {
		const p = join(root, ent.name);
		if (ent.isDirectory()) {
			out.push(...(await collectFiles(p, extension)));
		} else if (ent.isFile() && extname(p) === extension) {
			out.push(p);
		}
	}
	return out;
}

async function manifestSha(manifestPath: string): Promise<string> {
	return sha256Of(await readFile(manifestPath, "utf8"));
}

interface RunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

function run(cmd: string, args: string[], cwd?: string): Promise<RunResult> {
	return new Promise((resolveP, rejectP) => {
		const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => (stdout += d.toString()));
		child.stderr.on("data", (d) => (stderr += d.toString()));
		child.on("error", rejectP);
		child.on("close", (code) =>
			resolveP({ exitCode: code ?? 1, stdout, stderr }),
		);
	});
}

async function ensureRustBinBuilt(): Promise<void> {
	const result = await run(
		"cargo",
		["build", "--release", "--bin", "dump_parsed"],
		SRC_TAURI,
	);
	if (result.exitCode !== 0) {
		throw new Error(
			`cargo build failed (exit ${result.exitCode}):\n${result.stderr}`,
		);
	}
	if (!existsSync(RUST_BIN)) {
		throw new Error(`expected dump_parsed binary at ${RUST_BIN}, not found`);
	}
}

interface DumpOutcome {
	dumpPath: string;
	durationMs: number;
	cached: boolean;
}

async function rustDump(
	savePath: string,
	saveSha: string,
	rustSha: string,
	tmpDir: string,
	useCache: boolean,
): Promise<DumpOutcome> {
	const cacheFile = cachePath(CACHE_DIR, {
		side: "rust",
		dumperSha: rustSha,
		saveSha,
	});
	if (useCache) {
		const cached = await readCachedDump(cacheFile);
		if (cached !== null) {
			// Materialize the cached JSON to a tmp file the diff can read.
			const out = join(tmpDir, `rust-${saveSha}.json`);
			await writeFile(out, JSON.stringify(cached));
			return { dumpPath: out, durationMs: 0, cached: true };
		}
	}
	const out = join(tmpDir, `rust-${saveSha}-${Date.now()}.json`);
	const t0 = Date.now();
	const result = await run(RUST_BIN, ["--save", savePath, "--out", out]);
	const durationMs = Date.now() - t0;
	if (result.exitCode !== 0) {
		throw new Error(
			`dump_parsed failed for ${savePath} (exit ${result.exitCode}):\n${result.stderr}`,
		);
	}
	if (useCache) {
		const value = JSON.parse(await readFile(out, "utf8"));
		await writeCachedDump(cacheFile, value);
	}
	return { dumpPath: out, durationMs, cached: false };
}

async function tsDump(
	savePath: string,
	saveSha: string,
	tsSha: string,
	manifestPath: string,
	tmpDir: string,
	useCache: boolean,
): Promise<DumpOutcome> {
	const cacheFile = cachePath(CACHE_DIR, {
		side: "ts",
		dumperSha: tsSha,
		saveSha,
	});
	if (useCache) {
		const cached = await readCachedDump(cacheFile);
		if (cached !== null) {
			const out = join(tmpDir, `ts-${saveSha}.json`);
			await writeFile(out, JSON.stringify(cached));
			return { dumpPath: out, durationMs: 0, cached: true };
		}
	}
	const out = join(tmpDir, `ts-${saveSha}-${Date.now()}.json`);
	const t0 = Date.now();
	const result = await run("npx", [
		"tsx",
		join(__dirname, "dump.ts"),
		"--save",
		savePath,
		"--out",
		out,
		"--manifest",
		manifestPath,
	]);
	const durationMs = Date.now() - t0;
	if (result.exitCode !== 0) {
		throw new Error(
			`tsx dump.ts failed for ${savePath} (exit ${result.exitCode}):\n${result.stderr}`,
		);
	}
	if (useCache) {
		const value = JSON.parse(await readFile(out, "utf8"));
		await writeCachedDump(cacheFile, value);
	}
	return { dumpPath: out, durationMs, cached: false };
}

async function runDiff(
	rustDumpPath: string,
	tsDumpPath: string,
	manifestPath: string,
	outPath: string,
	provenance: {
		rustBinSha: string;
		tsSourceSha: string;
		manifestSha: string;
		rustDumpMs: number;
		tsDumpMs: number;
	},
): Promise<void> {
	const result = await run("npx", [
		"tsx",
		join(__dirname, "diff.ts"),
		"--rust",
		rustDumpPath,
		"--ts",
		tsDumpPath,
		"--manifest",
		manifestPath,
		"--out",
		outPath,
		"--rust-bin-sha",
		provenance.rustBinSha,
		"--ts-source-sha",
		provenance.tsSourceSha,
		"--manifest-sha",
		provenance.manifestSha,
		"--rust-dump-ms",
		String(provenance.rustDumpMs),
		"--ts-dump-ms",
		String(provenance.tsDumpMs),
	]);
	// diff.ts exits 1 on diff (status=fail), 0 on pass, 2 on internal error.
	if (result.exitCode === 2) {
		throw new Error(`diff.ts internal error:\n${result.stderr}`);
	}
}

interface SaveTask {
	savePath: string;
	saveSha: string;
	saveSizeBytes: number;
}

async function processSave(
	task: SaveTask,
	args: CliArgs,
	provenance: {
		rustBinSha: string;
		tsSourceSha: string;
		manifestSha: string;
	},
	perSaveDir: string,
	tmpDir: string,
): Promise<{ report: PerSaveReport; saveTask: SaveTask }> {
	// In same-side modes (rust-rust, ts-ts), bypass cache for at least one
	// side so the diff exercises real determinism rather than diffing a
	// JSON against itself.
	const useCacheRust =
		!args.noCache && args.mode !== "rust-vs-rust" && args.mode !== "ts-vs-ts";
	const useCacheTs = !args.noCache && args.mode !== "ts-vs-ts" && args.mode !== "rust-vs-rust";

	let rustOutA: DumpOutcome;
	let rustOutB: DumpOutcome | null = null;
	let tsOutA: DumpOutcome;
	let tsOutB: DumpOutcome | null = null;

	if (args.mode === "rust-vs-rust") {
		rustOutA = await rustDump(
			task.savePath,
			task.saveSha,
			provenance.rustBinSha,
			tmpDir,
			false,
		);
		rustOutB = await rustDump(
			task.savePath,
			task.saveSha,
			provenance.rustBinSha,
			tmpDir,
			false,
		);
		tsOutA = { dumpPath: rustOutA.dumpPath, durationMs: 0, cached: false };
	} else if (args.mode === "ts-vs-ts") {
		tsOutA = await tsDump(
			task.savePath,
			task.saveSha,
			provenance.tsSourceSha,
			args.manifest,
			tmpDir,
			false,
		);
		tsOutB = await tsDump(
			task.savePath,
			task.saveSha,
			provenance.tsSourceSha,
			args.manifest,
			tmpDir,
			false,
		);
		rustOutA = { dumpPath: tsOutA.dumpPath, durationMs: 0, cached: false };
	} else {
		// rust-vs-ts (default)
		rustOutA = await rustDump(
			task.savePath,
			task.saveSha,
			provenance.rustBinSha,
			tmpDir,
			useCacheRust,
		);
		tsOutA = await tsDump(
			task.savePath,
			task.saveSha,
			provenance.tsSourceSha,
			args.manifest,
			tmpDir,
			useCacheTs,
		);
	}

	const leftPath = rustOutA.dumpPath;
	const rightPath =
		args.mode === "rust-vs-rust"
			? (rustOutB as DumpOutcome).dumpPath
			: args.mode === "ts-vs-ts"
				? (tsOutB as DumpOutcome).dumpPath
				: tsOutA.dumpPath;

	const stem = basename(task.savePath, extname(task.savePath));
	const reportPath = join(perSaveDir, `${stem}.json`);

	const rustDumpMs =
		args.mode === "ts-vs-ts" ? 0 : (rustOutB?.durationMs ?? rustOutA.durationMs);
	const tsDumpMs =
		args.mode === "rust-vs-rust" ? 0 : (tsOutB?.durationMs ?? tsOutA.durationMs);

	try {
		await runDiff(leftPath, rightPath, args.manifest, reportPath, {
			rustBinSha: provenance.rustBinSha,
			tsSourceSha: provenance.tsSourceSha,
			manifestSha: provenance.manifestSha,
			rustDumpMs,
			tsDumpMs,
		});
	} catch (err) {
		// Build an error report rather than aborting the whole corpus.
		const stub: PerSaveReport = {
			schemaVersion: 1,
			save: {
				path: task.savePath,
				sha256: task.saveSha,
				sizeBytes: task.saveSizeBytes,
			},
			rustBinSha: provenance.rustBinSha,
			tsSourceSha: provenance.tsSourceSha,
			manifestSha: provenance.manifestSha,
			startedAt: new Date().toISOString(),
			durationMs: { rustDump: rustDumpMs, tsDump: tsDumpMs, diff: 0 },
			status: "error",
			errorMessage: err instanceof Error ? err.message : String(err),
			diffCount: 0,
			perEntity: {},
			diffs: [],
		};
		await mkdir(dirname(reportPath), { recursive: true });
		await writeFile(reportPath, JSON.stringify(stub, null, 2));
		return { report: stub, saveTask: task };
	}

	const report = JSON.parse(await readFile(reportPath, "utf8")) as PerSaveReport;
	return { report, saveTask: task };
}

/** Replace numeric path segments with "*" for corpus-level aggregation. */
function normalizePath(path: string): string {
	return path
		.split("/")
		.map((seg) => (/^\d+$/.test(seg) ? "*" : seg))
		.join("/");
}

async function pool<T, R>(
	items: T[],
	concurrency: number,
	worker: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let cursor = 0;
	const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
		while (true) {
			const idx = cursor++;
			if (idx >= items.length) return;
			results[idx] = await worker(items[idx], idx);
		}
	});
	await Promise.all(runners);
	return results;
}

function color(code: number, s: string): string {
	if (!process.stdout.isTTY) return s;
	return `\x1b[${code}m${s}\x1b[0m`;
}
const green = (s: string) => color(32, s);
const red = (s: string) => color(31, s);
const yellow = (s: string) => color(33, s);
const dim = (s: string) => color(2, s);

function summarizeReport(report: PerSaveReport): string {
	const stem = basename(report.save.path);
	const tag =
		report.status === "pass"
			? green("PASS")
			: report.status === "error"
				? yellow("ERR ")
				: red("FAIL");
	const failing = Object.entries(report.perEntity)
		.filter(([, v]) => v.status === "fail" || v.status === "not_implemented")
		.map(([k]) => k);
	const failPart = failing.length
		? ` ${dim("failing: " + failing.slice(0, 5).join(", ") + (failing.length > 5 ? `, +${failing.length - 5} more` : ""))}`
		: "";
	return `${tag} ${stem} ${dim(`(${report.diffCount} diffs)`)}${failPart}`;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const startedAt = new Date().toISOString();
	console.error(`mode=${args.mode} concurrency=${args.concurrency}`);

	if (args.mode !== "ts-vs-ts") {
		console.error("Building dump_parsed (release)…");
		await ensureRustBinBuilt();
	}

	const [rustBinSha, tsSourceShaVal, manifestShaVal] = await Promise.all([
		args.mode === "ts-vs-ts" ? Promise.resolve("") : rustSourceSha(),
		args.mode === "rust-vs-rust" ? Promise.resolve("") : tsSourceSha(),
		manifestSha(args.manifest),
	]);
	const provenance = {
		rustBinSha,
		tsSourceSha: tsSourceShaVal,
		manifestSha: manifestShaVal,
	};

	const saves = await listSaves(args);
	if (saves.length === 0) {
		console.error("no save files matched");
		process.exit(1);
	}
	console.error(`enumerated ${saves.length} save files`);

	const tasks: SaveTask[] = await Promise.all(
		saves.map(async (savePath) => {
			const saveSha = await sha256File(savePath);
			const saveSizeBytes = statSync(savePath).size;
			return { savePath, saveSha, saveSizeBytes };
		}),
	);

	await mkdir(args.out, { recursive: true });
	const perSaveDir = join(args.out, "per-save");
	await mkdir(perSaveDir, { recursive: true });
	const tmpRoot = join(tmpdir(), `parity-${Date.now()}`);
	await mkdir(tmpRoot, { recursive: true });

	const reports: PerSaveReport[] = [];
	let processed = 0;
	await pool(tasks, args.concurrency, async (task) => {
		const result = await processSave(task, args, provenance, perSaveDir, tmpRoot);
		reports.push(result.report);
		processed++;
		console.error(
			`[${processed}/${tasks.length}] ${summarizeReport(result.report)}`,
		);
	});

	// Aggregate.
	const totals = { saves: reports.length, pass: 0, fail: 0, error: 0 };
	const saveStatus: Record<SaveStatus, string[]> = {
		pass: [],
		fail: [],
		error: [],
	};
	const pathFreq = new Map<
		string,
		{ category: DiffCategory; occurrences: number; saves: Set<string> }
	>();
	const entityRollup: CorpusReport["perEntity"] = {};

	for (const r of reports) {
		totals[r.status]++;
		saveStatus[r.status].push(r.save.path);
		for (const d of r.diffs) {
			const key = `${normalizePath(d.path)}::${d.category}`;
			let entry = pathFreq.get(key);
			if (!entry) {
				entry = { category: d.category, occurrences: 0, saves: new Set() };
				pathFreq.set(key, entry);
			}
			entry.occurrences++;
			entry.saves.add(r.save.path);
		}
		for (const [entKey, entVal] of Object.entries(r.perEntity)) {
			let bucket = entityRollup[entKey];
			if (!bucket) {
				bucket = {
					status: "not_ported",
					savesWithDiffs: 0,
					totalDiffs: 0,
				};
				entityRollup[entKey] = bucket;
			}
			if (entVal.status === "pass") {
				if (bucket.status === "not_ported") bucket.status = "implemented_passing";
			} else if (entVal.status === "fail" || entVal.status === "not_implemented") {
				bucket.status = "implemented_failing";
				bucket.savesWithDiffs++;
				bucket.totalDiffs += entVal.diffCount;
			}
		}
	}

	const topFailingPaths = Array.from(pathFreq.entries())
		.map(([key, v]) => {
			const sepIdx = key.lastIndexOf("::");
			const path = key.slice(0, sepIdx);
			return {
				path,
				category: v.category,
				occurrences: v.occurrences,
				affectedSaves: v.saves.size,
				exampleSaves: Array.from(v.saves).slice(0, 5),
			};
		})
		.sort((a, b) => b.occurrences - a.occurrences);

	const corpus: CorpusReport = {
		schemaVersion: 1,
		startedAt,
		finishedAt: new Date().toISOString(),
		manifest: {
			path: args.manifest,
			sha: manifestShaVal,
			implemented: JSON.parse(await readFile(args.manifest, "utf8")).implemented,
		},
		totals,
		saveStatus,
		topFailingPaths,
		perEntity: entityRollup,
	};

	const corpusPath = join(args.out, "corpus.json");
	await writeFile(corpusPath, JSON.stringify(corpus, null, 2));

	// Cleanup temp dir.
	try {
		await rm(tmpRoot, { recursive: true, force: true });
	} catch {
		// best-effort
	}

	// Terminal summary.
	console.error(
		`\n${green(String(totals.pass))} pass, ${red(String(totals.fail))} fail, ${yellow(String(totals.error))} error (${totals.saves} saves)`,
	);
	if (topFailingPaths.length > 0) {
		console.error("\ntop failing paths:");
		for (const p of topFailingPaths.slice(0, 10)) {
			console.error(
				`  ${dim(p.category.padEnd(20))} ${p.path}  (${p.occurrences} occ, ${p.affectedSaves} saves)`,
			);
		}
	}
	console.error(`\ncorpus report: ${corpusPath}`);
	process.exit(totals.fail + totals.error > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.stack ?? err.message : String(err));
	process.exit(2);
});
