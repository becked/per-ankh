// `./per-ankh admin reindex-all` — rebuild every game's derived D1 rows from
// its stored blob, headless.
//
// WHY THIS EXISTS. A reindex was a browser job: `BulkReindexModal` posts to
// the reindex endpoint one game at a time from a tab. Nothing about the work
// needs the browser — the Worker reads the blob and runs the D1 pivot — so
// this command is the same loop without the tab.
//
// WHAT RUNS WHERE. Nothing is downloaded or parsed here. The selection reads
// D1 through wrangler like every other admin command. Each game is then one
// POST to `/v1/admin/games/:id/reindex`, the endpoint the browser sweep posts
// to, authenticated with ADMIN_CLI_TOKEN (worker-sweep.ts). The rebuild is the
// Worker's `handleAdminReindex`: it deletes and rebuilds the derived child
// tables, bumps `games.updated_at`, writes the `admin_reindex` audit row, and
// clears every stats bundle. So unlike reparse-all, this command has no write
// of its own.

import { apiBase, d1Query, getTarget, sqlStr } from "../wrangler";
import {
	ADMIN_AUTH_REJECTED,
	OUTCOME_COLUMNS,
	gameLabel,
	readWorkerError,
	resolveAdminCliToken,
	warnNoAdminCliToken,
} from "../worker-sweep";
import type { CommandOpts } from "../../lib/cli";
import {
	flagInt,
	flagPositiveInt,
	flagString,
	parseFlags,
	printJson,
} from "../../lib/cli";
import { confirmTyping } from "../../lib/confirm";
import {
	bold,
	dim,
	emdash,
	info,
	ok,
	printTable,
	trunc,
	warn,
} from "../../lib/format";
import { mapLimit } from "../../lib/map-limit";

// The same ceiling reparse-all posts at. Each reindex is one D1 batch on the
// primary, the same pivot a reparse upload writes.
const DEFAULT_CONCURRENCY = 4;

interface SweepGame {
	game_id: string;
	user_id: string;
	game_name: string | null;
	// `games.display_name` — the owner's rename of the game. NOT the owner's
	// name: that is `users.display_name`, joined below as owner_name.
	display_name: string | null;
	owner_name: string | null;
}

type Outcome =
	| { kind: "reindexed" }
	// The games row exists but its parsed blob is not in R2 (BLOB_MISSING).
	| { kind: "missing" }
	| { kind: "failed"; why: string };

interface Result {
	game: SweepGame;
	outcome: Outcome;
}

// Every game, not a stale subset: a reindex re-runs the pivot from the blob
// the game already has, so there is no version to compare against. The same
// set handleAdminListAllGames returns to the browser sweep.
async function loadGames(
	userId: string | undefined,
	limit: number | undefined,
): Promise<SweepGame[]> {
	return d1Query<SweepGame>(
		`SELECT g.game_id, g.user_id, g.game_name, g.display_name,
		        u.display_name AS owner_name
		   FROM games g
		   LEFT JOIN users u ON u.user_id = g.user_id
		  ${userId ? `WHERE g.user_id = ${sqlStr(userId)}` : ""}
		  ORDER BY g.created_at DESC
		  ${limit === undefined ? "" : `LIMIT ${limit}`}`,
	);
}

async function postReindex(game: SweepGame, token: string): Promise<Outcome> {
	try {
		const res = await fetch(
			`${apiBase()}/admin/games/${game.game_id}/reindex`,
			{
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
			},
		);
		if (res.ok) return { kind: "reindexed" };
		const body = await readWorkerError(res);
		if (res.status === 404 && body.code === "BLOB_MISSING") {
			return { kind: "missing" };
		}
		// The handler answers the same 404 NOT_FOUND for a rejected admin and
		// for a game that no longer exists. The second happens when an owner
		// deletes a game between the selection and its POST.
		if (res.status === 404) {
			return {
				kind: "failed",
				why: `404 — ${ADMIN_AUTH_REJECTED}, or the game was deleted since it was listed`,
			};
		}
		const detail = `${res.status} ${body.code ?? ""}`.trim();
		return {
			kind: "failed",
			why: `${detail}: ${body.error ?? "reindex failed"}`,
		};
	} catch (e) {
		return { kind: "failed", why: e instanceof Error ? e.message : String(e) };
	}
}

function describe(outcome: Outcome): string {
	switch (outcome.kind) {
		case "reindexed":
			return "reindexed";
		case "missing":
			return "no parsed blob in R2";
		case "failed":
			return `failed: ${outcome.why}`;
	}
}

export async function run(args: string[], opts: CommandOpts): Promise<void> {
	const { flags } = parseFlags(args);
	const userId = flagString(flags, "user");
	const limit = flagPositiveInt(flags, "limit");
	const concurrency = flagInt(flags, "concurrency", DEFAULT_CONCURRENCY);
	const dryRun = flags["dry-run"] !== undefined;

	const games = await loadGames(userId, limit);
	if (games.length === 0) {
		ok(userId ? `No games owned by ${userId}.` : "No games.");
		return;
	}
	info(`${games.length} game(s) to reindex`);

	if (dryRun) {
		if (opts.json) {
			printJson({ target: getTarget(), dry_run: true, games });
			return;
		}
		printTable(
			[
				{ header: "Game", width: 34 },
				{ header: "Owner", width: 22 },
			],
			games.map((g) => [
				trunc(gameLabel(g), 34),
				trunc(emdash(g.owner_name), 22),
			]),
		);
		return;
	}

	const token = resolveAdminCliToken();
	if (!token) {
		warnNoAdminCliToken();
		process.exitCode = 1;
		return;
	}

	// A reindex is a write per game: it deletes and rebuilds the game's
	// derived rows, and each one clears every stats bundle. Against prod, over
	// the whole corpus, that is worth typing for.
	if (!opts.yes) {
		const yes = await confirmTyping(
			`REINDEX ${games.length} game(s) on ${bold(getTarget())}.\n` +
				`  Each one: rebuild its derived D1 rows from its stored blob.\n` +
				`  The games row and R2 are untouched; every stats bundle is cleared.`,
			"reindex",
		);
		if (!yes) {
			warn("Aborted.");
			return;
		}
	}

	info(`Reindexing (${concurrency} at a time)`);

	const results: Result[] = [];
	await mapLimit(games, concurrency, async (game, i) => {
		results.push({ game, outcome: await postReindex(game, token) });
		if ((i + 1) % 25 === 0) info(`  …${i + 1}/${games.length}`);
	});

	const counts = { reindexed: 0, missing: 0, failed: 0 };
	for (const r of results) counts[r.outcome.kind]++;

	if (opts.json) {
		printJson({
			target: getTarget(),
			counts,
			results: results.map((r) => ({
				game_id: r.game.game_id,
				user_id: r.game.user_id,
				outcome: r.outcome.kind,
				detail: describe(r.outcome),
			})),
		});
		return;
	}

	// Only the rows that need a human: a reindex is the expected outcome and
	// says nothing a count doesn't.
	const notable = results.filter((r) => r.outcome.kind !== "reindexed");
	if (notable.length > 0) {
		printTable(
			OUTCOME_COLUMNS,
			notable.map((r) => [
				trunc(gameLabel(r.game), 34),
				trunc(emdash(r.game.owner_name), 22),
				trunc(describe(r.outcome), 44),
			]),
		);
	}
	process.stdout.write(
		`\n${bold(`${counts.reindexed} reindexed`)} of ${games.length}\n` +
			`${dim(`missing blob ${counts.missing}, failed ${counts.failed}`)}\n`,
	);
	if (counts.failed > 0) process.exitCode = 1;
}
