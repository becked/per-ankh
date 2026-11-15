// `./per-ankh admin online-ids check` — three health checks over
//   user_online_ids, the table that decides which account a seat belongs to.
// `./per-ankh admin online-ids unlink <user_id> <online_id>` — drop one link.
//
// Why this surface exists at all: `captureOnlineIds` (cloud/src/online-ids.ts)
// is the table's only writer and it writes one row per claimed seat, so a user
// who picks the wrong human in the upload picker links themselves to that
// player's id. Nothing removes the row again — handleGamePatch keeps ids
// "learned from other games" when the uploader seat moves (cloud/src/games.ts)
// — and `PLAYER_USER_ID_SQL` (cloud/src/query/catalog.ts) then credits that
// player's seats to the wrong account on every identity surface: the
// played-games board, the duel rating model and Explore.
//
// The user-facing escape hatch is DELETE /v1/users/me/online-ids/:online_id,
// which only the account holder can call and which no screen calls today. An
// operator needs the cross-account cases, where the account holding the bad
// link is not the player it harms.

import { d1Exec, d1Query, sqlStr } from "../wrangler";
import { confirmTyping } from "../../lib/confirm";
import {
	bold,
	type Column,
	dim,
	emdash,
	formatDate,
	info,
	ok,
	printCount,
	printDetail,
	printTable,
	warn,
} from "../../lib/format";
import {
	type CommandOpts,
	flagString,
	parseFlags,
	printJson,
} from "../../lib/cli";

// ---------- Shared SQL fragments ----------
//
// Every check selects the same two pieces of evidence over a `uo` row, so they
// are written once here rather than three times with room to drift.

// Seats this id credits through the online-id arm of PLAYER_USER_ID_SQL. The
// uploader's own claimed seat is excluded because the other arm credits it
// whatever the link says, so removing the link does not touch it — this is the
// count that changes when an operator unlinks.
const CREDITED_SEATS_SQL = `(SELECT COUNT(*) FROM player_summaries ps
		  JOIN games g ON g.game_id = ps.game_id
		 WHERE ps.online_id = uo.online_id AND ps.is_uploader = 0 AND g.is_public = 1)`;

// Every in-save name the id has played under, public or not. This is the
// operator's evidence: an id whose seats are all called something else is the
// shape a wrong claim leaves behind.
const SEAT_NAMES_SQL = `(SELECT GROUP_CONCAT(DISTINCT ps.player_name)
		  FROM player_summaries ps WHERE ps.online_id = uo.online_id)`;

// Does a seat play under a name the account itself answers to? LOWER(NULL) is
// NULL and NULL never satisfies IN, so an unset alias or Discord handle drops
// out of the comparison without needing a COALESCE — and an empty player_name
// is excluded so it can't match an empty alias.
const seatNameIsAccountSql = (alias: string): string =>
	`${alias}.player_name <> ''
		   AND LOWER(${alias}.player_name) IN (LOWER(u.alias), LOWER(u.display_name), LOWER(u.discord_username))`;

// The claims that corroborate a link: seats this user claimed as uploader that
// carry this id. Joined rather than asked three times, because every check
// needs the same two things from it — whether there is a claim at all (check A
// is its absence) and which game to repair when there is.
//
// The claim is the half an unlink does not reach, and the reason check output
// names it. `reparse-all` posts the stored seat back verbatim
// (scripts/admin/commands/reparse.ts) and handleGameUpload re-runs
// captureOnlineIds on it (cloud/src/games.ts), so a link with a claim behind it
// returns on the next parser bump. Six of the seven links removed from staging
// on 2026-11-15 had one.
//
// `rn = 1` picks the earliest claiming game as the one to name; `claim_count`
// says how many there are, which is also what separates a one-off misclaim
// from the real owner — in the staging snapshot every wrong link had exactly
// one claim and every correct owner had dozens.
const CLAIM_JOIN_SQL = `LEFT JOIN (
		 SELECT g.user_id,
		        ps.online_id,
		        ps.game_id,
		        ps.player_index,
		        ps.player_name,
		        COUNT(*) OVER (PARTITION BY g.user_id, ps.online_id) AS claim_count,
		        ROW_NUMBER() OVER (
		          PARTITION BY g.user_id, ps.online_id
		          ORDER BY g.save_date, ps.game_id) AS rn
		   FROM player_summaries ps
		   JOIN games g ON g.game_id = ps.game_id
		  WHERE ps.is_uploader = 1
	       ) cl ON cl.user_id = uo.user_id AND cl.online_id = uo.online_id AND cl.rn = 1`;

const EVIDENCE_COLUMNS_SQL = `${CREDITED_SEATS_SQL} AS credited_seats,
		 ${SEAT_NAMES_SQL} AS seat_names,
		 COALESCE(cl.claim_count, 0) AS claim_count,
		 cl.game_id AS claim_game_id,
		 cl.player_index AS claim_seat_index,
		 cl.player_name AS claim_seat_name`;

export interface LinkRow {
	user_id: string;
	online_id: string;
	display_name: string;
	first_seen_at: string;
	last_seen_at: string;
	credited_seats: number;
	seat_names: string | null;
	// The claim that will re-create this link on the next reparse, or 0 / null
	// when nothing claims it.
	claim_count: number;
	claim_game_id: string | null;
	claim_seat_index: number | null;
	claim_seat_name: string | null;
}

export interface AmbiguousRow extends LinkRow {
	owners: number;
}

// ---------- A. Uncorroborated links ----------
//
// A link to an id that none of this user's own claimed seats carries. The user
// was linked by a claim that has since been moved or whose game was deleted,
// or by a claim on somebody else's seat. Precise: one row in the 2026-11-15
// production snapshot, out of 77 links over 68 users.
const UNCORROBORATED_SQL = `
	SELECT uo.user_id,
	       uo.online_id,
	       COALESCE(u.alias, u.display_name) AS display_name,
	       uo.first_seen_at,
	       uo.last_seen_at,
	       ${EVIDENCE_COLUMNS_SQL}
	  FROM user_online_ids uo
	  JOIN users u ON u.user_id = uo.user_id
	  ${CLAIM_JOIN_SQL}
	 WHERE cl.game_id IS NULL
	 ORDER BY credited_seats DESC, uo.first_seen_at`;

// ---------- B. Ambiguous ids ----------
//
// An id two or more accounts claim. UNAMBIGUOUS_ONLINE_ID_OWNERS_SQL
// (cloud/src/online-ids.ts) resolves it to nobody rather than guess, so every
// seat carrying it silently leaves the played-games board, the rating model
// and Explore at once — no surface says so, which is why it needs a check.
//
// One row per link rather than per id, with the owner count alongside: the
// operator's next step is `unlink <user_id> <online_id>`, and that needs the
// user_id of the owner they decide is wrong. Ordering by id keeps the rival
// claims adjacent.
//
// A genuinely shared account is a legitimate instance of this state — it is
// one of the reasons migration 0003 made the table many-to-many — so this
// check reports rather than condemns.
const AMBIGUOUS_SQL = `
	SELECT uo.user_id,
	       uo.online_id,
	       COALESCE(u.alias, u.display_name) AS display_name,
	       uo.first_seen_at,
	       uo.last_seen_at,
	       (SELECT COUNT(DISTINCT a.user_id) FROM user_online_ids a
	         WHERE a.online_id = uo.online_id) AS owners,
	       ${EVIDENCE_COLUMNS_SQL}
	  FROM user_online_ids uo
	  JOIN users u ON u.user_id = uo.user_id
	  ${CLAIM_JOIN_SQL}
	 WHERE EXISTS (SELECT 1 FROM user_online_ids b
	                WHERE b.online_id = uo.online_id AND b.user_id <> uo.user_id)
	 ORDER BY uo.online_id, uo.first_seen_at`;

// ---------- C. Name disagreement ----------
//
// A link whose seats never play under a name the account answers to. This is
// the check that reaches a wrong claim nobody corrected, which A cannot see:
// the claim corroborates the link, so only the names give it away.
//
// The id must have a named seat for the disagreement to mean anything. An
// unnamed seat carries `''` rather than no value, and it is not an edge case:
// 795 of the 3,059 player_summaries rows in the 2026-11-15 production snapshot
// are empty and none are NULL. Without this guard a link whose only seat is
// unnamed reads as "never plays under your name", which is vacuous rather than
// suspicious — becked's non-Steam id is exactly that row.
//
// Both other halves are needed too. Comparing seat names to the account name alone is
// noisy — 859 of 1,213 claimed seats match their account's name in the
// 2026-11-15 production snapshot, and 18 of 68 users have no claimed seat that
// matches theirs at all, so a bare comparison flags every link those 18 hold.
// Requiring that the account does generally play under its own name is what
// removes that floor and leaves the disagreement meaning something.
const NAME_MISMATCH_SQL = `
	SELECT uo.user_id,
	       uo.online_id,
	       COALESCE(u.alias, u.display_name) AS display_name,
	       uo.first_seen_at,
	       uo.last_seen_at,
	       ${EVIDENCE_COLUMNS_SQL}
	  FROM user_online_ids uo
	  JOIN users u ON u.user_id = uo.user_id
	  ${CLAIM_JOIN_SQL}
	 WHERE EXISTS (
	         SELECT 1 FROM player_summaries ps
	           JOIN games g ON g.game_id = ps.game_id
	          WHERE g.user_id = uo.user_id AND ps.is_uploader = 1
	            AND ${seatNameIsAccountSql("ps")})
	   AND EXISTS (
	         SELECT 1 FROM player_summaries ps
	          WHERE ps.online_id = uo.online_id AND ps.player_name <> '')
	   AND NOT EXISTS (
	         SELECT 1 FROM player_summaries ps
	          WHERE ps.online_id = uo.online_id
	            AND ${seatNameIsAccountSql("ps")})
	 ORDER BY credited_seats DESC, uo.first_seen_at`;

type CheckKind = "uncorroborated" | "ambiguous" | "name-mismatch";

const CHECK_KINDS: CheckKind[] = [
	"uncorroborated",
	"ambiguous",
	"name-mismatch",
];

const EVIDENCE_COLUMNS: Column[] = [
	{ header: "SEATS", width: 5, align: "right" },
	{ header: "SEAT NAMES", width: 28 },
	{ header: "CLAIMS", width: 6, align: "right" },
	{ header: "CLAIM (GAME / SEAT)", width: 38 },
];

// The claim column is the repair the unlink does not perform. Blank when
// nothing claims the id, which is the one case an unlink alone is durable.
function claimLabel(r: LinkRow): string {
	if (r.claim_game_id === null) return "—";
	return `${r.claim_game_id} seat ${r.claim_seat_index} ${emdash(r.claim_seat_name)}`;
}

function evidenceCells(r: LinkRow): string[] {
	return [
		String(r.credited_seats),
		emdash(r.seat_names),
		String(r.claim_count),
		claimLabel(r),
	];
}

// ---------- online-ids check ----------

export async function runCheck(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { flags } = parseFlags(argv);
	const kindFlag = flagString(flags, "kind");
	if (kindFlag !== undefined && !CHECK_KINDS.includes(kindFlag as CheckKind)) {
		throw new Error(
			`Unknown --kind ${kindFlag}. Expected one of: ${CHECK_KINDS.join(", ")}.`,
		);
	}
	const kinds = kindFlag ? [kindFlag as CheckKind] : CHECK_KINDS;

	if (!opts.json) info(`Checking user_online_ids (${kinds.join(", ")})...`);

	const uncorroborated = kinds.includes("uncorroborated")
		? await d1Query<LinkRow>(UNCORROBORATED_SQL)
		: null;
	const ambiguous = kinds.includes("ambiguous")
		? await d1Query<AmbiguousRow>(AMBIGUOUS_SQL)
		: null;
	const nameMismatch = kinds.includes("name-mismatch")
		? await d1Query<LinkRow>(NAME_MISMATCH_SQL)
		: null;

	if (opts.json) {
		printJson({
			uncorroborated,
			ambiguous,
			name_mismatch: nameMismatch,
		});
		return;
	}

	let findings = 0;

	if (uncorroborated) {
		findings += uncorroborated.length;
		printSection(
			"Uncorroborated links",
			"The user has no claimed seat carrying this id. SEATS is how many public seats the link credits to them.",
			uncorroborated.length,
		);
		if (uncorroborated.length > 0) {
			printTable(
				[
					{ header: "USER_ID", width: 22 },
					{ header: "DISPLAY NAME", width: 18 },
					{ header: "ONLINE_ID", width: 18 },
					...EVIDENCE_COLUMNS,
					{ header: "FIRST SEEN", width: 16 },
				],
				uncorroborated.map((r) => [
					r.user_id,
					emdash(r.display_name),
					r.online_id,
					...evidenceCells(r),
					formatDate(r.first_seen_at),
				]),
			);
		}
	}

	if (ambiguous) {
		findings += ambiguous.length;
		printSection(
			"Ambiguous ids",
			"Claimed by more than one account, so the id resolves to nobody and SEATS is how many public seats lose their credit entirely. A shared account is a legitimate instance.",
			ambiguous.length,
		);
		if (ambiguous.length > 0) {
			printTable(
				[
					{ header: "ONLINE_ID", width: 18 },
					{ header: "OWNERS", width: 6, align: "right" },
					{ header: "USER_ID", width: 22 },
					{ header: "DISPLAY NAME", width: 18 },
					...EVIDENCE_COLUMNS,
					{ header: "FIRST SEEN", width: 16 },
				],
				ambiguous.map((r) => [
					r.online_id,
					String(r.owners),
					r.user_id,
					emdash(r.display_name),
					...evidenceCells(r),
					formatDate(r.first_seen_at),
				]),
			);
		}
	}

	if (nameMismatch) {
		findings += nameMismatch.length;
		printSection(
			"Name disagreement",
			"No seat carrying this id plays under a name the account answers to, though the account's own claimed seats do. Read the names before acting — an in-game name may differ from a Discord one.",
			nameMismatch.length,
		);
		if (nameMismatch.length > 0) {
			printTable(
				[
					{ header: "USER_ID", width: 22 },
					{ header: "DISPLAY NAME", width: 18 },
					{ header: "ONLINE_ID", width: 18 },
					...EVIDENCE_COLUMNS,
					{ header: "FIRST SEEN", width: 16 },
				],
				nameMismatch.map((r) => [
					r.user_id,
					emdash(r.display_name),
					r.online_id,
					...evidenceCells(r),
					formatDate(r.first_seen_at),
				]),
			);
		}
	}

	process.stdout.write("\n");
	printCount(findings, "link(s) flagged");
	if (findings > 0) {
		info(
			"Remove one with: ./per-ankh admin online-ids unlink <user_id> <online_id>",
		);
		info(
			"A link with a CLAIM returns on the next reparse until the claim moves:",
		);
		info("  ./per-ankh admin set-uploader <game_id> <player_index | observer>");
	}
}

function printSection(title: string, why: string, count: number): void {
	process.stdout.write(`\n${bold(title)}  ${dim(`(${count})`)}\n`);
	process.stdout.write(`${dim(why)}\n\n`);
	if (count === 0) process.stdout.write(`${dim("  none")}\n`);
}

// ---------- online-ids unlink ----------

type UnlinkTargetRow = LinkRow;

export async function runUnlink(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const userId = positional[0];
	const onlineId = positional[1];
	if (!userId || !onlineId) {
		throw new Error(
			"Usage: ./per-ankh admin online-ids unlink <user_id> <online_id>",
		);
	}

	// Read the row first so the command can report what it removed and no-op
	// cleanly when there is nothing linked — the shape remove-channel uses.
	const rows = await d1Query<UnlinkTargetRow>(`
		SELECT uo.user_id,
		       uo.online_id,
		       COALESCE(u.alias, u.display_name) AS display_name,
		       uo.first_seen_at,
		       uo.last_seen_at,
		       ${EVIDENCE_COLUMNS_SQL}
		  FROM user_online_ids uo
		  JOIN users u ON u.user_id = uo.user_id
		  ${CLAIM_JOIN_SQL}
		 WHERE uo.user_id = ${sqlStr(userId)} AND uo.online_id = ${sqlStr(onlineId)}`);
	const target = rows[0];
	if (!target) {
		if (opts.json) {
			printJson({
				user_id: userId,
				online_id: onlineId,
				removed: false,
				link: null,
			});
			return;
		}
		info(`No link between ${userId} and that online id. Nothing to remove.`);
		return;
	}

	if (!opts.json) {
		printDetail("Unlinking", [
			["User", `${emdash(target.display_name)} (${target.user_id})`],
			["Online ID", target.online_id],
			["First seen", formatDate(target.first_seen_at)],
			["Last seen", formatDate(target.last_seen_at)],
			["Seats credited", String(target.credited_seats)],
			["Seat names", emdash(target.seat_names)],
			["Own claims", String(target.claim_count)],
			["Claim to repair", claimLabel(target)],
		]);
		// A claim re-creates the link: reparse-all posts the stored seat back
		// and handleGameUpload re-captures its id. So the unlink is durable
		// only once the claim moves, and the operator is told which game and
		// which seat that is rather than finding out at the next parser bump.
		if (target.claim_game_id !== null) {
			warn(
				`This link returns on the next reparse. Move the claim first: ./per-ankh admin set-uploader ${target.claim_game_id} <player_index | observer>`,
			);
		}
	}

	if (!opts.yes) {
		const yes = await confirmTyping(
			`Remove this link? ${target.credited_seats} public seat(s) stop being credited to ${emdash(target.display_name)}.`,
			"unlink",
		);
		if (!yes) {
			info("Cancelled.");
			return;
		}
	}

	await d1Exec(
		`DELETE FROM user_online_ids
		  WHERE user_id = ${sqlStr(userId)} AND online_id = ${sqlStr(onlineId)}`,
	);

	// Audited under its own event_type rather than the Worker's
	// `online_id_remove`, for the reason `delete_game` is not `delete`: the two
	// have different actors and the trail has to tell them apart. `online_id`
	// in metadata stays in D1 — the log sinks' PII deny-list drops it, the same
	// way it does for handleRemoveOnlineId's event.
	const metadata = JSON.stringify({
		online_id: onlineId,
		display_name: target.display_name,
		credited_seats: target.credited_seats,
		claim_count: target.claim_count,
		claim_game_id: target.claim_game_id,
	});
	await d1Exec(`
		INSERT INTO events (event_type, user_id, metadata)
		VALUES ('unlink_online_id', ${sqlStr(userId)}, ${sqlStr(metadata)})
	`);

	if (opts.json) {
		printJson({
			user_id: userId,
			online_id: onlineId,
			removed: true,
			link: target,
		});
		return;
	}
	ok(
		`Unlinked ${target.online_id} from ${emdash(target.display_name)} (${target.credited_seats} seat(s) affected).`,
	);
}

// ---------- Router ----------

export async function run(argv: string[], opts: CommandOpts): Promise<void> {
	const sub = argv[0];
	const rest = argv.slice(1);
	switch (sub) {
		case "check":
			return runCheck(rest, opts);
		case "unlink":
			return runUnlink(rest, opts);
		default:
			throw new Error(
				[
					"Usage:",
					"  ./per-ankh admin online-ids check [--kind uncorroborated|ambiguous|name-mismatch]",
					"  ./per-ankh admin online-ids unlink <user_id> <online_id>",
				].join("\n"),
			);
	}
}
