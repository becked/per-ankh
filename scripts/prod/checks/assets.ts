// Baked-asset consistency checks:
//   assets.atlas   — every /atlases/* path referenced by the committed
//                    atlas-manifest.ts exists under static/atlases/
//   assets.sprites — every /sprites/* path referenced by the committed
//                    sprite-manifest.ts exists under static/sprites/
//
// The atlas/sprite binaries are gitignored (Mohawk-owned art, baked locally)
// but the manifests that point at their content-hashed filenames ARE committed.
// So a manifest regenerated in one working tree can be deployed from another
// whose static/ holds different hashes — shipping a manifest that 404s every
// reference (a stale .webp drops a sprite layer; a stale .json throws in the
// map loader and blanks the whole map). This check refuses to deploy when the
// committed manifests reference assets the deploying machine cannot ship.

import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { CheckResult } from "../types";

const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);
const STATIC_DIR = resolve(REPO_ROOT, "static");

// Pull every "/atlases/..." or "/sprites/..." string literal out of a generated
// manifest module. The generated files are pure data (quoted URL literals), so
// a lexical scan is exact and avoids importing/evaluating the module.
const ASSET_PATH_RE = /["'`](\/(?:atlases|sprites)\/[^"'`]+)["'`]/g;

async function referencedPaths(manifestPath: string): Promise<string[] | null> {
	let text: string;
	try {
		text = await readFile(manifestPath, "utf8");
	} catch {
		return null;
	}
	const paths = new Set<string>();
	for (const m of text.matchAll(ASSET_PATH_RE)) {
		paths.add(m[1]);
	}
	return [...paths];
}

async function checkManifest(
	name: string,
	manifestRelPath: string,
): Promise<CheckResult> {
	const paths = await referencedPaths(resolve(REPO_ROOT, manifestRelPath));
	if (paths === null) {
		return {
			name,
			status: "fail",
			blocking: true,
			details: `Could not read ${manifestRelPath}`,
		};
	}
	const missing: string[] = [];
	for (const p of paths) {
		// "/atlases/resources.da084c25.webp" → static/atlases/resources.da084c25.webp
		try {
			await stat(resolve(STATIC_DIR, p.replace(/^\//, "")));
		} catch {
			missing.push(p);
		}
	}
	if (missing.length === 0) {
		return { name, status: "pass", blocking: true };
	}
	return {
		name,
		status: "fail",
		blocking: true,
		details:
			`${manifestRelPath} references ${missing.length} asset(s) missing from static/ — ` +
			`the deploy would 404 them. Re-bake (npm run bake:<name>) then ` +
			`\`npm run bake:finalize\`, or deploy from the working tree whose bake ` +
			`produced this manifest:\n` +
			missing.map((p) => `  ${p}`).join("\n"),
	};
}

export async function runAssetChecks(): Promise<CheckResult[]> {
	return [
		await checkManifest("assets.atlas", "src/lib/generated/atlas-manifest.ts"),
		await checkManifest(
			"assets.sprites",
			"src/lib/generated/sprite-manifest.ts",
		),
	];
}
