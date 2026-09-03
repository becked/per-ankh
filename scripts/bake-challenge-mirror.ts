// Generate the Worker's copies of the challenge scorer and its types from the
// frontend modules in src/lib/challenges/ — the momentum mirror pattern
// (`bake:momentum -- --mirror-only`), standalone because there is no corpus
// here: the transform is scripts/challenge-mirror.ts, and
// cloud/src/challenges/mirror.test.ts asserts the on-disk mirrors match it
// byte-for-byte.
//
// Run: npm run bake:challenge-mirror

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CHALLENGE_MIRRORS, mirrorChallengeSource } from "./challenge-mirror";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

async function main(): Promise<void> {
	for (const name of CHALLENGE_MIRRORS) {
		const src = resolve(REPO_ROOT, `src/lib/challenges/${name}.ts`);
		const out = resolve(REPO_ROOT, `cloud/src/challenges/${name}.ts`);
		await writeFile(
			out,
			mirrorChallengeSource(name, await readFile(src, "utf-8")),
		);
		console.log(
			`bake-challenge-mirror: ${src.replace(REPO_ROOT + "/", "")} → ${out.replace(REPO_ROOT + "/", "")}`,
		);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
