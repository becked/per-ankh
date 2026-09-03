// Regeneration test: cloud/src/challenges/{scoring,types}.ts are GENERATED
// from src/lib/challenges/ by scripts/challenge-mirror.ts — re-run the
// transform here and assert each on-disk mirror matches byte-for-byte, the
// same guarantee the momentum mirror and the generated tables have.
// (`node:fs` / `import.meta.url` typed by test-node.d.ts — the worker
// tsconfig has no Node types; this file runs on Vitest's Node pool.)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	CHALLENGE_MIRRORS,
	mirrorChallengeSource,
} from "../../../scripts/challenge-mirror";

describe("challenge mirror", () => {
	for (const name of CHALLENGE_MIRRORS) {
		it(`cloud/src/challenges/${name}.ts is the generated mirror of src/lib/challenges/${name}.ts`, () => {
			const front = readFileSync(
				new URL(`../../../src/lib/challenges/${name}.ts`, import.meta.url),
				"utf8",
			);
			const mirror = readFileSync(
				new URL(`./${name}.ts`, import.meta.url),
				"utf8",
			);
			expect(mirror).toBe(mirrorChallengeSource(name, front));
		});
	}

	it("refuses an import the Worker bundle cannot resolve", () => {
		expect(() =>
			mirrorChallengeSource(
				"scoring",
				'import { formatEnum } from "$lib/utils/formatting";\n',
			),
		).toThrow(/cannot resolve/);
	});
});
