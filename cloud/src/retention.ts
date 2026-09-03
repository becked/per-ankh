// Nightly retention sweep over the `events` table, run from the Worker's
// `scheduled` handler (see index.ts; cron config in wrangler.toml).
//
// Policy is declarative: add an event type to a bucket (or KEEP_FOREVER)
// and the sweep picks it up. Types in no list are NEVER deleted — they're
// counted and logged so a new event type surfaces for an explicit policy
// decision instead of silently inheriting a default. The deletion scope
// is expected to grow over time (e.g. a future security_events table).

// The cron pattern this sweep runs on. Named here so index.ts can dispatch on
// it by exact match rather than by falling through: staging declares the stats
// precompute's patterns and not this one, and a fall-through would sweep its
// events the first time a stats pattern drifted out of sync. Kept in step by
// eye with `crons` in wrangler.toml — nothing imports a wrangler config.
export const RETENTION_CRON = "47 3 * * *";

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
		types: [
			"anon_read",
			"tournament_view",
			// Tournament list reads (tournament/public.ts): its own budget rather
			// than tournament_view's, so the home page's tournament strip can't
			// drain the tournament pages' allowance. Same 1h counter role,
			// metadata-free.
			"tournament_list_view",
			// Game→tournament link reads (tournament/public.ts): its own budget
			// rather than tournament_view's, so /games/* crawls can't drain the
			// tournament pages' allowance. Same 1h counter role, metadata-free.
			"tournament_link_view",
			// Public /stats bundle reads (stats/handlers.ts): its own budget
			// rather than anon_read's, so a crawl of /games/* can't decide when
			// the global stats page starts refusing — and vice versa. Same 1h
			// counter role, metadata-free.
			"global_stats_view",
			"user_search",
			// Header people search (users.ts): same counter role as
			// user_search, its own budget. Metadata is q_length only.
			"user_search_public",
			// Profile-URL writes (users.ts): one row per request to either the
			// setter or the release, not per success, because it's the rejected
			// ones that need bounding. Metadata-free — which name was tried isn't
			// worth keeping; the changes that landed are recorded by slug_claim /
			// slug_release in the bucket below.
			"slug_claim_attempt",
			// Caster self-service ledger (player.ts): inserted per cast/uncast,
			// read only by the 1h schedule budget. Metadata-free by design.
			"tournament_schedule",
			// Challenge page reads (challenges/handlers.ts): list and detail.
			// Same 1h counter role, metadata-free.
			"challenge_view",
			// Game→challenge link reads (challenges/handlers.ts): its own
			// budget for the tournament_link_view reason — every /games/[id]
			// render calls it, so on the page budget a game crawl would take
			// /challenges down with it. Same 1h counter role, metadata-free.
			"challenge_link_view",
		],
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
			// Profile-URL changes (users.ts): slug_claim when a name is taken or
			// renamed onto, slug_release when it's given up. Not once per account
			// — users rename, bounded to one change a week by the cooldown — and
			// between them they are the only record of who held a name, since the
			// users row shows the current value only and a released name is
			// immediately claimable by someone else. slug_claim carries
			// { slug, previous_slug }, slug_release { previous_slug }, so either
			// row names both sides of the transition.
			//
			// Derived slugs (first login, `admin backfill-slugs`) write neither:
			// they're issued, not chosen, and reproducible from the display name
			// they came from.
			"slug_claim",
			"slug_release",
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
// audit.
export const KEEP_FOREVER: readonly string[] = [
	"tournament_admin",
	"tournament_create",
	// Challenge lifecycle (challenges/handlers.ts): create/patch/delete each
	// write one row — the rules a leaderboard was scored against, and who
	// changed them, are an accountability record like tournament_admin.
	"challenge_create",
	"challenge_admin",
	"tournament_system",
	"tournament_slot_substituted",
	"tournament_self_signup",
	"tournament_self_withdraw",
	"tournament_export",
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

// Skiff drains the `security_events` table (a separate D1, SECURITY_DB)
// continuously over the D1 REST API. This nightly sweep is only a safety floor
// so the table can't grow unbounded if that drain stalls — Skiff's credential
// is read-only by design, so deletion is ours. Unlike `events`, every row ages
// out uniformly (no per-type buckets). See cloud/src/security-events.ts.
export const SECURITY_EVENTS_RETENTION = "-30 days";

export async function sweepSecurityEvents(db: D1Database): Promise<number> {
	const result = await db
		.prepare("DELETE FROM security_events WHERE ts < datetime('now', ?)")
		.bind(SECURITY_EVENTS_RETENTION)
		.run();
	return result.meta.changes;
}
