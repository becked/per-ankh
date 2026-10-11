// The destructive "nuke" operation:
//   nuke-user <user_id>  — delete every cloud game owned by the user, their R2
//                          blobs, and the user record itself

import { d1Batch, d1Exec, d1Query, sqlStr } from "../wrangler";
import { deleteGames } from "./games";
import { confirmNuke } from "../../lib/confirm";
import { info, ok } from "../../lib/format";
import { type CommandOpts, parseFlags } from "../../lib/cli";

// ─── nuke-user (cloud-rewrite world) ───────────────────────────────────────
//
// Order matters: games has no ON DELETE clause on its users FK, so we must
// delete games BEFORE users. Cascades handle player_summaries, game_player_turn,
// tech_events, law_events (from games), and collections, user_online_ids
// (from users).
//
// Tournament tables ALSO reference users(user_id) but WITHOUT ON DELETE CASCADE
// (tournament_admins, tournament_slots, tournament_matches.reported_by_user_id,
// tournament_beta_users.user_id/granted_by_user_id,
// tournament_match_casters.user_id). D1 enforces FKs, so a bare DELETE FROM
// users throws for anyone who ever touched a tournament — we clear those
// references first (null the nullable ones, delete the NOT NULL / own rows).
// The 0024/0025 slot_a/b_user_id and caster_user_id columns are plain TEXT
// with no FK, so they don't block and are left as a historical snapshot.
//
// Any new table that FK-references users(user_id) has to be added to the batch
// below, or nuke-user starts failing for everyone who appears in it.

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
				`  1. Delete ${gameCount} game(s) + their R2 blobs (json.gz + zip) and\n` +
				`     any screenshots (objects + edge cache)\n` +
				`  2. Clear tournament references (admin grants, own beta grant, and cast\n` +
				`     appearances removed; slot claims, reported-by, and granted-by nulled)\n` +
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
		// Cast appearances (migration 0034). user_id is NOT NULL and part of the
		// primary key, so these are deleted rather than nulled — like the admin
		// grants above. The `parts` blob keeps the caster entry, so the cast is
		// still credited by name on the match; only the profile-attribution index
		// drops. Nothing re-derives it afterwards (syncMatchCasters only runs on a
		// parts write), which is the intended end state for a nuked user.
		`DELETE FROM tournament_match_casters WHERE user_id = ${sqlStr(userId)}`,
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
