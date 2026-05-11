// `./per-ankh admin stats` — single-query global snapshot of the live app.
// All counts come from one SELECT with subqueries → one wrangler round-trip.

import { d1Query } from "../wrangler";
import { bold, formatBytes, info } from "../../lib/format";
import type { CommandOpts } from "../../lib/cli";
import { printJson } from "../../lib/cli";

interface StatsRow {
	users: number;
	cloud_games: number;
	legacy_shares: number;
	cloud_bytes: number;
	legacy_bytes: number;
	active_users_7d: number;
	uploads_24h: number;
	uploads_7d: number;
	uploads_30d: number;
	logins_24h: number;
	logins_7d: number;
	logins_30d: number;
	deletes_24h: number;
	deletes_7d: number;
	deletes_30d: number;
	blocked_keys: number;
	blocked_ips: number;
}

const SQL = `
SELECT
  (SELECT COUNT(*) FROM users) AS users,
  (SELECT COUNT(*) FROM games) AS cloud_games,
  (SELECT COUNT(*) FROM shares) AS legacy_shares,
  (SELECT COALESCE(SUM(blob_size_bytes), 0) FROM games) AS cloud_bytes,
  (SELECT COALESCE(SUM(blob_size_bytes), 0) FROM shares) AS legacy_bytes,
  (SELECT COUNT(DISTINCT user_id) FROM events
     WHERE event_type='login' AND created_at > datetime('now','-7 days')) AS active_users_7d,
  (SELECT COUNT(*) FROM events WHERE event_type='upload' AND created_at > datetime('now','-1 day'))   AS uploads_24h,
  (SELECT COUNT(*) FROM events WHERE event_type='upload' AND created_at > datetime('now','-7 days'))  AS uploads_7d,
  (SELECT COUNT(*) FROM events WHERE event_type='upload' AND created_at > datetime('now','-30 days')) AS uploads_30d,
  (SELECT COUNT(*) FROM events WHERE event_type='login'  AND created_at > datetime('now','-1 day'))   AS logins_24h,
  (SELECT COUNT(*) FROM events WHERE event_type='login'  AND created_at > datetime('now','-7 days'))  AS logins_7d,
  (SELECT COUNT(*) FROM events WHERE event_type='login'  AND created_at > datetime('now','-30 days')) AS logins_30d,
  (SELECT COUNT(*) FROM events WHERE event_type='delete' AND created_at > datetime('now','-1 day'))   AS deletes_24h,
  (SELECT COUNT(*) FROM events WHERE event_type='delete' AND created_at > datetime('now','-7 days'))  AS deletes_7d,
  (SELECT COUNT(*) FROM events WHERE event_type='delete' AND created_at > datetime('now','-30 days')) AS deletes_30d,
  (SELECT COUNT(*) FROM blocked_keys) AS blocked_keys,
  (SELECT COUNT(*) FROM blocked_ips)  AS blocked_ips
`;

export async function run(_args: string[], opts: CommandOpts): Promise<void> {
	info("Fetching stats...");
	const rows = await d1Query<StatsRow>(SQL);
	const s = rows[0];
	if (!s) {
		throw new Error("stats query returned no rows");
	}

	if (opts.json) {
		printJson(s);
		return;
	}

	process.stdout.write(`\n${bold("Per-Ankh Cloud Stats")}\n`);
	process.stdout.write(`${"─".repeat(33)}\n`);
	process.stdout.write(`  Users:              ${s.users}\n`);
	process.stdout.write(
		`  Cloud games:        ${s.cloud_games}  (${formatBytes(s.cloud_bytes)})\n`,
	);
	process.stdout.write(
		`  Legacy shares:      ${s.legacy_shares}  (${formatBytes(s.legacy_bytes)})\n`,
	);
	process.stdout.write(`\n`);
	process.stdout.write(`  Active users (7d):  ${s.active_users_7d}\n`);
	process.stdout.write(
		`  Uploads  (24h/7d/30d):  ${s.uploads_24h} / ${s.uploads_7d} / ${s.uploads_30d}\n`,
	);
	process.stdout.write(
		`  Logins   (24h/7d/30d):  ${s.logins_24h} / ${s.logins_7d} / ${s.logins_30d}\n`,
	);
	process.stdout.write(
		`  Deletes  (24h/7d/30d):  ${s.deletes_24h} / ${s.deletes_7d} / ${s.deletes_30d}\n`,
	);
	process.stdout.write(`\n`);
	process.stdout.write(`  Blocked keys:       ${s.blocked_keys}\n`);
	process.stdout.write(`  Blocked IPs:        ${s.blocked_ips}\n\n`);
}
