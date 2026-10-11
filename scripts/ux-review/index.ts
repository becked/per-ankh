// `./per-ankh ux-review` — capture a UX-review walkthrough of the app against
// the running dev server and emit a reviewable bundle at docs/ux-review/:
// separate per-shot JPGs, an interactive HTML viewer, a machine-readable
// manifest, and a README.
//
// Why a folder (not one inlined HTML): the bundle is consumed by both humans
// (open index.html) and a Claude Code reviewer. Claude's file reader renders
// standalone JPGs visually but can't pull an image out of a base64 data: URI
// embedded in HTML, and a multi-MB inlined file is unreadable to it. Separate
// files + manifest.json let the agent triage from the manifest, then read only
// the shots it cares about. Per-file assets also keep git diffs sane.
//
// The walkthrough runs across three viewports (desktop / tablet / mobile) and
// two auth states:
//
//   Anonymous  — the signed-out surface. Only five routes render real
//                content without a session: / , /games/[id] (14 tabs),
//                /games/[id]/map, /games/[id]/screenshots, /users/[user_id]
//                (3 tabs, plus Screenshots on a profile that has one).
//                Everything else redirects to /?next=… .
//
//   Signed in  — the same browser with a real session cookie minted for a
//                local user (the local ADMIN_DISCORD_ID user by default, so
//                the gated surfaces stay captured however the random game's
//                ownership falls). Unlocks the authenticated surface: / ,
//                /users/[user_id] (owner), /account, /games/[id] and
//                /games/[id]/map (owner only when that user owns the game
//                picked), /games/[id]/screenshots, /tournaments,
//                /tournaments/[slug], /admin (4 tabs, when the auth user is
//                the local ADMIN_DISCORD_ID), plus a redirect-verification
//                note for /dashboard, /games, /auth/callback.
//
// Auth mechanism: a session is just a `session` cookie carrying an opaque
// token mapping in SESSIONS_KV to {user_id, discord_username} (see
// cloud/src/session.ts). We mint one in the local *preview* KV namespace
// (what `wrangler dev --local` binds KV to) and inject the cookie into a
// Playwright context. localhost:1420 (SSR) and :8787 (Worker) are same-site,
// so one Lax cookie on host `localhost` reaches both SSR loads and client →
// Worker fetches. No OAuth round-trip (not drivable headless). The minted key
// is deleted on exit.
//
// Requirements:
//   1. The local dev server is up (`./per-ankh dev` — http://localhost:1420).
//   2. A public game whose blob is present in local R2. By default the run
//      discovers one (wrangler --local, no prod access); override with
//      --game-id / --user-id / --auth-user-id. The screenshots view needs a
//      second such game that also holds a screenshot, which is discovered the
//      same way and simply absent from the bundle when local D1 has none.

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

import { setTarget } from "../admin/wrangler";
import { flagString, parseFlags } from "../lib/cli";
import { info, ok } from "../lib/format";
import { BREAKPOINTS, captureAnon, captureAuth } from "./capture";
import {
	deleteLocalSession,
	discoverGame,
	discoverScreenshotGame,
	discoverTournamentSlug,
	lookupAdminUserId,
	lookupAuthUser,
	lookupGameOwner,
	mintLocalSession,
} from "./discover";
import { renderIndexHtml, renderReadme } from "./render";
import type { CaptureRecord, ReviewIds, Screen } from "./types";

const DEFAULT_BASE_URL = "http://localhost:1420";

// Resolved against the cwd, which is the repo root — ./per-ankh only runs
// from there, since tsx resolves the tsconfig path aliases the CLI's other
// command modules import against the cwd.
const OUT_DIR = path.resolve("docs", "ux-review");
const SHOTS_DIR = path.join(OUT_DIR, "shots");

// The files emitted alongside shots/. Named so the pre-run clear can remove
// exactly these and leave anything hand-authored in the directory alone
// (docs/ux-review/review.html is a hand-written analysis that lives there).
const GENERATED_FILES = ["manifest.json", "README.md", "index.html"];

const KNOWN_FLAGS = new Set([
	"base-url",
	"game-id",
	"user-id",
	"auth-user-id",
	"help",
]);

function printHelp(): void {
	process.stdout.write(
		[
			"per-ankh ux-review — capture the UX-review bundle into docs/ux-review/",
			"",
			"Usage:",
			"  ./per-ankh ux-review [--base-url URL] [--game-id ID] [--user-id ID]",
			"                       [--auth-user-id ID]",
			"",
			"Walks three breakpoints (desktop/tablet/mobile) across an anonymous and",
			"a signed-in pass, writing shots/, manifest.json, README.md and index.html.",
			"Reads local D1/R2/KV only (wrangler --local); never touches production.",
			"",
			"Flags:",
			"  --base-url URL      Dev server origin (default: " +
				DEFAULT_BASE_URL +
				")",
			"  --game-id ID        Pin the game whose detail tabs are walked",
			"                      (default: a random public game whose blob is",
			"                      present in local R2)",
			"  --user-id ID        Pin the publicly-viewed profile",
			"                      (default: the game's owner)",
			"  --auth-user-id ID   Pin the user the signed-in pass runs as",
			"                      (default: the local ADMIN_DISCORD_ID user, else",
			"                      --user-id). /admin and /tournaments are captured",
			"                      only when that user clears their gates.",
			"  --help              Show this help",
			"",
			"Preconditions:",
			"  - `./per-ankh dev` is running (Worker :8787 + SvelteKit :1420)",
			"  - local D1 has a public game whose blob is in local R2",
			"",
		].join("\n"),
	);
}

export async function main(argv: string[]): Promise<void> {
	const { positional, flags } = parseFlags(argv);
	if (flags.help === true) {
		printHelp();
		return;
	}
	for (const name of Object.keys(flags)) {
		if (!KNOWN_FLAGS.has(name)) throw new Error(`Unknown flag: --${name}`);
	}
	if (positional.length > 0) {
		throw new Error(`Unexpected argument: ${positional[0]}`);
	}

	const baseUrl = flagString(flags, "base-url") ?? DEFAULT_BASE_URL;
	const gameIdArg = flagString(flags, "game-id");
	const userIdArg = flagString(flags, "user-id");
	const authUserIdArg = flagString(flags, "auth-user-id");

	// Everything this command reads lives in the local .wrangler state. The
	// admin wrangler wrapper defaults to prod, so pin the target before the
	// first query.
	setTarget("local");

	let gameId: string;
	let gameOwnerId: string;
	if (gameIdArg) {
		gameId = gameIdArg;
		gameOwnerId = await lookupGameOwner(gameId);
	} else {
		info("Discovering a public game whose blob is present in local R2…");
		const found = await discoverGame();
		gameId = found.game_id;
		gameOwnerId = found.user_id;
	}
	// The publicly-viewed profile is the game's owner unless pinned, so the
	// anonymous pass shows the profile behind the game it just walked.
	const userId = userIdArg ?? gameOwnerId;

	// The signed-in pass runs as the local admin unless pinned. The game is
	// picked at random and most public games are not the admin's, so tying
	// the session to the game's owner instead would drop /admin and the
	// tournament beta gate from nearly every bundle. Falls back to the
	// profile user where the checkout has no local admin.
	const authUserId = authUserIdArg ?? (await lookupAdminUserId()) ?? userId;
	const { discordUsername, isAdmin } = await lookupAuthUser(authUserId);
	const tournamentSlug = await discoverTournamentSlug();
	// A second game, for the screenshots view alone: the walked game is random
	// and almost never has a screenshot, so that view would otherwise be
	// captured empty every run.
	info("Looking for a public game that holds a screenshot…");
	const screenshotGame = await discoverScreenshotGame();
	const ids: ReviewIds = {
		gameId,
		userId,
		authUserId,
		authLabel: discordUsername || null,
		screenshotGameId: screenshotGame?.game_id ?? null,
	};
	const ownsGame = authUserId === gameOwnerId;
	const ownsScreenshotGame = screenshotGame?.user_id === authUserId;
	info(
		`game_id=${gameId}  user_id=${userId}  auth_user_id=${authUserId}` +
			` (${discordUsername}${isAdmin ? ", admin" : ""}` +
			// Whether game detail is captured in owner state or as a signed-in
			// visitor is the one thing the identities decide that isn't visible
			// from the ids themselves.
			`${ownsGame ? ", owns game" : ", not the game's owner"})`,
	);
	info(
		screenshotGame
			? `screenshots view on game_id=${screenshotGame.game_id}` +
					`${ownsScreenshotGame ? " (owned)" : ""}`
			: "No local game holds a visible screenshot — screenshots view skipped.",
	);

	info("Minting local session…");
	const token = await mintLocalSession(authUserId, discordUsername);

	// First writer (desktop pass) sets a screen's metadata; later breakpoints
	// only add their shot or error.
	const screens = new Map<string, Screen>();
	async function mergeRecord(bpId: string, rec: CaptureRecord): Promise<void> {
		let s = screens.get(rec.id);
		if (!s) {
			s = {
				id: rec.id,
				pass: rec.pass,
				page: rec.page,
				tab: rec.tab ?? null,
				title: rec.title,
				route: rec.route,
				state: rec.state,
				shots: {},
				errors: {},
			};
			if (rec.note) s.note = rec.note;
			screens.set(rec.id, s);
		}
		if (rec.buf) {
			const file = `${rec.id}__${bpId}.jpg`;
			await writeFile(path.join(SHOTS_DIR, file), rec.buf);
			s.shots[bpId] = `shots/${file}`;
		} else if (rec.error) {
			s.errors[bpId] = rec.error;
		}
	}

	const browser = await chromium.launch({ headless: true });
	try {
		// Clear only the files this script owns. docs/ux-review also holds
		// hand-authored analysis (review.html) that a regeneration must not
		// destroy, so the output dir itself is never removed.
		await rm(SHOTS_DIR, { recursive: true, force: true });
		for (const f of GENERATED_FILES) {
			await rm(path.join(OUT_DIR, f), { force: true });
		}
		await mkdir(SHOTS_DIR, { recursive: true });

		for (const bp of BREAKPOINTS) {
			const viewport = { width: bp.width, height: bp.height };
			info(`=== ${bp.label} (${bp.width}×${bp.height}) ===`);

			// Anonymous pass.
			const anonCtx = await browser.newContext({
				viewport,
				deviceScaleFactor: 1,
			});
			const anon = await anonCtx.newPage();
			info("[anon] capturing…");
			for (const rec of await captureAnon(anon, baseUrl, ids)) {
				await mergeRecord(bp.id, rec);
			}
			await anonCtx.close();

			// Signed-in pass — same viewport, with the session cookie. localhost
			// :1420 and :8787 are same-site, so one Lax cookie on host `localhost`
			// reaches both SSR loads and client → Worker fetches.
			const authCtx = await browser.newContext({
				viewport,
				deviceScaleFactor: 1,
			});
			await authCtx.addCookies([
				{ name: "session", value: token, domain: "localhost", path: "/" },
			]);
			const auth = await authCtx.newPage();
			info("[auth] capturing…");
			for (const rec of await captureAuth(auth, baseUrl, ids, {
				isAdmin,
				tournamentSlug,
				ownsGame,
				ownsScreenshotGame,
			})) {
				await mergeRecord(bp.id, rec);
			}
			await authCtx.close();
		}
	} finally {
		await browser.close();
		await deleteLocalSession(token);
	}

	const meta = {
		generatedAt: new Date().toISOString(),
		baseUrl,
		ids,
		breakpoints: BREAKPOINTS,
	};
	const screenList = [...screens.values()];

	await writeFile(
		path.join(OUT_DIR, "manifest.json"),
		JSON.stringify({ ...meta, screens: screenList }, null, "\t") + "\n",
	);
	await writeFile(
		path.join(OUT_DIR, "README.md"),
		renderReadme({ meta, screens: screenList }),
	);
	await writeFile(
		path.join(OUT_DIR, "index.html"),
		renderIndexHtml({ meta, screens: screenList }),
	);

	const shotCount = screenList.reduce(
		(n, s) => n + Object.keys(s.shots).length,
		0,
	);
	const errCount = screenList.reduce(
		(n, s) => n + Object.keys(s.errors).length,
		0,
	);
	ok(
		`Wrote ${path.relative(process.cwd(), OUT_DIR)}/ — ` +
			`${screenList.length} screens, ${shotCount} shots` +
			`${errCount ? `, ${errCount} capture errors` : ""}.`,
	);
}
