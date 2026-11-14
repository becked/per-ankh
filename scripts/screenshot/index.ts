// `./per-ankh screenshot` — see the app as each desktop OS renders it.
//
// Split by where each half runs. `capture` runs on a CI runner (one per OS,
// see .github/workflows/screenshot.yml) and knows nothing but a base URL;
// `compare` runs here, over the artifacts a finished run produced, and is the
// half you actually look at. `run` is the operator's command and drives both
// ends: it starts the workflow, waits, and finishes in `compare`.
//
// What the matrix is for. Not advance widths any more: the UI face is now
// shipped rather than borrowed (the `Inter Variable` @font-face in
// src/app.css), which closed #295 §1 and §6, and the scrollbar rules are
// app-wide (the bare `::-webkit-scrollbar` block there), which closed #192.
// What is left of #295 is the part a screenshot is the only instrument for:
// §2, the same glyphs rasterized differently — DirectWrite/ClearType draws
// light-on-dark text thinner and tints glyph edges, which reads as a colour
// problem though no colour changed; §3, no `color-scheme` anywhere in src/,
// so everything the browser paints itself stays in light mode — which is
// what the game page is in this list for, being where the app's scroll
// containers are concentrated (see PAGES in capture.ts); and §5, the two
// `ui-monospace` stacks in SwissFlowBracket that fall through to Courier
// New on Windows — on the tournament page this list captures.
//
// Why a runner per OS instead of extending ux-review: ux-review runs
// headless Chromium on Linux, where every family in the fallback stack
// misses and fontconfig answers `sans-serif`, so its shots show a third
// typography matching neither platform (#295, "Why nothing caught this").
// Running the pass on the real runners is what this adds.
//
// Still outside what it can see, both from that same section of #295: this
// captures at deviceScaleFactor 1, so the half-pixel artifacts of Windows'
// 1.25/1.5 scaling don't appear, and at 1440/390, so neither 1536 nor 1280
// — the widths that scaling actually produces — is covered. §4 needs a
// capture this one isn't.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { cfAccessHeaders } from "../lib/cf-access";
import { flagString, parseFlags } from "../lib/cli";
import { readDotVars } from "../lib/dotvars";
import { info, ok, warn } from "../lib/format";
import { DEFAULT_BASE_URL, capture } from "./capture";
import { writeComparison } from "./compare";
import { run } from "./run";

const DEFAULT_OUT_DIR = "screenshot";

// scripts/screenshot/index.ts → repo root is two levels up.
const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);

// Per subcommand, so `compare DIR --os Linux` doesn't quietly accept a
// capture-only flag.
const RUN_FLAGS = new Set(["base-url", "out", "help"]);
const CAPTURE_FLAGS = new Set(["base-url", "out", "os", "help"]);
const COMPARE_FLAGS = new Set(["out", "help"]);
const ANY_FLAG = new Set([...RUN_FLAGS, ...CAPTURE_FLAGS, ...COMPARE_FLAGS]);

function checkFlags(
	flags: Record<string, string | true>,
	allowed: Set<string>,
): void {
	for (const name of Object.keys(flags)) {
		if (!allowed.has(name)) throw new Error(`Unknown flag: --${name}`);
	}
}

function printHelp(): void {
	process.stdout.write(
		[
			"per-ankh screenshot — capture the app on each OS and compare the results",
			"",
			"Usage:",
			"  ./per-ankh screenshot run [--base-url URL] [--out DIR]",
			"  ./per-ankh screenshot capture [--base-url URL] [--out DIR] [--os LABEL]",
			"  ./per-ankh screenshot compare DIR [--out FILE]",
			"",
			"run      The whole pass, and the only one of the three to run by hand:",
			"         starts the Screenshots workflow on origin, waits for the",
			"         Linux/Windows/macOS runners, downloads their artifacts into",
			"         DIR/<run-id>/ and writes the comparison page beside them.",
			"         Needs `gh`, authenticated against the repo.",
			"",
			"capture  One signed-out pass over a fixed four-page list (home, the",
			"         community tournament, a public profile, a public game) at",
			"         two viewports, writing DIR/shots/*.jpg and DIR/manifest.json.",
			"         This is the runners' half — the workflow calls it once per OS,",
			"         and `run` is how you start that.",
			"",
			"compare  Render one side-by-side page from a finished run's artifacts —",
			"         what `run` ends by doing, over a directory you already have:",
			"",
			"           gh run download <run-id> -D /tmp/screenshot",
			"           ./per-ankh screenshot compare /tmp/screenshot",
			"",
			"         Reads every immediate subdirectory holding a manifest.json and",
			"         writes DIR/index.html — a row per page, a column per OS.",
			"",
			"Capture targets STAGING by default, which sits behind Cloudflare",
			"Access: the service token is read from CF_ACCESS_CLIENT_ID /",
			"CF_ACCESS_CLIENT_SECRET in the environment (how CI supplies it),",
			"else from .staging.vars at the repo root. Without one, Access bounces",
			"every request to its login page and the capture fails rather than",
			"filing a screenshot of the gate.",
			"",
			"Flags:",
			"  --base-url URL  run, capture: origin to capture",
			"                  (default: " + DEFAULT_BASE_URL + ")",
			"  --out DIR       run: parent directory for the downloaded run",
			"                  capture: output directory",
			"                  (default: " + DEFAULT_OUT_DIR + ")",
			"  --out FILE      compare: output HTML (default: DIR/index.html)",
			"  --os LABEL      capture: name this run's column",
			"                  (default: $RUNNER_OS, else the host platform)",
			"  --help          Show this help",
			"",
		].join("\n"),
	);
}

async function cmdCapture(flags: Record<string, string | true>): Promise<void> {
	const baseUrl = flagString(flags, "base-url") ?? DEFAULT_BASE_URL;
	const outDir = flagString(flags, "out") ?? DEFAULT_OUT_DIR;
	// GitHub Actions sets RUNNER_OS to Linux / Windows / macOS, which is
	// exactly the column label we want; a hand run falls back to the platform.
	const os =
		flagString(flags, "os") ?? process.env.RUNNER_OS ?? process.platform;

	// Environment first — that's how a runner gets the token out of CI
	// secrets — then the gitignored file a local operator already has for
	// `./per-ankh staging smoke`.
	const accessHeaders =
		cfAccessHeaders(process.env) ??
		cfAccessHeaders(readDotVars(path.join(REPO_ROOT, ".staging.vars")));
	if (!accessHeaders) {
		// Not fatal: only staging is gated, and --base-url can point anywhere.
		// capturePage reports the bounce per page if this origin needs one.
		warn(
			"No Cloudflare Access service token (CF_ACCESS_CLIENT_ID / " +
				"CF_ACCESS_CLIENT_SECRET, or .staging.vars) — a gated origin will " +
				"refuse every page.",
		);
	}

	info(`Capturing ${baseUrl} as "${os}" → ${outDir}/`);
	const manifest = await capture({ baseUrl, outDir, os, accessHeaders });

	const captured = manifest.shots.filter((s) => s.file).length;
	const failed = manifest.shots.length - captured;
	ok(
		`Wrote ${outDir}/ — ${captured} shots` +
			`${failed ? `, ${failed} failed` : ""}.`,
	);
	// A matrix leg that silently uploaded an incomplete artifact would be
	// discovered only by squinting at the comparison page.
	if (failed > 0) throw new Error(`${failed} page(s) did not capture.`);
}

async function cmdCompare(
	dir: string,
	flags: Record<string, string | true>,
): Promise<void> {
	const outFile = flagString(flags, "out") ?? path.join(dir, "index.html");
	const columns = await writeComparison(dir, outFile);
	ok(`Wrote ${outFile} — ${columns.length} columns (${columns.join(", ")}).`);
}

export async function main(argv: string[]): Promise<void> {
	const { positional, flags } = parseFlags(argv);
	const sub = positional[0];
	if (flags.help === true) {
		printHelp();
		return;
	}
	// Above the no-subcommand exit, so `./per-ankh screenshot --bogus` names
	// the flag rather than printing help. Which flags are legal depends on the
	// subcommand, so this pass only rejects what no subcommand takes; each
	// case below re-checks against its own set.
	checkFlags(flags, ANY_FLAG);
	if (sub === undefined) {
		printHelp();
		process.exit(1);
	}

	switch (sub) {
		case "run":
			if (positional.length > 1) {
				throw new Error(`Unexpected argument: ${positional[1]}`);
			}
			checkFlags(flags, RUN_FLAGS);
			await run({
				baseUrl: flagString(flags, "base-url"),
				outDir: flagString(flags, "out") ?? DEFAULT_OUT_DIR,
			});
			return;
		case "capture":
			if (positional.length > 1) {
				throw new Error(`Unexpected argument: ${positional[1]}`);
			}
			checkFlags(flags, CAPTURE_FLAGS);
			await cmdCapture(flags);
			return;
		case "compare": {
			checkFlags(flags, COMPARE_FLAGS);
			const dir = positional[1];
			if (!dir) throw new Error("compare needs a directory of artifacts.");
			if (positional.length > 2) {
				throw new Error(`Unexpected argument: ${positional[2]}`);
			}
			await cmdCompare(dir, flags);
			return;
		}
		default:
			throw new Error(`Unknown subcommand: ${sub}`);
	}
}
