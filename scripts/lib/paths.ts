// Resolve external dependency paths (pinacotheca checkout, OW reference XML)
// for the bake scripts. Each resolver checks an env var first, then falls
// back to a list of relative-path candidates so existing local layouts keep
// working without configuration.
//
// Env vars are loaded from the repo-root .env file (gitignored). Contributors
// copy .env.example to .env and fill in their paths.

import "dotenv/config";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

interface ResolveSpec {
	envVar: string;
	candidates: readonly string[];
	label: string;
}

function resolvePath(spec: ResolveSpec): string {
	const fromEnv = process.env[spec.envVar];
	if (fromEnv && fromEnv.trim() !== "") {
		const expanded = resolve(fromEnv);
		if (existsSync(expanded)) return expanded;
		throw new Error(
			`${spec.envVar}=${fromEnv} but path does not exist: ${expanded}`,
		);
	}
	const found = spec.candidates.find((p) => existsSync(p));
	if (found) return found;
	throw new Error(
		`could not locate ${spec.label}; set ${spec.envVar} in .env or place ${spec.label} at one of:\n  ${spec.candidates.join("\n  ")}`,
	);
}

// Pinacotheca checkout (https://github.com/becked/pinacotheca). Bake scripts
// read its extracted/sprites/ tree and pyproject.toml for the version stamp.
// Two relative layouts in active use as fallbacks: per-ankh worktree under
// .claude/worktrees/<branch>/ (4 up) and the main repo at <Old World>/per-ankh/
// (1 up, sibling to pinacotheca/).
export function resolvePinacotheca(): string {
	return resolvePath({
		envVar: "PINACOTHECA_DIR",
		candidates: [
			resolve(REPO_ROOT, "../../../../pinacotheca"),
			resolve(REPO_ROOT, "../pinacotheca"),
		],
		label: "pinacotheca",
	});
}

// owtournamentatlas checkout (https://github.com/alcaras/owtournamentatlas) —
// the community map atlas. bake-map-caveats.ts reads its generation-stats data
// (src/data/atlas-dist.json) and the published pool (src/pages/index.astro).
export function resolveAtlas(): string {
	return resolvePath({
		envVar: "OWTOURNAMENTATLAS_DIR",
		candidates: [
			resolve(REPO_ROOT, "../owtournamentatlas"),
			resolve(REPO_ROOT, "../../../../owtournamentatlas"),
		],
		label: "owtournamentatlas",
	});
}

// owtt checkout (https://github.com/alcaras/owtt) — the tech-tree planner.
// bake-owtt.ts reads its tech-data.js to snapshot the deep-link encoding.
// A local checkout (not the live site) keeps the input diffable and pinnable,
// and avoids executing remote JavaScript at bake time.
export function resolveOwtt(): string {
	return resolvePath({
		envVar: "OWTT_DIR",
		candidates: [
			resolve(REPO_ROOT, "../owtt"),
			resolve(REPO_ROOT, "../../../../owtt"),
		],
		label: "owtt",
	});
}

// Old World reference XML — the OW install's XML/ directory (or a checkout of
// it). bake-improvements.ts reads improvement.xml + nation.xml + mods/. The
// env var points at the checkout root; we return the XML/ subdir to match
// the existing call-site expectation.
export function resolveReferenceXml(): string {
	const fromEnv = process.env.OLD_WORLD_REFERENCE_DIR;
	if (fromEnv && fromEnv.trim() !== "") {
		const root = resolve(fromEnv);
		const xml = resolve(root, "XML");
		if (existsSync(xml)) return xml;
		if (existsSync(root)) {
			throw new Error(
				`OLD_WORLD_REFERENCE_DIR=${fromEnv} exists but has no XML/ subdir at ${xml}`,
			);
		}
		throw new Error(
			`OLD_WORLD_REFERENCE_DIR=${fromEnv} but path does not exist: ${root}`,
		);
	}
	const candidates = [
		resolve(REPO_ROOT, "../../../Reference/XML"),
		resolve(REPO_ROOT, "Reference/XML"),
	];
	const found = candidates.find((p) => existsSync(p));
	if (found) return found;
	throw new Error(
		`could not locate Reference/XML; set OLD_WORLD_REFERENCE_DIR in .env (pointing at the checkout root) or place Reference/ at one of:\n  ${candidates.map((p) => p.replace(/\/XML$/, "")).join("\n  ")}`,
	);
}
