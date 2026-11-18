import { describe, expect, it } from "vitest";

import { askCacheKey } from "./ask-cache";

describe("askCacheKey", () => {
	it("folds case and runs of whitespace in the question", async () => {
		expect(await askCacheKey("Who built the Pyramids?", "2026-11-17")).toBe(
			await askCacheKey("  who built   the PYRAMIDS? ", "2026-11-17"),
		);
	});

	it("is a new key on a new date", async () => {
		expect(await askCacheKey("Who built the Pyramids?", "2026-11-17")).not.toBe(
			await askCacheKey("Who built the Pyramids?", "2026-11-18"),
		);
	});

	it("is a new key for a different question", async () => {
		expect(await askCacheKey("Who built the Pyramids?", "2026-11-17")).not.toBe(
			await askCacheKey("Who built the Colossus?", "2026-11-17"),
		);
	});

	it("keeps the question text out of the key", async () => {
		const key = await askCacheKey(
			"How many games has Alice played?",
			"2026-11-17",
		);
		expect(key).toMatch(/^query_ask:answer:v\d+:[0-9a-f]{64}$/);
	});
});
