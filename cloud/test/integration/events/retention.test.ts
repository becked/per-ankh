// Nightly events-retention sweep: per-type buckets (24h rate-limit
// counters, 90d general audit), keep-forever tournament/admin types, and
// surface-don't-delete for unknown types. Policy in src/retention.ts,
// scheduled handler in src/index.ts.

import {
	applyD1Migrations,
	createExecutionContext,
	createScheduledController,
	env,
	waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../../../src/index";
import { sweepEvents } from "../../../src/retention";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	// The scheduled handler now sweeps security_events too (separate DB), so
	// that table must exist for the end-to-end cron test below.
	await applyD1Migrations(env.SECURITY_DB, env.TEST_SECURITY_MIGRATIONS);
});

// created_at is TEXT defaulting to datetime('now') (UTC, no T/Z). Backdate
// via SQLite modifiers so seeded rows match the production format exactly —
// a JS-formatted ISO string would break the lexicographic age comparison.
async function seedEvent(type: string, ageModifier: string): Promise<void> {
	await env.SHARE_DB.prepare(
		`INSERT INTO events (event_type, ip_address, created_at)
		 VALUES (?, '198.51.100.7', datetime('now', ?))`,
	)
		.bind(type, ageModifier)
		.run();
}

async function countByType(type: string): Promise<number> {
	const row = await env.SHARE_DB.prepare(
		`SELECT COUNT(*) AS count FROM events WHERE event_type = ?`,
	)
		.bind(type)
		.first<{ count: number }>();
	return row?.count ?? 0;
}

describe("events retention sweep", () => {
	it("applies per-bucket windows, keeps forever-types, reports unknowns", async () => {
		// 24h bucket: one fresh, three stale across the bucket's types.
		await seedEvent("anon_read", "-2 hours");
		await seedEvent("anon_read", "-25 hours");
		await seedEvent("tournament_view", "-25 hours");
		await seedEvent("user_search", "-25 hours");
		// 90d bucket: one fresh, two stale.
		await seedEvent("upload", "-89 days");
		await seedEvent("upload", "-91 days");
		await seedEvent("login", "-91 days");
		// Keep-forever and unknown types, both far past every window.
		await seedEvent("tournament_admin", "-400 days");
		await seedEvent("mystery_event", "-400 days");

		const result = await sweepEvents(env.SHARE_DB);

		expect(result.deleted).toEqual({
			rate_limit_counters: 3,
			general_audit: 2,
		});
		expect(result.unknownTypes).toEqual({ mystery_event: 1 });

		expect(await countByType("anon_read")).toBe(1);
		expect(await countByType("tournament_view")).toBe(0);
		expect(await countByType("user_search")).toBe(0);
		expect(await countByType("upload")).toBe(1);
		expect(await countByType("login")).toBe(0);
		expect(await countByType("tournament_admin")).toBe(1);
		expect(await countByType("mystery_event")).toBe(1);
	});

	it("runs end-to-end through the scheduled handler", async () => {
		// The -2 hours anon_read survivor from the previous case is still
		// present; add a stale row and let the real handler sweep it.
		await seedEvent("anon_read", "-25 hours");
		expect(await countByType("anon_read")).toBe(2);

		const controller = createScheduledController({
			scheduledTime: new Date(),
			cron: "47 3 * * *",
		});
		const ctx = createExecutionContext();
		// The test env declares only the bindings tests touch; the worker's
		// Env also lists config vars the sweep never reads — cast the gap.
		await worker.scheduled(
			controller,
			env as unknown as Parameters<typeof worker.scheduled>[1],
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(await countByType("anon_read")).toBe(1);
	});
});
