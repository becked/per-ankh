import path from "node:path";
import {
	cloudflareTest,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const MIGRATIONS_PATH = path.resolve(import.meta.dirname, "./migrations");

// Two projects:
//   - "unit" runs the existing pure-function tests on the default Node pool.
//     No miniflare overhead; ~ms per test.
//   - "integration" runs handler tests inside a Miniflare Worker isolate with
//     real D1/KV/R2 bindings via `@cloudflare/vitest-pool-workers`.
//
// Migrations are read once at config load and exposed to tests via the
// `TEST_MIGRATIONS` binding. Each test file applies them in beforeAll.
//
// `npm test` runs both. Use `--project unit` or `--project integration` to
// filter.
export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "unit",
					include: ["src/**/*.test.ts"],
				},
			},
			{
				plugins: [
					cloudflareTest(async () => ({
						main: "./src/index.ts",
						wrangler: { configPath: "./wrangler.toml" },
						miniflare: {
							bindings: {
								TEST_MIGRATIONS: await readD1Migrations(MIGRATIONS_PATH),
							},
						},
					})),
				],
				test: {
					name: "integration",
					include: ["test/integration/**/*.test.ts"],
				},
			},
		],
	},
});
