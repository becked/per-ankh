// `./per-ankh screenshot` — see the app as each desktop OS renders it.
//
// Split in two because the two halves run in different places. `capture`
// runs on a CI runner (one per OS, see .github/workflows/screenshot.yml) and
// knows nothing but a base URL; `compare` runs here, over the artifacts that
// run produced, and is the half you actually look at.
//
// What the matrix is for: the body font stack in src/app.css is a system
// stack, so the face it resolves to differs per OS — SF Pro, Segoe UI, or
// whatever fontconfig gives `sans-serif` — and so do the text metrics that
// decide wrapping, truncation and column widths. Scrollbars differ too: the
// `cloud-scroll` rule is WebKit-pseudo-only by choice (src/app.css), so a
// gutter that costs nothing on macOS costs width elsewhere. Neither is
// visible from one developer machine.

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cfAccessHeaders } from "../lib/cf-access";
import { flagString, parseFlags } from "../lib/cli";
import { readDotVars } from "../lib/dotvars";
import { info, ok, warn } from "../lib/format";
import { DEFAULT_BASE_URL, captureOs } from "./capture";
import { renderComparisonHtml, sortSources, type OsSource } from "./render";
import type { OsManifest } from "./types";

const DEFAULT_OUT_DIR = "screenshot";

// scripts/screenshot/index.ts → repo root is two levels up.
const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);

const KNOWN_FLAGS = new Set(["base-url", "out", "os", "help"]);

function printHelp(): void {
	process.stdout.write(
		[
			"per-ankh screenshot — capture the app on each OS and compare the results",
			"",
			"Usage:",
			"  ./per-ankh screenshot capture [--base-url URL] [--out DIR] [--os LABEL]",
			"  ./per-ankh screenshot compare DIR [--out FILE]",
			"",
			"capture  One signed-out pass over a fixed three-page list (home, the",
			"         community tournament, a public profile) at two viewports,",
			"         writing DIR/shots/*.jpg and DIR/manifest.json. This is what",
			"         the OS screenshots workflow runs on each runner; trigger that",
			"         from the Actions tab or `gh workflow run screenshot.yml`.",
			"",
			"compare  Render one side-by-side page from a finished run's artifacts:",
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
			"  --base-url URL  capture: origin to capture",
			"                  (default: " + DEFAULT_BASE_URL + ")",
			"  --out DIR       capture: output directory (default: " +
				DEFAULT_OUT_DIR +
				")",
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
	const manifest = await captureOs({ baseUrl, outDir, os, accessHeaders });

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
	const entries = await readdir(dir, { withFileTypes: true });
	const sources: OsSource[] = [];
	for (const e of entries) {
		if (!e.isDirectory()) continue;
		const manifestPath = path.join(dir, e.name, "manifest.json");
		let raw: string;
		try {
			raw = await readFile(manifestPath, "utf8");
		} catch {
			continue;
		}
		sources.push({ dir: e.name, manifest: JSON.parse(raw) as OsManifest });
	}
	if (sources.length === 0) {
		throw new Error(
			`No manifest.json in any subdirectory of ${dir}.\n` +
				`  \`gh run download <run-id> -D ${dir}\` writes one directory per artifact.`,
		);
	}

	const outFile = flagString(flags, "out") ?? path.join(dir, "index.html");
	await writeFile(outFile, renderComparisonHtml(sources));
	ok(
		`Wrote ${outFile} — ${sources.length} columns ` +
			`(${sortSources(sources)
				.map((s) => s.manifest.os)
				.join(", ")}).`,
	);
}

export async function main(argv: string[]): Promise<void> {
	const { positional, flags } = parseFlags(argv);
	const sub = positional[0];
	if (flags.help === true || sub === undefined) {
		printHelp();
		if (sub === undefined && flags.help !== true) process.exit(1);
		return;
	}
	for (const name of Object.keys(flags)) {
		if (!KNOWN_FLAGS.has(name)) throw new Error(`Unknown flag: --${name}`);
	}

	switch (sub) {
		case "capture":
			if (positional.length > 1) {
				throw new Error(`Unexpected argument: ${positional[1]}`);
			}
			await cmdCapture(flags);
			return;
		case "compare": {
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
