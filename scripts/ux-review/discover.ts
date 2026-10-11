// Local-only discovery for the UX-review capture: which game and user the
// walkthrough runs against, and the session that unlocks the signed-in pass.
//
// Every call here goes through the admin CLI's wrangler wrapper
// (scripts/admin/wrangler.ts) with the target pinned to `local`, so this
// module reads the .wrangler dev state and never production.

import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { VISIBLE_TO_VIEWER_WHERE } from "../../cloud/src/screenshots/scope";
import { readDotVars } from "../lib/dotvars";
import { info, warn } from "../lib/format";
import {
	d1Query,
	kvBulkDelete,
	kvPutSession,
	r2Get,
	sqlStr,
} from "../admin/wrangler";

// scripts/ux-review/ → repo root is two levels up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEV_VARS = resolve(REPO_ROOT, "cloud", ".dev.vars");

// Matches cloud/src/session.ts SESSION_TTL_SECONDS.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

// Candidates probed in parallel per round. Local D1 rows and local R2 objects
// drift apart freely — a restored D1 backup carries every game row while R2
// only holds the blobs actually uploaded here — so most public games can be
// unrenderable (3.6% were present when this was written) and the first hit
// can be dozens of probes in. A wrangler spawn is ~0.8s and dominates the
// wall clock, so probe a round at a time and stop at the first hit rather
// than walking the list one process at a time.
const PROBE_BATCH = 10;

interface GameRow {
	game_id: string;
	user_id: string;
}

interface UserRow {
	discord_username: string | null;
	discord_id: string | null;
}

// Does this game's save blob actually exist in local R2?
//
// It is not knowable from D1: `games.blob_size_bytes` records what was
// uploaded, not what survived, and a game row whose object is gone still
// reports a size. The API answers such a game with 404 BLOB_MISSING, which
// costs the whole game-detail walkthrough — hence a probe rather than
// smarter SQL.
//
// r2Get is the wrapper's only existence check and it downloads, but a local
// object is a file copy off .wrangler state and the copy is discarded here,
// so the real cost of a probe is the wrangler spawn either way.
async function hasBlob(gameId: string): Promise<boolean> {
	// Random suffix, not the game id: probes run concurrently and the id is
	// never a safe path component on its own.
	const dest = join(
		tmpdir(),
		`per-ankh-ux-probe-${randomBytes(6).toString("hex")}.json.gz`,
	);
	try {
		return await r2Get(`games/${gameId}.json.gz`, dest);
	} finally {
		await rm(dest, { force: true });
	}
}

// The first candidate whose blob is present, probed a round at a time. Null
// when none of them has one; what that means is the caller's to decide.
async function firstWithBlob(candidates: GameRow[]): Promise<GameRow | null> {
	for (let i = 0; i < candidates.length; i += PROBE_BATCH) {
		const batch = candidates.slice(i, i + PROBE_BATCH);
		const present = await Promise.all(batch.map((r) => hasBlob(r.game_id)));
		const hit = present.indexOf(true);
		if (hit !== -1) {
			info(
				`  ${batch[hit].game_id}: blob present ` +
					`(probe ${i + hit + 1} of ${candidates.length})`,
			);
			return batch[hit];
		}
		info(`  ${i + batch.length}/${candidates.length} probed, no blob yet…`);
	}
	return null;
}

// Pick a public game that renders, plus its owner (who therefore has at
// least one public game — what the anonymous profile pass needs).
//
// Random rather than "longest", so successive bundles walk different games
// and the review isn't permanently anchored to one save. A run is therefore
// not reproducible by re-running it; `--game-id` (the id every bundle records
// in manifest.json) reproduces a specific one.
export async function discoverGame(): Promise<GameRow> {
	let rows: GameRow[];
	try {
		rows = await d1Query<GameRow>(
			"SELECT game_id, user_id FROM games WHERE is_public = 1 ORDER BY RANDOM();",
		);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new Error(
			`Auto-discovery via wrangler failed (${msg}). ` +
				`Pass --game-id and --user-id explicitly.`,
		);
	}
	const candidates = rows.filter((r) => r.game_id && r.user_id);
	if (candidates.length === 0) {
		throw new Error(
			"No public game found in local D1. Mark a game public or pass " +
				"--game-id / --user-id.",
		);
	}

	const found = await firstWithBlob(candidates);
	if (found) return found;
	throw new Error(
		`Probed all ${candidates.length} public games; none has a blob in local ` +
			`R2, so none would render. Upload a save locally or pass --game-id.`,
	);
}

// A public game that holds a screenshot an anonymous visitor would be sent,
// for the screenshots view and nothing else. The walked game is picked at
// random and almost no game has a screenshot, so capturing
// /games/[id]/screenshots on it would shoot the "No screenshots." state every
// run — the one state that view has which the toggle above it never offers.
//
// Null rather than a throw when there is none to show: local D1 carrying no
// screenshot is the ordinary case on a fresh checkout, and it drops one view
// from the bundle the way a checkout with no tournament drops the tournament
// detail page.
//
// The visibility rule is the Worker's own fragment, with the viewer bound as
// NULL because this asks what the ANONYMOUS pass would see — the stricter of
// the two passes, and the fragment's uploader leg cannot fire on a NULL
// comparison (cloud/src/screenshots/scope.ts says so). A hand-copied
// `hidden_at IS NULL` here would be one more reader of that rule holding only
// while the copies happen to agree, and the symptom of a disagreement is a
// capture of the empty state with no indication that it is wrong.
export async function discoverScreenshotGame(): Promise<GameRow | null> {
	let rows: GameRow[];
	try {
		rows = await d1Query<GameRow>(
			"SELECT g.game_id AS game_id, g.user_id AS user_id " +
				"FROM game_screenshots s JOIN games g ON g.game_id = s.game_id " +
				`WHERE g.is_public = 1 AND ${VISIBLE_TO_VIEWER_WHERE.replace("?", "NULL")} ` +
				"GROUP BY g.game_id ORDER BY RANDOM();",
		);
	} catch (e: unknown) {
		// A checkout whose D1 predates the screenshots table reads as "no
		// screenshot to capture", which is what it is — but so would a wrangler
		// that cannot reach local D1 at all, so say which one happened rather
		// than dropping a view in silence.
		const msg = e instanceof Error ? e.message : String(e);
		warn(`Screenshot-game discovery failed (${msg}); skipping that view.`);
		return null;
	}
	return firstWithBlob(rows.filter((r) => r.game_id && r.user_id));
}

// ADMIN_DISCORD_ID from cloud/.dev.vars. Null when the file is absent or the
// var is unset — both read as "this checkout has no local admin".
function adminDiscordId(): string | null {
	const v = readDotVars(DEV_VARS).ADMIN_DISCORD_ID;
	return v != null && v !== "" ? v : null;
}

// The local site admin's user_id — the default identity for the signed-in
// pass, so /admin and the tournament beta gate stay captured however the
// random game's ownership falls. Null when there is no local admin, or no
// user row carries their discord_id (a checkout whose D1 predates them).
export async function lookupAdminUserId(): Promise<string | null> {
	const discordId = adminDiscordId();
	if (discordId == null) return null;
	const rows = await d1Query<{ user_id: string }>(
		`SELECT user_id FROM users WHERE discord_id = ${sqlStr(discordId)};`,
	);
	return rows[0]?.user_id ?? null;
}

// The owner of a game. Auto-discovery pairs a game with its owner (who
// therefore has at least one public game — what the anonymous profile pass
// needs); this resolves the same pairing for a pinned --game-id, and tells
// the signed-in pass whether it is looking at its own game.
export async function lookupGameOwner(gameId: string): Promise<string> {
	const rows = await d1Query<{ user_id: string }>(
		`SELECT user_id FROM games WHERE game_id = ${sqlStr(gameId)};`,
	);
	const userId = rows[0]?.user_id;
	if (!userId) {
		throw new Error(`No local game ${gameId} (for --game-id).`);
	}
	return userId;
}

// Resolve the sign-in user: discord_username for the session payload, plus
// whether they're the local site admin (gates the /admin capture).
export async function lookupAuthUser(
	userId: string,
): Promise<{ discordUsername: string; isAdmin: boolean }> {
	const row = (
		await d1Query<UserRow>(
			`SELECT discord_username, discord_id FROM users WHERE user_id = ${sqlStr(userId)};`,
		)
	)[0];
	if (!row) {
		throw new Error(`No local user ${userId} (for --auth-user-id).`);
	}
	const discordId = adminDiscordId();
	return {
		discordUsername: row.discord_username ?? "",
		isAdmin: discordId != null && row.discord_id === discordId,
	};
}

export async function discoverTournamentSlug(): Promise<string | null> {
	try {
		const rows = await d1Query<{ slug: string }>(
			"SELECT slug FROM tournaments LIMIT 1;",
		);
		return rows[0]?.slug ?? null;
	} catch {
		return null;
	}
}

// Mint a session in local KV (the *preview* namespace `wrangler dev --local`
// binds KV to — kvPutSession passes --preview for the local target) and
// return the opaque token. The token value is arbitrary — readSession looks
// it up by exact key — so a URL-safe random string is fine.
export async function mintLocalSession(
	userId: string,
	discordUsername: string,
): Promise<string> {
	const token = randomBytes(24).toString("base64url");
	await kvPutSession(
		`session:${token}`,
		JSON.stringify({ user_id: userId, discord_username: discordUsername }),
		SESSION_TTL_SECONDS,
	);
	return token;
}

export async function deleteLocalSession(token: string): Promise<void> {
	try {
		await kvBulkDelete([`session:${token}`]);
	} catch {
		// Best-effort; the key carries a 30-day TTL and is local-only.
	}
}
