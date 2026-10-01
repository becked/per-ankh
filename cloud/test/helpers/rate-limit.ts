// Rate-limit scaffolding shared by the read-budget tests.
//
// A budget is spent by rows in `events`, so a test exhausts one by seeding it
// rather than by making thousands of requests. The insert is a recursive CTE
// because the ceilings run to thousands and SQLite caps bound variables well
// below that.

import { env } from "cloudflare:test";

export type ReadEventType =
	| "tournament_view"
	| "tournament_list_view"
	| "tournament_link_view";

/** Spend `count` slots of one per-IP budget. */
export async function seedEvents(
	eventType: ReadEventType,
	ip: string,
	count: number,
): Promise<void> {
	await env.SHARE_DB.prepare(
		`INSERT INTO events (event_type, ip_address)
		 WITH RECURSIVE seq(i) AS (
		   SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ?
		 )
		 SELECT ?, ? FROM seq`,
	)
		.bind(count, eventType, ip)
		.run();
}

/**
 * getClientIp ignores CF-Connecting-IP unless CF-RAY is present — an untrusted
 * topology collapses to one shared bucket, which would make budget tests
 * interfere — so a request that wants its own bucket must carry both.
 */
export function ipHeaders(ip: string): Record<string, string> {
	return { "CF-Connecting-IP": ip, "CF-RAY": "test-ray" };
}
