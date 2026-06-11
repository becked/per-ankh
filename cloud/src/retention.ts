// Nightly retention sweep over the `events` table, run from the Worker's
// `scheduled` handler (see index.ts; cron config in wrangler.toml).
//
// Policy is declarative: add an event type to a bucket (or KEEP_FOREVER)
// and the sweep picks it up. Types in no list are NEVER deleted — they're
// counted and logged so a new event type surfaces for an explicit policy
// decision instead of silently inheriting a default. The deletion scope
// is expected to grow over time (e.g. a future security_events table).

interface RetentionBucket {
	readonly name: string;
	// SQLite datetime() modifier, e.g. "-90 days".
	readonly olderThan: string;
	readonly types: readonly string[];
}

export const RETENTION_BUCKETS: readonly RetentionBucket[] = [
	{
		// Pure rate-limit counters. Every rate-limit read spans 1 hour
		// (countEventsSince in games.ts, enforceTournamentViewRateLimit);
		// 24h keeps a debugging margin. Nothing aggregates these for
		// display — verified before choosing the window.
		name: "rate_limit_counters",
		olderThan: "-24 hours",
		types: ["anon_read", "tournament_view", "user_search"],
	},
	{
		// General audit trail. Must stay >= 30 days: `./per-ankh admin
		// stats` computes 30-day activity from upload/login/delete.
		// login_denied is historical — no longer written, but old rows
		// exist in prod and age out through this bucket.
		name: "general_audit",
		olderThan: "-90 days",
		types: [
			"upload",
			"reimport",
			"admin_reimport",
			"admin_reindex",
			"delete",
			"download",
			"visibility_change",
			"collection_change",
			"name_change",
			"login",
			"logout",
			"login_denied",
			"online_id_remove",
			"purge_games",
		],
	},
];

// Never deleted; listed so the unknown-type detector skips them.
// Tournament rows are an accountability record (retro-edits, slot
// substitutions) and trivially small. delete_game / nuke_user are written
// by the admin CLI (scripts/admin), not the Worker — destructive-admin
// audit. tournament_schedule is currently only referenced by a rate
// limiter, never inserted; listed for future-proofing.
export const KEEP_FOREVER: readonly string[] = [
	"tournament_admin",
	"tournament_create",
	"tournament_system",
	"tournament_slot_substituted",
	"tournament_self_signup",
	"tournament_self_withdraw",
	"tournament_export",
	"tournament_schedule",
	"delete_game",
	"nuke_user",
];

export interface RetentionSweepResult {
	// bucket name -> rows deleted
	deleted: Record<string, number>;
	// event_type -> surviving row count, for types in no policy list
	unknownTypes: Record<string, number>;
}

export async function sweepEvents(
	db: D1Database,
): Promise<RetentionSweepResult> {
	const deleted: Record<string, number> = {};

	for (const bucket of RETENTION_BUCKETS) {
		const placeholders = bucket.types.map(() => "?").join(", ");
		const result = await db
			.prepare(
				`DELETE FROM events
				 WHERE event_type IN (${placeholders})
				   AND created_at < datetime('now', ?)`,
			)
			.bind(...bucket.types, bucket.olderThan)
			.run();
		deleted[bucket.name] = result.meta.changes;
	}

	const allKnownTypes = [
		...RETENTION_BUCKETS.flatMap((b) => b.types),
		...KEEP_FOREVER,
	];
	const placeholders = allKnownTypes.map(() => "?").join(", ");
	const unknown = await db
		.prepare(
			`SELECT event_type, COUNT(*) AS count FROM events
			 WHERE event_type NOT IN (${placeholders})
			 GROUP BY event_type`,
		)
		.bind(...allKnownTypes)
		.all<{ event_type: string; count: number }>();

	const unknownTypes: Record<string, number> = {};
	for (const row of unknown.results) {
		unknownTypes[row.event_type] = row.count;
	}

	return { deleted, unknownTypes };
}
