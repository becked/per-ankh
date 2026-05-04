// Share-parity driver. Mirrors `run.ts` but for the whole-blob harness:
//   Rust: import_save_file → assemble_shared_game_data → JSON  (dump_shared)
//   TS:   extractAllGameData → SharedGameData-overlapping subset → JSON  (share-dump)
//   diff: share-diff
//
// Modes: --smoke (re-uses scripts/parity/smoke-saves.txt — same 10 saves
// as entity parity) or --full (walks --corpus dirs).
//
// dump_shared is more expensive than dump_parsed (each invocation creates a
// temp DuckDB and runs the full importer). With concurrency=4 the smoke run
// takes ~30s; full corpus ~5min.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { availableParallelism, cpus, tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const SRC_TAURI = join(REPO_ROOT, "src-tauri");
const RUST_BIN = join(SRC_TAURI, "target", "release", "dump_shared");
const SMOKE_LIST = join(__dirname, "smoke-saves.txt");
const DEFAULT_REPORTS_DIR = join(__dirname, "reports");

interface CliArgs {
	corpus: string[];
	out: string;
	smoke: boolean;
	full: boolean;
	concurrency: number;
	filter: string | null;
}

function parseArgs(argv: string[]): CliArgs {
	const a: CliArgs = {
		corpus: [],
		out: DEFAULT_REPORTS_DIR,
		smoke: false,
		full: false,
		concurrency: defaultConcurrency(),
		filter: null,
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
			case "--smoke":
				a.smoke = true;
				break;
			case "--full":
				a.full = true;
				break;
			case "--concurrency":
				a.concurrency = Number(need("--concurrency"));
				break;
			case "--filter":
				a.filter = need("--filter");
				break;
			case "-h":
			case "--help":
				console.error(
					"usage: share-run.ts [--smoke|--full --corpus DIR ...] [--concurrency N] [--filter SUBSTR] [--out DIR]",
				);
				process.exit(0);
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
	}
	if (a.smoke && a.full) throw new Error("pick one of --smoke or --full");
	if (!a.smoke && !a.full) a.smoke = true;
	if (a.full && a.corpus.length === 0) {
		throw new Error("--full requires at least one --corpus <dir>");
	}
	return a;
}

function defaultConcurrency(): number {
	const cores = (availableParallelism?.() ?? cpus().length) || 4;
	return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

async function listSaves(args: CliArgs): Promise<string[]> {
	let candidates: string[] = [];
	if (args.smoke) {
		const raw = await readFile(SMOKE_LIST, "utf8");
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
		["build", "--release", "--bin", "dump_shared"],
		SRC_TAURI,
	);
	if (result.exitCode !== 0) {
		throw new Error(
			`cargo build failed (exit ${result.exitCode}):\n${result.stderr}`,
		);
	}
	if (!existsSync(RUST_BIN)) {
		throw new Error(`expected dump_shared binary at ${RUST_BIN}, not found`);
	}
}

interface SaveOutcome {
	save: string;
	status: "pass" | "fail" | "error";
	diffCount: number;
	durations: { rust: number; ts: number; diff: number };
	error?: string;
	failingFields?: string[];
	reportPath: string;
}

async function processSave(
	savePath: string,
	tmpDir: string,
	reportsDir: string,
): Promise<SaveOutcome> {
	const baseName = savePath.split("/").pop() ?? savePath;
	const safeKey = baseName.replace(/\.zip$/, "").replace(/[^a-zA-Z0-9._-]/g, "_");
	const rustOut = join(tmpDir, `share-rust-${safeKey}.json`);
	const tsOut = join(tmpDir, `share-ts-${safeKey}.json`);
	const reportOut = join(reportsDir, `share-${safeKey}.json`);

	try {
		const tRust = Date.now();
		const r1 = await run(RUST_BIN, ["--save", savePath, "--out", rustOut]);
		const rustMs = Date.now() - tRust;
		if (r1.exitCode !== 0) {
			return {
				save: savePath,
				status: "error",
				diffCount: 0,
				durations: { rust: rustMs, ts: 0, diff: 0 },
				error: `dump_shared exit ${r1.exitCode}: ${r1.stderr.slice(-400)}`,
				reportPath: reportOut,
			};
		}

		const tTs = Date.now();
		const r2 = await run(
			"npx",
			[
				"tsx",
				join(__dirname, "share-dump.ts"),
				"--save",
				savePath,
				"--out",
				tsOut,
			],
			REPO_ROOT,
		);
		const tsMs = Date.now() - tTs;
		if (r2.exitCode !== 0) {
			return {
				save: savePath,
				status: "error",
				diffCount: 0,
				durations: { rust: rustMs, ts: tsMs, diff: 0 },
				error: `share-dump exit ${r2.exitCode}: ${r2.stderr.slice(-400)}`,
				reportPath: reportOut,
			};
		}

		const tDiff = Date.now();
		const r3 = await run(
			"npx",
			[
				"tsx",
				join(__dirname, "share-diff.ts"),
				"--rust",
				rustOut,
				"--ts",
				tsOut,
				"--out",
				reportOut,
			],
			REPO_ROOT,
		);
		const diffMs = Date.now() - tDiff;
		// share-diff exits 0 on pass, 1 on fail (any diff), 2 on internal error.
		if (r3.exitCode === 2) {
			return {
				save: savePath,
				status: "error",
				diffCount: 0,
				durations: { rust: rustMs, ts: tsMs, diff: diffMs },
				error: `share-diff exit 2 (internal): ${r3.stderr.slice(-400)}`,
				reportPath: reportOut,
			};
		}

		const report = JSON.parse(await readFile(reportOut, "utf8")) as {
			diffCount: number;
			perField: Record<string, { status: string; diffCount: number }>;
		};
		const failingFields = Object.entries(report.perField)
			.filter(([, v]) => v.status === "fail")
			.map(([k, v]) => `${k}(${v.diffCount})`);

		return {
			save: savePath,
			status: r3.exitCode === 0 ? "pass" : "fail",
			diffCount: report.diffCount,
			durations: { rust: rustMs, ts: tsMs, diff: diffMs },
			failingFields: failingFields.length > 0 ? failingFields : undefined,
			reportPath: reportOut,
		};
	} finally {
		// Best-effort tmp cleanup (intermediate JSON files). Keep the report.
		await rm(rustOut, { force: true });
		await rm(tsOut, { force: true });
	}
}

async function processInPool<T>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<SaveOutcome>,
): Promise<SaveOutcome[]> {
	const out: SaveOutcome[] = [];
	let idx = 0;
	const workers: Promise<void>[] = [];
	for (let w = 0; w < concurrency; w++) {
		workers.push(
			(async () => {
				while (true) {
					const i = idx++;
					if (i >= items.length) return;
					out[i] = await fn(items[i]);
				}
			})(),
		);
	}
	await Promise.all(workers);
	return out;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	console.log(`mode=share concurrency=${args.concurrency}`);
	console.log("Building dump_shared (release)…");
	await ensureRustBinBuilt();

	const saves = await listSaves(args);
	console.log(`enumerated ${saves.length} save files`);
	if (saves.length === 0) {
		console.log("(no saves to run)");
		process.exit(0);
	}

	const tmpDir = mkdtempSync(join(tmpdir(), "share-parity-"));
	const reportsDir = join(args.out, "share-per-save");
	await mkdir(reportsDir, { recursive: true });

	let completed = 0;
	const total = saves.length;
	const outcomes = await processInPool(saves, args.concurrency, async (s) => {
		const o = await processSave(s, tmpDir, reportsDir);
		completed++;
		const summary =
			o.status === "pass"
				? `PASS ${s.split("/").pop()} (0 diffs)`
				: o.status === "error"
					? `ERROR ${s.split("/").pop()} (${o.error?.slice(0, 80) ?? ""})`
					: `FAIL ${s.split("/").pop()} (${o.diffCount} diffs) failing: ${o.failingFields?.join(", ") ?? ""}`;
		console.log(`[${completed}/${total}] ${summary}`);
		return o;
	});

	const pass = outcomes.filter((o) => o.status === "pass").length;
	const fail = outcomes.filter((o) => o.status === "fail").length;
	const errored = outcomes.filter((o) => o.status === "error").length;

	const corpusReport = {
		schemaVersion: 1,
		startedAt: new Date().toISOString(),
		totals: { saves: outcomes.length, pass, fail, error: errored },
		outcomes: outcomes.map((o) => ({
			save: o.save,
			status: o.status,
			diffCount: o.diffCount,
			durations: o.durations,
			failingFields: o.failingFields,
			error: o.error,
		})),
	};
	const corpusPath = join(args.out, "share-corpus.json");
	await writeFile(corpusPath, JSON.stringify(corpusReport, null, 2));

	console.log("");
	console.log(
		`${pass} pass, ${fail} fail, ${errored} error (${outcomes.length} saves)`,
	);
	console.log(`corpus report: ${corpusPath}`);

	await rm(tmpDir, { recursive: true, force: true });
	process.exit(fail === 0 && errored === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
	process.exit(2);
});
