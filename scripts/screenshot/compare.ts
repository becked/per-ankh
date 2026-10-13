// The `compare` half: read every artifact directory a finished run left
// behind and write one page holding them side by side. Shared by
// `./per-ankh screenshot compare`, which is handed a directory, and by `run`,
// which has just downloaded one.

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderComparisonHtml, sortSources, type OsSource } from "./render";
import type { OsManifest } from "./types";

// Returns the OS labels in the order they became columns, for the caller to
// report — a run with a leg that uploaded nothing has fewer than it started
// with, and that belongs in the line the operator reads.
export async function writeComparison(
	dir: string,
	outFile: string,
): Promise<string[]> {
	// Every `<img src>` is `<column>/shots/…`, resolved by the browser against
	// the HTML's own location — so a column's prefix is its artifact directory
	// relative to wherever `--out` lands, not to `dir`. Joined with forward
	// slashes because it ends up in a URL, not in a filesystem call.
	const columnPath = (name: string): string =>
		path
			.relative(path.dirname(outFile), path.join(dir, name))
			.split(path.sep)
			.join("/");

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
		sources.push({
			dir: columnPath(e.name),
			manifest: JSON.parse(raw) as OsManifest,
		});
	}
	if (sources.length === 0) {
		throw new Error(
			`No manifest.json in any subdirectory of ${dir}.\n` +
				`  \`gh run download <run-id> -D ${dir}\` writes one directory per artifact.`,
		);
	}

	await writeFile(outFile, renderComparisonHtml(sources));
	return sortSources(sources).map((s) => s.manifest.os);
}
