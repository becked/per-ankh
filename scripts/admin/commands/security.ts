// Block/unblock/list, plus the two destructive "nuke" operations:
//   nuke-key <app_key>   — block + delete every legacy share from that key
//   nuke-user <user_id>  — delete every cloud game owned by the user, their R2
//                          blobs, and the user record itself

import { d1Batch, d1Exec, d1Query, r2DeleteMany, sqlStr } from "../wrangler";
import { deleteGames } from "./games";
import { confirmNuke } from "../../lib/confirm";
import {
	type Column,
	bold,
	dim,
	emdash,
	formatDate,
	info,
	ok,
	printTable,
	warn,
} from "../../lib/format";
import { type CommandOpts, parseFlags, printJson } from "../../lib/cli";

// ─── block / unblock keys ──────────────────────────────────────────────────

export async function runBlockKey(
	argv: string[],
	_opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const key = positional[0];
	const reason = positional[1] ?? "no reason given";
	if (!key) {
		throw new Error("Usage: ./per-ankh admin block-key <app_key> [reason]");
	}
	await d1Exec(`
		INSERT INTO blocked_keys (app_key, reason) VALUES (${sqlStr(key)}, ${sqlStr(reason)})
		ON CONFLICT (app_key) DO UPDATE SET reason = ${sqlStr(reason)}, blocked_at = datetime('now')
	`);
	ok(`Blocked key: ${key} (${reason})`);
}

export async function runUnblockKey(
	argv: string[],
	_opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const key = positional[0];
	if (!key) {
		throw new Error("Usage: ./per-ankh admin unblock-key <app_key>");
	}
	await d1Exec(`DELETE FROM blocked_keys WHERE app_key = ${sqlStr(key)}`);
	ok(`Unblocked key: ${key}`);
}

// ─── block / unblock IPs ───────────────────────────────────────────────────

export async function runBlockIp(
	argv: string[],
	_opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const ip = positional[0];
	const reason = positional[1] ?? "no reason given";
	if (!ip) {
		throw new Error("Usage: ./per-ankh admin block-ip <ip> [reason]");
	}
	await d1Exec(`
		INSERT INTO blocked_ips (ip_address, reason) VALUES (${sqlStr(ip)}, ${sqlStr(reason)})
		ON CONFLICT (ip_address) DO UPDATE SET reason = ${sqlStr(reason)}, blocked_at = datetime('now')
	`);
	ok(`Blocked IP: ${ip} (${reason})`);
}

export async function runUnblockIp(
	argv: string[],
	_opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const ip = positional[0];
	if (!ip) {
		throw new Error("Usage: ./per-ankh admin unblock-ip <ip>");
	}
	await d1Exec(`DELETE FROM blocked_ips WHERE ip_address = ${sqlStr(ip)}`);
	ok(`Unblocked IP: ${ip}`);
}

// ─── list blocked ──────────────────────────────────────────────────────────

interface BlockedKeyRow {
	app_key: string;
	reason: string | null;
	blocked_at: string;
}
interface BlockedIpRow {
	ip_address: string;
	reason: string | null;
	blocked_at: string;
}

export async function runBlocked(
	_argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const keys = await d1Query<BlockedKeyRow>(
		`SELECT app_key, reason, blocked_at FROM blocked_keys ORDER BY blocked_at DESC`,
	);
	const ips = await d1Query<BlockedIpRow>(
		`SELECT ip_address, reason, blocked_at FROM blocked_ips ORDER BY blocked_at DESC`,
	);

	if (opts.json) {
		printJson({ blocked_keys: keys, blocked_ips: ips });
		return;
	}

	process.stdout.write(`\n${bold("Blocked app keys")}\n`);
	if (keys.length === 0) {
		process.stdout.write(`  ${dim("(none)")}\n`);
	} else {
		const cols: Column[] = [
			{ header: "APP_KEY", width: 38 },
			{ header: "REASON", width: 30 },
			{ header: "BLOCKED AT", width: 16 },
		];
		printTable(
			cols,
			keys.map((k) => [k.app_key, emdash(k.reason), formatDate(k.blocked_at)]),
		);
	}

	process.stdout.write(`\n${bold("Blocked IPs")}\n`);
	if (ips.length === 0) {
		process.stdout.write(`  ${dim("(none)")}\n\n`);
	} else {
		printTable(
			[
				{ header: "IP", width: 18 },
				{ header: "REASON", width: 30 },
				{ header: "BLOCKED AT", width: 16 },
			],
			ips.map((i) => [
				i.ip_address,
				emdash(i.reason),
				formatDate(i.blocked_at),
			]),
		);
		process.stdout.write("\n");
	}
}

// ─── nuke-key (legacy share world) ─────────────────────────────────────────

export async function runNukeKey(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const key = positional[0];
	const reason = positional[1] ?? "nuked via admin CLI";
	if (!key) {
		throw new Error("Usage: ./per-ankh admin nuke-key <app_key> [reason]");
	}

	const shareRows = await d1Query<{ share_id: string }>(
		`SELECT share_id FROM shares WHERE app_key = ${sqlStr(key)}`,
	);
	const count = shareRows.length;

	if (!opts.yes) {
		const yes = await confirmNuke(
			`NUKE KEY: ${key}\n  1. Block the app key\n  2. Delete ${count} share(s) from this key (D1 + R2)`,
		);
		if (!yes) {
			info("Cancelled.");
			return;
		}
	}

	await d1Exec(`
		INSERT INTO blocked_keys (app_key, reason) VALUES (${sqlStr(key)}, ${sqlStr(reason)})
		ON CONFLICT (app_key) DO UPDATE SET reason = ${sqlStr(reason)}, blocked_at = datetime('now')
	`);
	ok(`Blocked key: ${key}`);

	if (count === 0) {
		info("No shares to delete.");
		return;
	}

	info(`Deleting ${count} R2 blob(s)...`);
	const r2Summary = await r2DeleteMany(
		shareRows.map((s) => `${s.share_id}.json.gz`),
	);
	info(
		`R2: ok=${r2Summary.ok} missing=${r2Summary.missing} failed=${r2Summary.failed}`,
	);
	for (const err of r2Summary.errors.slice(0, 5)) warn(err);

	info(`Deleting ${count} D1 row(s)...`);
	await d1Exec(`DELETE FROM shares WHERE app_key = ${sqlStr(key)}`);
	ok(`Deleted ${count} share(s).`);
}

// ─── nuke-user (cloud-rewrite world) ───────────────────────────────────────
//
// Order matters: games has no ON DELETE clause on its users FK, so we must
// delete games BEFORE users. Cascades handle player_summaries, game_player_turn,
// tech_events, law_events (from games), and collections, user_online_ids
// (from users).
//
// Tournament tables ALSO reference users(user_id) but WITHOUT ON DELETE CASCADE
// (tournament_admins, tournament_slots, tournament_matches.reported_by_user_id,
// tournament_beta_users.user_id/granted_by_user_id). D1 enforces FKs, so a bare
// DELETE FROM users throws for anyone who ever touched a tournament — we clear
// those references first (null the nullable ones, delete the NOT NULL / own
// rows). The 0024/0025 slot_a/b_user_id and caster_user_id columns are plain
// TEXT with no FK, so they don't block and are left as a historical snapshot.

export async function runNukeUser(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const userId = positional[0];
	const reason = positional[1] ?? "nuked via admin CLI";
	if (!userId) {
		throw new Error("Usage: ./per-ankh admin nuke-user <user_id> [reason]");
	}

	const userRows = await d1Query<{
		user_id: string;
		display_name: string;
	}>(
		`SELECT user_id, display_name FROM users WHERE user_id = ${sqlStr(userId)}`,
	);
	const user = userRows[0];
	if (!user) {
		throw new Error(`User not found: ${userId}`);
	}

	const gameRows = await d1Query<{ game_id: string }>(
		`SELECT game_id FROM games WHERE user_id = ${sqlStr(userId)}`,
	);
	const gameCount = gameRows.length;

	if (!opts.yes) {
		const yes = await confirmNuke(
			`NUKE USER: ${user.display_name} (${userId})\n` +
				`  1. Delete ${gameCount} game(s) + their R2 blobs (json.gz + zip)\n` +
				`  2. Clear tournament references (admin grants + own beta grant removed;\n` +
				`     slot claims, reported-by, and granted-by nulled)\n` +
				`  3. Delete the user record + collections + online_ids\n` +
				`  4. KV sessions are NOT cleared — stale tokens will 401 on next call`,
		);
		if (!yes) {
			info("Cancelled.");
			return;
		}
	}

	if (gameCount > 0) {
		await deleteGames(gameRows.map((g) => g.game_id));
	} else {
		info("User has no games.");
	}

	// Clear non-cascading tournament references before the user delete (see the
	// header comment). Null the nullable references to preserve tournament
	// history; delete the rows keyed NOT NULL on this user (their admin grants)
	// and their own beta-allowlist entry.
	info("Clearing tournament references...");
	await d1Batch([
		`DELETE FROM tournament_admins WHERE user_id = ${sqlStr(userId)}`,
		`DELETE FROM tournament_beta_users WHERE user_id = ${sqlStr(userId)}`,
		`UPDATE tournament_beta_users SET granted_by_user_id = NULL WHERE granted_by_user_id = ${sqlStr(userId)}`,
		`UPDATE tournament_slots SET user_id = NULL WHERE user_id = ${sqlStr(userId)}`,
		`UPDATE tournament_matches SET reported_by_user_id = NULL WHERE reported_by_user_id = ${sqlStr(userId)}`,
	]);

	info("Deleting user record...");
	await d1Exec(`DELETE FROM users WHERE user_id = ${sqlStr(userId)}`);

	// Audit row. metadata is JSON to keep the events table generic.
	const metadata = JSON.stringify({
		reason,
		display_name: user.display_name,
		games_deleted: gameCount,
	});
	await d1Exec(`
		INSERT INTO events (event_type, user_id, metadata)
		VALUES ('nuke_user', ${sqlStr(userId)}, ${sqlStr(metadata)})
	`);

	ok(
		`Nuked user ${user.display_name} (${userId}); ${gameCount} game(s) deleted.`,
	);
	// KV sessions are not enumerated; stale tokens hit a 401 on next API call,
	// which is acceptable UX for the rare destructive-op case.
}
