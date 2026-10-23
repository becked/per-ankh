// `./per-ankh admin reparse-all` — reparse every game whose stored
// parser_version isn't the current one, headless.
//
// WHY THIS EXISTS. A reparse was a browser job: `BulkReparseModal` drives
// download → parse → re-upload one game at a time in a tab, because the parser
// ran in a Web Worker. Nothing in the parser is browser-bound, though —
// src/lib/parser/ imports only `fflate` and `fast-xml-parser`, and
// test-data/saves/README.md documents the headless loop — so the Web Worker is
// a responsiveness wrapper, not a capability. This command is that loop over
// the corpus.
//
// WHAT RUNS WHERE. The parse is local; every D1 and R2 WRITE is the Worker's.
// `handleGameUpload`'s re-import branch is ~1,000 lines of correctness —
// cascading child deletes, screenshot and report capture-and-restore across the
// `INSERT OR REPLACE`, collection and tournament preservation, blob-cache key
// drift, the `admin_reimport` audit row — and reimplementing any of it against
// D1 directly would be a second, diverging reimport. So this posts to
// `POST /v1/admin/games/:user_id/reparse-upload`, the same endpoint the browser
// sweep posts to, and the only new thing on the Worker is the credential a
// sessionless client can present (ADMIN_CLI_TOKEN, cloud/src/admin.ts).
//
// The ZIP goes back over the wire even though R2 already holds the identical
// bytes. That is deliberate and load-bearing, not an oversight: the dedup that
// turns an upload into a re-import is keyed on SHA-256 of the posted ZIP per
// (user_id, file_hash), so the bytes ARE the match key. Posting them is what
// makes the Worker recognize the game instead of creating a second one.
//
// Reads go through wrangler like every other admin command — D1 for the stale
// list, R2 for `saves/<game_id>.zip` — so the token is scoped to the one write
// the CLI cannot do for itself. Downloads are cached on disk and reused, so a
// re-run after a failure costs no further remote reads.
//
// One write is the command's own, and it is a cache clear rather than a
// record: the stats bundles in KV, once at the end of a run that rewrote
// anything, through the same helper `admin cache clear stats` uses. The call
// site says why nothing else rebuilds them inside a day.

import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { apiBase, d1Query, getTarget, isLocal, sqlStr } from "../wrangler";
import { clearStatsBundles } from "./cache";
import { readCachedSave } from "../saves";
import { uploaderPlayerIndexSql } from "../../../cloud/src/games-scope";
import type { CommandOpts } from "../../lib/cli";
import { flagInt, flagString, parseFlags, printJson } from "../../lib/cli";
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
	type Column,
} from "../../lib/format";
import { DEV_VARS_PATH, readDotVars } from "../../lib/dotvars";
import { mapLimit } from "../../lib/map-limit";
import { ParseError } from "../../../src/lib/parser/extract-zip";
import {
	parseActivePlayerIndex,
	parseSaveXml,
} from "../../../src/lib/parser/parse-xml";
import { extractAllGameData } from "../../../src/lib/parser/parsers/index";
import { PARSER_VERSION } from "../../../src/lib/parser/types";
import { gzipJson } from "../../../src/lib/parser/upload-helpers";
import { validateCompletedGame } from "../../../src/lib/parser/validation";

// The credential, by the same split purge.ts documents: committed config comes
// from the environment table, a secret comes from the process environment,
// because the CLI has no secret store of its own and the Worker holds its own
// copy as a `wrangler secret`. Same name on both sides so there is no
// translation to remember.
const TOKEN_ENV = "ADMIN_CLI_TOKEN";

// Each in-flight game holds a decompressed save and its parse tree in memory
// (~20 MB of tree per file — docs/save-file-format.md, "DOM memory caution"),
// so the ceiling bounds heap as much as it bounds wrangler spawns.
const DEFAULT_CONCURRENCY = 4;

interface StaleGame {
	game_id: string;
	user_id: string;
	game_name: string | null;
	// `games.display_name` — the owner's rename of the game. Preferred over
	// game_name for a label, the way handleAdminListAllGames does it. NOT the
	// owner's name: that is `users.display_name`, joined below as owner_name.
	display_name: string | null;
	owner_name: string | null;
	// The seat the uploader claimed (`player_summaries.is_uploader`), posted
	// back verbatim so the reparse re-claims the same player. Null means the
	// original was an observer upload and stays one.
	uploader_player_index: number | null;
	parser_version: string;
}

type Outcome =
	// Reparsed: the Worker recognized the save and replaced the blob.
	| { kind: "reimported"; from: string }
	// Accepted as a NEW game. Should not happen on this path — it means the
	// posted ZIP didn't match the stored file_hash — so it is reported apart
	// from a re-import rather than counted with it.
	| { kind: "created" }
	// The Worker declined to act, and was right to: same-or-older parse
	// (409 DUPLICATE), or a save the reparse path structurally can't carry.
	| { kind: "skipped"; why: string }
	| { kind: "missing" }
	| { kind: "failed"; why: string };

interface Result {
	game: StaleGame;
	outcome: Outcome;
}

const label = (g: StaleGame): string =>
	g.display_name ?? g.game_name ?? g.game_id;

function resolveToken(): string | null {
	const fromEnv = process.env[TOKEN_ENV];
	if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
	// Local only: `wrangler dev` loads cloud/.dev.vars, so the Worker's token
	// is already written down there. Reading it is what keeps a local sweep
	// from 401ing because the operator exported a different value than the
	// Worker is running with — the same reason scripts/ux-review/discover.ts
	// reads ADMIN_DISCORD_ID from that file. Never for a remote target: there
	// the file has no authority over what the deployed Worker holds.
	if (isLocal()) {
		const fromDotVars = readDotVars(DEV_VARS_PATH)[TOKEN_ENV];
		if (fromDotVars) return fromDotVars;
	}
	return null;
}

// The stale set. The destination is never a choice — the blob this sweep posts
// is whatever the local parse produces, so it carries THIS checkout's
// PARSER_VERSION — which is why the predicate is pinned to that version. It is
// the one the Worker's own reparse lists use (`parser_version != ?` —
// handleGamesOutOfDate / handleAdminListOutOfDate), restated here because every
// admin command reaches D1 through wrangler rather than through the API;
// `parser_version` is NOT NULL (migration 0002), so the plain `!=` matches every
// out-of-date row. `--from-version` narrows that set to one stored cohort and
// can only narrow it: a game already at PARSER_VERSION is never selected, so no
// run spends a download, a parse and an upload to earn a 409.
async function loadStale(
	fromVersion: string | undefined,
	userId: string | undefined,
	limit: number | undefined,
): Promise<StaleGame[]> {
	const where = [`g.parser_version != ${sqlStr(PARSER_VERSION)}`];
	if (fromVersion) where.push(`g.parser_version = ${sqlStr(fromVersion)}`);
	if (userId) where.push(`g.user_id = ${sqlStr(userId)}`);
	// The uploader seat comes from the Worker's own helper rather than a copy
	// of it: this sweep and the browser post the value back to the same
	// endpoint, so a divergence would be a reparse that changes whose game it
	// is. games-scope.ts is importable here where games.ts is not — see its
	// comment on this fragment.
	return d1Query<StaleGame>(
		`SELECT g.game_id, g.user_id, g.game_name, g.display_name,
		        u.display_name AS owner_name, g.parser_version,
		        ${uploaderPlayerIndexSql("g")} AS uploader_player_index
		   FROM games g
		   LEFT JOIN users u ON u.user_id = g.user_id
		  WHERE ${where.join(" AND ")}
		  ORDER BY g.created_at DESC
		  ${limit === undefined ? "" : `LIMIT ${limit}`}`,
	);
}

interface ApiError {
	error?: string;
	code?: string;
}

async function postReparse(
	game: StaleGame,
	zip: Buffer,
	blob: unknown,
	token: string,
): Promise<Outcome> {
	const form = new FormData();
	form.append("data", await gzipJson(blob), "game.json.gz");
	form.append(
		"save",
		new Blob([new Uint8Array(zip)], { type: "application/zip" }),
		`${game.game_id}.zip`,
	);
	form.append(
		"uploader_player_index",
		JSON.stringify(game.uploader_player_index),
	);

	const res = await fetch(
		`${apiBase()}/admin/games/${game.user_id}/reparse-upload`,
		{
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			body: form,
		},
	);
	if (res.ok) {
		const body = (await res.json()) as { reimported?: boolean };
		return body.reimported === true
			? { kind: "reimported", from: game.parser_version }
			: { kind: "created" };
	}
	let body: ApiError = {};
	try {
		body = (await res.json()) as ApiError;
	} catch {
		// Non-JSON error (a proxy, or a 404 from the route table) — the status
		// is all there is to report.
	}
	const detail = `${res.status} ${body.code ?? ""}`.trim();
	// A same-or-older parse is the Worker refusing to downgrade a blob, which
	// is correct and not a sweep failure: it happens when this checkout is
	// behind the deployed frontend.
	if (res.status === 409) {
		return { kind: "skipped", why: `${detail} — stored parse is not older` };
	}
	// A 404 is deliberately ambiguous on this endpoint — the handler answers it
	// for a rejected admin so the route's existence doesn't leak — and the
	// route table answers the same 404 when the path doesn't match, which for
	// this one means a user_id that isn't a 21-character nanoid. Both are
	// worth naming: the first is the likely cause in normal operation, the
	// second is what a hand-seeded fixture hits.
	if (res.status === 404) {
		return {
			kind: "failed",
			why:
				`404 — admin auth rejected (is ${TOKEN_ENV} the value the Worker ` +
				`holds, and has that Discord account signed in?), or user_id ` +
				`${game.user_id} is not a 21-char id`,
		};
	}
	return { kind: "failed", why: `${detail}: ${body.error ?? "upload failed"}` };
}

async function processOne(
	game: StaleGame,
	cacheDir: string,
	token: string,
): Promise<Outcome> {
	try {
		const save = await readCachedSave(game.game_id, cacheDir);
		if (!save) return { kind: "missing" };
		const data = extractAllGameData(
			parseSaveXml(save.xml),
			parseActivePlayerIndex(save.xml),
			save.entryName,
		);
		// The one completion gate (src/lib/parser/validation.ts), checked here
		// rather than spending an upload on a 400: an admin reparse cannot carry
		// `challenge_id` (handleGameUpload refuses it), and without it the
		// Worker's `game_over` gate rejects the save — so a challenge map or run,
		// which is an in-progress game by definition, is not reparsable through
		// this endpoint by anyone, browser sweep included. It throws, and the
		// catch below maps its NOT_COMPLETED back to a named skip, because that
		// is a property of the game rather than a fault in this run.
		validateCompletedGame(data);
		return postReparse(game, save.zip, data, token);
	} catch (e) {
		if (e instanceof ParseError && e.code === "NOT_COMPLETED") {
			return {
				kind: "skipped",
				why: "not a completed game — the reparse path can't carry challenge_id",
			};
		}
		return { kind: "failed", why: e instanceof Error ? e.message : String(e) };
	}
}

const OUTCOME_COLUMNS: Column[] = [
	{ header: "Game", width: 34 },
	{ header: "Owner", width: 22 },
	{ header: "Result", width: 44 },
];

function describe(outcome: Outcome): string {
	switch (outcome.kind) {
		case "reimported":
			return `reimported from ${outcome.from}`;
		case "created":
			return "created a NEW game (zip did not match stored hash)";
		case "skipped":
			return `skipped: ${outcome.why}`;
		case "missing":
			return "no save object in R2";
		case "failed":
			return `failed: ${outcome.why}`;
	}
}

export async function run(args: string[], opts: CommandOpts): Promise<void> {
	const { flags } = parseFlags(args);
	// Selection, not destination: every reparse writes PARSER_VERSION, so this
	// picks which stored cohort to sweep (`--from-version 2.15.0` for the 2.15.0
	// games and nothing else).
	const fromVersion = flagString(flags, "from-version");
	if (fromVersion === PARSER_VERSION) {
		throw new Error(
			`--from-version ${PARSER_VERSION} is this checkout's own parser ` +
				`version — those games are already current.`,
		);
	}
	const userId = flagString(flags, "user");
	let limit: number | undefined;
	if (flags.limit !== undefined) {
		// flagInt falls back for a bare `--limit`, `--limit 0` and `--limit abc`,
		// and a LIMIT 0 sweep would report "nothing to do" the way a corpus
		// already at PARSER_VERSION does.
		limit = flagInt(flags, "limit", 0);
		if (limit <= 0) throw new Error("--limit takes a positive integer");
	}
	const concurrency = flagInt(flags, "concurrency", DEFAULT_CONCURRENCY);
	const dryRun = flags["dry-run"] !== undefined;
	const cacheDir = resolve(
		flagString(flags, "cache-dir") ??
			resolve(tmpdir(), "per-ankh-reparse-saves"),
	);

	const games = await loadStale(fromVersion, userId, limit);
	if (games.length === 0) {
		ok(
			fromVersion
				? `No games stored at parser ${fromVersion}.`
				: `No games with a parser_version other than ${PARSER_VERSION}.`,
		);
		return;
	}

	const byVersion = new Map<string, number>();
	for (const g of games) {
		byVersion.set(g.parser_version, (byVersion.get(g.parser_version) ?? 0) + 1);
	}
	const spread = [...byVersion]
		.sort((a, b) => b[1] - a[1])
		.map(([v, n]) => `${v} ${n}`)
		.join(", ");
	info(
		`${games.length} game(s) to reparse to ${PARSER_VERSION} — from ${spread}`,
	);

	if (dryRun) {
		if (opts.json) {
			printJson({
				to_version: PARSER_VERSION,
				target: getTarget(),
				dry_run: true,
				games,
			});
			return;
		}
		printTable(
			[
				{ header: "Game", width: 34 },
				{ header: "Owner", width: 22 },
				{ header: "Stored", width: 10 },
			],
			games.map((g) => [
				trunc(label(g), 34),
				trunc(emdash(g.owner_name), 22),
				g.parser_version,
			]),
		);
		return;
	}

	const token = resolveToken();
	if (!token) {
		warn(
			`${TOKEN_ENV} is not set. The sweep posts each reparse to the Worker, ` +
				`which accepts a sessionless admin only with this token:\n` +
				`  export ${TOKEN_ENV}=…   (the value set via ` +
				`\`wrangler secret put ${TOKEN_ENV}\`)\n` +
				(isLocal()
					? `  or put it in cloud/.dev.vars, which \`./per-ankh dev\` loads.\n`
					: "") +
				`Re-run with --dry-run to see what it would touch without it.`,
		);
		process.exitCode = 1;
		return;
	}

	// A reparse is a write per game: an INSERT OR REPLACE on the games row
	// with cascading child deletes, plus an R2 blob overwrite and an audit
	// row. Against prod, over the whole corpus, that is worth typing for.
	if (!opts.yes) {
		const yes = await confirmTyping(
			`REPARSE ${games.length} game(s) on ${bold(getTarget())} to parser ${PARSER_VERSION}.\n` +
				`  Each one: re-upload its save, replace its blob and derived rows.\n` +
				`  Owners' games are rewritten in place; screenshots and collections survive.`,
			"reparse",
		);
		if (!yes) {
			warn("Aborted.");
			return;
		}
	}

	await mkdir(cacheDir, { recursive: true });
	info(`Reparsing (${concurrency} at a time), cache: ${cacheDir}`);

	const results: Result[] = [];
	await mapLimit(games, concurrency, async (game, i) => {
		results.push({ game, outcome: await processOne(game, cacheDir, token) });
		if ((i + 1) % 25 === 0) info(`  …${i + 1}/${games.length}`);
	});

	const counts = {
		reimported: 0,
		created: 0,
		skipped: 0,
		missing: 0,
		failed: 0,
	};
	for (const r of results) counts[r.outcome.kind]++;

	// Flush the stats bundles once, after the sweep rather than per game.
	// Every reparse rewrote that game's game_player_turn rows, which all three
	// bundle kinds aggregate — and no bundle key drifts on a reparse, so a
	// present-but-stale entry is served for its full 24h TTL. The Worker's own
	// invalidation on an upload only reaches the uploader's bundle
	// (handleGameUpload), the nightly precompute rebuilds the global slices
	// hours later, the hourly warm rebuilds only the ones that are *missing*,
	// and a tournament bundle has no cron at all. Over hundreds of games that
	// leaves a corpus whose numbers predate the sweep: a band that is all-null
	// only because the backfill hasn't landed reads as a corpus with nothing
	// to show. Nothing to flush when nothing was written — a run that only
	// skipped (409s, missing saves, parse failures) left the corpus alone.
	const wrote = counts.reimported + counts.created > 0;
	const statsCleared = wrote ? await clearStatsBundles() : 0;

	if (opts.json) {
		printJson({
			to_version: PARSER_VERSION,
			target: getTarget(),
			counts,
			stats_bundles_cleared: statsCleared,
			results: results.map((r) => ({
				game_id: r.game.game_id,
				user_id: r.game.user_id,
				from_version: r.game.parser_version,
				outcome: r.outcome.kind,
				detail: describe(r.outcome),
			})),
		});
		return;
	}

	// Only the rows that need a human: a reimport is the expected outcome and
	// says nothing a count doesn't.
	const notable = results.filter((r) => r.outcome.kind !== "reimported");
	if (notable.length > 0) {
		printTable(
			OUTCOME_COLUMNS,
			notable.map((r) => [
				trunc(label(r.game), 34),
				trunc(emdash(r.game.owner_name), 22),
				trunc(describe(r.outcome), 44),
			]),
		);
	}
	process.stdout.write(
		`\n${bold(`${counts.reimported} reparsed`)} of ${games.length}\n` +
			`${dim(
				`skipped ${counts.skipped}, missing save ${counts.missing}, ` +
					`failed ${counts.failed}, new games ${counts.created}\n` +
					`cleared ${statsCleared} stats bundle(s) — next /stats read ` +
					`recomputes from D1`,
			)}\n`,
	);
	if (counts.failed > 0) process.exitCode = 1;
}
