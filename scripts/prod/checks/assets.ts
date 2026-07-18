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
//
// Group 1 captures the opening quote; \1 requires the same quote to close, and
// the interior excludes only that matched delimiter — not all three quote
// chars. Excluding all three would truncate a filename that legitimately
// contains one of the others, e.g. the apostrophe in
// "IMPROVEMENT_SANCHI'S_STUPPA.png" inside a double-quoted literal. Group 2 is
// the path.
const ASSET_PATH_RE = /(["'`])(\/(?:atlases|sprites)\/(?:(?!\1).)+)\1/g;

async function referencedPaths(manifestPath: string): Promise<string[] | null> {
	let text: string;
	try {
		text = await readFile(manifestPath, "utf8");
	} catch {
		return null;
	}
	const paths = new Set<string>();
	for (const m of text.matchAll(ASSET_PATH_RE)) {
		paths.add(m[2]);
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
	// A readable manifest that matched zero asset literals means the scan found
	// nothing to verify — the manifest is empty or its emitted format changed
	// (e.g. URLs built by concatenation rather than full string literals). Fail
	// loudly rather than pass vacuously; a green check here would defeat the
	// entire guard.
	if (paths.length === 0) {
		return {
			name,
			status: "fail",
			blocking: true,
			details:
				`${manifestRelPath} referenced 0 assets — the manifest is empty or ` +
				`its format changed so the scan matched nothing. Re-bake ` +
				`(npm run bake:<name>) then \`npm run bake:finalize\`, and confirm ` +
				`the manifest lists /atlases or /sprites paths.`,
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
