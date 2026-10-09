import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	cloudflareTest,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { SITE_ADMIN_DISCORD_ID } from "./test/helpers/admin-identity";
import { SSR_TRUSTED_TEST_KEY } from "./test/helpers/ssr-identity";

const MIGRATIONS_PATH = path.resolve(import.meta.dirname, "./migrations");
const SECURITY_MIGRATIONS_PATH = path.resolve(
	import.meta.dirname,
	"./migrations-security",
);
const WRANGLER_PATH = path.resolve(import.meta.dirname, "./wrangler.toml");

// The config the isolate is built from is wrangler.toml with the `[ai]`
// bindings removed.
//
// Workers AI has no local simulator — the pool classifies an `ai` binding as
// never-local and opens a REMOTE proxy session against the Cloudflare account
// before a single test runs. That is fatal on a checkout that has never run
// `wrangler login` ("remote dev authentication error", whole suite, not just
// the screenshot tests), and on one that has, it makes `npm test` reach the
// user's account. Neither is acceptable for a suite that has to pass on a
// fresh clone.
//
// Nothing is lost: the Clef call is the one thing the screenshot tests must
// NOT make for real — it costs money per run and its answers are
// non-deterministic — so they replace env.AI with a stub (the request shape
// they assert against is imported from the same module the handler builds it
// with). Without the binding, `env.AI` is simply absent, which means a test
// that forgot to stub gets a TypeError and the handler's fail-closed path,
// never live inference.
//
// Stripped into a copy under .wrangler/ rather than removed from
// wrangler.toml, which is the deploy config and must keep the binding. Same
// line-oriented assumption the deploy preflight's toml scanners make
// (scripts/prod/checks/secrets.ts): flat sections, no inline tables.
function wranglerConfigWithoutAi(): string {
	const lines = readFileSync(WRANGLER_PATH, "utf8").split("\n");
	const kept: string[] = [];
	let inAi = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("[")) {
			inAi = trimmed === "[ai]" || /^\[env\.[^.\]]+\.ai\]$/.test(trimmed);
		}
		if (!inAi) kept.push(line);
	}
	const out = path.resolve(import.meta.dirname, ".wrangler/tmp/wrangler.toml");
	mkdirSync(path.dirname(out), { recursive: true });
	writeFileSync(out, kept.join("\n"));
	return out;
}

const TEST_WRANGLER_PATH = wranglerConfigWithoutAi();

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
						wrangler: { configPath: TEST_WRANGLER_PATH },
						miniflare: {
							bindings: {
								TEST_MIGRATIONS: await readD1Migrations(MIGRATIONS_PATH),
								TEST_SECURITY_MIGRATIONS: await readD1Migrations(
									SECURITY_MIGRATIONS_PATH,
								),
								// Enable the local Discord-free login bypass
								// (GET /v1/auth/dev/login) so integration tests can drive
								// the real claimTournamentSlots path. Mirrors
								// cloud/.dev.vars; prod never sets DEV_LOGIN. The handler
								// also requires a non-HTTPS request, which SELF.fetch's
								// http:// origin satisfies. See cloud/src/auth.ts
								// handleDevLogin.
								DEV_LOGIN: "1",
								// Gives the isolate a site admin (isSiteAdmin matches
								// users.discord_id against it), so the /v1/admin/*
								// endpoints are reachable via makeSiteAdmin(). No
								// makeUser-generated id can collide with it.
								ADMIN_DISCORD_ID: SITE_ADMIN_DISCORD_ID,
								// The frontend Worker's shared key, so tests can send a
								// server-rendered request the way per-ankh.app does and
								// assert what the API believes about the visitor
								// (adoptTrustedFrontend in src/util.ts). Bound here rather
								// than read from .dev.vars — that file is gitignored, and
								// these tests must pass on a fresh checkout.
								SSR_TRUSTED_KEY: SSR_TRUSTED_TEST_KEY,
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
