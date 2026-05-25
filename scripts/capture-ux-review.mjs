// Capture a UX-review walkthrough of the app against the running dev server
// and emit a reviewable bundle at docs/ux-review/ — separate per-shot JPGs,
// an interactive HTML viewer, a machine-readable manifest, and a README.
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
//   Anonymous  — the signed-out surface. Only three routes render real
//                content without a session: / , /games/[id] (10 tabs),
//                /users/[user_id] (3 tabs). Everything else redirects to
//                /?next=… .
//
//   Signed in  — the same browser with a real session cookie minted for a
//                local user (yours by default). Unlocks the owner /
//                authenticated surface: / , /users/[user_id] (owner),
//                /account, /games/[id] (owner), /tournaments,
//                /tournaments/[slug], /admin/reparse (when the auth user is
//                the local ADMIN_DISCORD_ID), plus a redirect-verification
//                note for /dashboard, /games, /auth/callback.
//
// Each (state × page × tab) is one "screen"; each screen is captured at every
// breakpoint via a *fresh navigation* at that viewport — components that pick
// a layout at mount (responsive nav, ECharts/deck.gl sizing) won't re-derive
// it on a resize, so we re-navigate rather than resize a live page.
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
//   1. The local dev server is up (`./per-ankh` — http://localhost:1420).
//   2. A public game + a user with public games exist locally. By default the
//      script auto-discovers them from local D1 (wrangler --local, no prod
//      access); override with --game-id / --user-id / --auth-user-id.
//
// Run with: npm run ux:review

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import sharp from "sharp";

const DEFAULT_BASE_URL = "http://localhost:1420";
const OUT_DIR = path.resolve("docs", "ux-review");
const SHOTS_DIR = path.join(OUT_DIR, "shots");
const CLOUD_DIR = path.resolve("cloud");

const JPEG_QUALITY = 72;

// Captured at deviceScaleFactor 1, so the JPEG is the screen's CSS-pixel
// width — small enough to commit, sharp enough for the lightbox to read type.
const BREAKPOINTS = [
	{ id: "desktop", label: "Desktop", width: 1440, height: 900 },
	{ id: "tablet", label: "Tablet", width: 768, height: 1024 },
	{ id: "mobile", label: "Mobile", width: 390, height: 844 },
];

// Game-detail tabs in nav order. `label` is the trigger's accessible name
// (bits-ui Tabs.Trigger emits role="tab"); getByRole matches by accessible
// name and survives Tailwind churn. The Tabs.List uses flex-wrap, so every
// trigger stays a clickable role="tab" even at mobile width (no dropdown
// collapse). The "Timeline" tab is commented out in GameDetailView so it's
// omitted here.
const GAME_TABS = [
	"Overview",
	"Events",
	"Laws",
	"Techs",
	"Yields",
	"Military",
	"Cities",
	"Improvements",
	"Map",
	"Settings",
];

// User-profile tabs are URL-driven (?tab=…) and the load() refetches per tab,
// so we navigate by URL rather than clicking.
const USER_TABS = [
	{ label: "Overview", param: "overview" },
	{ label: "Games", param: "games" },
	{ label: "Stats", param: "stats" },
];

// Redirect-only routes — verified (not screenshotted). `note` documents the
// intended destination.
const REDIRECT_ROUTES = [
	{ route: "/dashboard", note: "→ /users/[id] (signed in) · /?next= (anon)" },
	{ route: "/games", note: "→ /dashboard → profile" },
	{ route: "/auth/callback", note: "OAuth landing (not renderable)" },
];

function slug(s) {
	return String(s)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function parseArgs(argv) {
	const out = {
		baseUrl: DEFAULT_BASE_URL,
		gameId: null,
		userId: null,
		authUserId: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--base-url") out.baseUrl = argv[++i];
		else if (a === "--game-id") out.gameId = argv[++i];
		else if (a === "--user-id") out.userId = argv[++i];
		else if (a === "--auth-user-id") out.authUserId = argv[++i];
		else if (a === "--help" || a === "-h") {
			console.log(
				"usage: node scripts/capture-ux-review.mjs " +
					"[--base-url <url>] [--game-id <id>] [--user-id <id>] " +
					"[--auth-user-id <id>]",
			);
			process.exit(0);
		} else {
			console.error(`unknown arg: ${a}`);
			process.exit(1);
		}
	}
	return out;
}

// --- Local D1 / KV helpers (wrangler --local, never touches prod) --------

function d1Query(sql) {
	const stdout = execFileSync(
		"npx",
		[
			"wrangler",
			"d1",
			"execute",
			"per-ankh-share-index",
			"--local",
			"--json",
			"--command",
			sql,
		],
		{ cwd: CLOUD_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
	);
	return JSON.parse(stdout)?.[0]?.results ?? [];
}

function discoverIds() {
	let rows;
	try {
		rows = d1Query(
			"SELECT game_id, user_id FROM games WHERE is_public = 1 " +
				"ORDER BY total_turns DESC LIMIT 1;",
		);
	} catch (err) {
		throw new Error(
			`Auto-discovery via wrangler failed (${err.message}). ` +
				`Pass --game-id and --user-id explicitly.`,
		);
	}
	const row = rows[0];
	if (!row?.game_id || !row?.user_id) {
		throw new Error(
			"No public game found in local D1. Mark a game public or pass " +
				"--game-id / --user-id.",
		);
	}
	return { gameId: row.game_id, userId: row.user_id };
}

// Resolve the sign-in user: discord_username for the session payload, plus
// whether they're the local site admin (gates the /admin/reparse capture).
function lookupAuthUser(userId) {
	const row = d1Query(
		`SELECT discord_username, discord_id FROM users WHERE user_id = '${userId}';`,
	)[0];
	if (!row) {
		throw new Error(`No local user ${userId} (for --auth-user-id).`);
	}
	let adminDiscordId = null;
	try {
		const env = execFileSync("cat", [path.join(CLOUD_DIR, ".dev.vars")], {
			encoding: "utf8",
		});
		adminDiscordId = env.match(/^ADMIN_DISCORD_ID=(.+)$/m)?.[1]?.trim() ?? null;
	} catch {
		/* no .dev.vars — treat as no admin */
	}
	return {
		discordUsername: row.discord_username ?? "",
		isAdmin: adminDiscordId != null && row.discord_id === adminDiscordId,
	};
}

function discoverTournamentSlug() {
	try {
		return d1Query("SELECT slug FROM tournaments LIMIT 1;")[0]?.slug ?? null;
	} catch {
		return null;
	}
}

// Mint a session in local KV (the *preview* namespace `wrangler dev --local`
// binds KV to) and return the opaque token. The token value is arbitrary —
// readSession looks it up by exact key — so a URL-safe random string is fine.
function mintLocalSession(userId, discordUsername) {
	const token = randomBytes(24).toString("base64url");
	execFileSync(
		"npx",
		[
			"wrangler",
			"kv",
			"key",
			"put",
			"--binding",
			"SESSIONS_KV",
			"--local",
			// SESSIONS_KV declares a preview_id, and `wrangler dev --local`
			// binds KV to the *preview* namespace — the session must live there
			// (--preview true) for the dev worker to read it.
			"--preview",
			"true",
			`session:${token}`,
			JSON.stringify({ user_id: userId, discord_username: discordUsername }),
		],
		{ cwd: CLOUD_DIR, stdio: ["ignore", "ignore", "inherit"] },
	);
	return token;
}

function deleteLocalSession(token) {
	try {
		execFileSync(
			"npx",
			[
				"wrangler",
				"kv",
				"key",
				"delete",
				"--binding",
				"SESSIONS_KV",
				"--local",
				"--preview",
				"true",
				`session:${token}`,
			],
			{ cwd: CLOUD_DIR, stdio: ["ignore", "ignore", "ignore"] },
		);
	} catch {
		// Best-effort; the key carries a 30-day TTL and is local-only.
	}
}

// --- Page rendering ------------------------------------------------------

// Settle async client rendering (ECharts, deck.gl map) after a navigation or
// tab switch. We can't wait on full "networkidle" — external avatar images
// (Discord CDN) keep the connection pool busy indefinitely — so cap the idle
// wait and add a fixed render settle.
async function settle(page) {
	await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
	await page.waitForTimeout(900);
	await page.evaluate(() => window.scrollTo(0, 0));
}

// Capture the current page full-height and return a JPEG buffer.
async function shoot(page) {
	const png = await page.screenshot({ type: "png", fullPage: true });
	return sharp(png).jpeg({ quality: JPEG_QUALITY }).toBuffer();
}

// --- Per-screen capture (returns records; orchestrator writes files) -----
//
// A record is { id, pass, page, tab?, title, route, state, buf? | error? |
// note? }. `id` doubles as the file-stem and the manifest key:
//   {pass}__{page}            single-shot pages
//   {pass}__{page}__{tab}     tabbed pages

// Single full-page shot. A non-OK status OR a silent redirect away from the
// requested path becomes an error — a gated page that 30x's to / still
// returns 200 on the landing page, so status alone isn't enough.
async function captureSingle(page, baseUrl, spec) {
	const expectedPath = spec.route.split("?")[0];
	const resp = await page.goto(`${baseUrl}${spec.route}`, {
		waitUntil: "load",
	});
	const landedPath = new URL(page.url()).pathname;
	if (!resp || !resp.ok() || landedPath !== expectedPath) {
		return {
			...spec,
			error: `${spec.errorHint} (status ${
				resp ? resp.status() : "none"
			}, landed ${landedPath})`,
		};
	}
	await settle(page);
	return { ...spec, buf: await shoot(page) };
}

// Game detail — click through all 10 tabs. Yields one record per tab.
async function captureGameDetail(page, baseUrl, pass, gameId, state) {
	const route = `/games/${gameId}`;
	const base = { pass, page: "game-detail", route, state };
	const resp = await page.goto(`${baseUrl}${route}`, { waitUntil: "load" });
	const tabsAppeared = await page
		.getByRole("tab", { name: "Overview" })
		.waitFor({ state: "visible", timeout: 10_000 })
		.then(() => true)
		.catch(() => false);

	if (!resp || !resp.ok() || !tabsAppeared) {
		return [
			{
				...base,
				id: `${pass}__game-detail`,
				tab: null,
				title: "Game detail",
				error:
					"Tabs never appeared — game may be private, missing, or redirected.",
			},
		];
	}

	const recs = [];
	for (const label of GAME_TABS) {
		const id = `${pass}__game-detail__${slug(label)}`;
		const tab = page.getByRole("tab", { name: label, exact: true });
		if ((await tab.count()) === 0) {
			recs.push({
				...base,
				id,
				tab: label,
				title: label,
				error: "Tab not found",
			});
			continue;
		}
		await tab.click();
		await settle(page);
		recs.push({
			...base,
			id,
			tab: label,
			title: label,
			buf: await shoot(page),
		});
	}
	return recs;
}

// User profile — URL-driven tabs (?tab=…). Yields one record per tab.
async function captureUserProfile(page, baseUrl, pass, userId, state) {
	const route = `/users/${userId}`;
	const base = { pass, page: "user-profile", state };
	const recs = [];
	for (const { label, param } of USER_TABS) {
		const id = `${pass}__user-profile__${param}`;
		const url = `${route}?tab=${param}`;
		const resp = await page.goto(`${baseUrl}${url}`, { waitUntil: "load" });
		const ready = await page
			.getByRole("tab", { name: "Overview" })
			.waitFor({ state: "visible", timeout: 10_000 })
			.then(() => true)
			.catch(() => false);
		if (!resp || !resp.ok() || !ready) {
			recs.push({
				...base,
				id,
				tab: label,
				route: url,
				title: label,
				error: "Profile tabs never appeared — page may have redirected home.",
			});
			continue;
		}
		await settle(page);
		recs.push({
			...base,
			id,
			tab: label,
			route: url,
			title: label,
			buf: await shoot(page),
		});
	}
	return recs;
}

// Verify the redirect-only routes 30x rather than render. One text record.
async function captureRedirects(page, baseUrl, pass) {
	const lines = [];
	for (const { route, note } of REDIRECT_ROUTES) {
		try {
			await page.goto(`${baseUrl}${route}`, { waitUntil: "load" });
			lines.push(`${route} → ${new URL(page.url()).pathname}  (${note})`);
		} catch (err) {
			lines.push(`${route} → error: ${err.message}`);
		}
	}
	return {
		pass,
		page: "redirects",
		id: `${pass}__redirects`,
		tab: null,
		title: "Redirect routes",
		route: "(verification)",
		state: "—",
		note: lines.join("\n"),
	};
}

// Run the anonymous pass at the current viewport. Returns records.
async function captureAnon(page, baseUrl, ids) {
	const recs = [];
	recs.push(
		await captureSingle(page, baseUrl, {
			id: "anon__home",
			pass: "anon",
			page: "home",
			tab: null,
			title: "Home",
			route: "/",
			state: "visitor",
			errorHint: "Home failed",
		}),
	);
	recs.push(
		...(await captureGameDetail(page, baseUrl, "anon", ids.gameId, "visitor")),
	);
	recs.push(
		...(await captureUserProfile(page, baseUrl, "anon", ids.userId, "visitor")),
	);
	return recs;
}

// Run the signed-in pass at the current viewport. Returns records.
async function captureAuth(page, baseUrl, ids, opts) {
	const recs = [];
	recs.push(
		await captureSingle(page, baseUrl, {
			id: "auth__home",
			pass: "auth",
			page: "home",
			tab: null,
			title: "Home",
			route: "/",
			state: "signed in",
			errorHint: "Home failed",
		}),
	);
	recs.push(
		...(await captureUserProfile(
			page,
			baseUrl,
			"auth",
			ids.authUserId,
			"owner",
		)),
	);
	recs.push(
		await captureSingle(page, baseUrl, {
			id: "auth__account",
			pass: "auth",
			page: "account",
			tab: null,
			title: "Account",
			route: "/account",
			state: "owner",
			errorHint: "Account redirected — session may not have been picked up",
		}),
	);
	recs.push(
		...(await captureGameDetail(page, baseUrl, "auth", ids.gameId, "owner")),
	);
	recs.push(
		await captureSingle(page, baseUrl, {
			id: "auth__tournaments",
			pass: "auth",
			page: "tournaments",
			tab: null,
			title: "Tournaments",
			route: "/tournaments",
			state: "signed in",
			errorHint: "Tournaments unavailable — likely the beta gate (404)",
		}),
	);
	if (opts.tournamentSlug) {
		recs.push(
			await captureSingle(page, baseUrl, {
				id: "auth__tournament-detail",
				pass: "auth",
				page: "tournament-detail",
				tab: null,
				title: `Tournament: ${opts.tournamentSlug}`,
				route: `/tournaments/${opts.tournamentSlug}`,
				state: "signed in",
				errorHint: "Tournament detail unavailable (beta gate or missing)",
			}),
		);
	}
	if (opts.isAdmin) {
		recs.push(
			await captureSingle(page, baseUrl, {
				id: "auth__admin-reparse",
				pass: "auth",
				page: "admin-reparse",
				tab: null,
				title: "Admin · reparse",
				route: "/admin/reparse",
				state: "admin",
				errorHint:
					"Admin reparse unavailable — auth user is not the local admin",
			}),
		);
	}
	recs.push(await captureRedirects(page, baseUrl, "auth"));
	return recs;
}

// --- Artifact emission ---------------------------------------------------

function escapeHtml(s) {
	return String(s).replace(
		/[&<>"]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
	);
}

const PASS_LABELS = {
	anon: "Anonymous (signed out)",
	auth: (label) => `Signed in (${label})`,
};

const PAGE_LABELS = {
	home: "Home",
	"game-detail": "Game detail",
	"user-profile": "User profile",
	account: "Account",
	tournaments: "Tournaments",
	"tournament-detail": "Tournament detail",
	"admin-reparse": "Admin · reparse",
	redirects: "Redirect routes",
};

// README.md — human index + Claude-reviewer brief.
function renderReadme({ meta, screens }) {
	const lines = [];
	lines.push("# Per-Ankh — UX Review Bundle\n");
	lines.push(
		`Generated **${meta.generatedAt}** against \`${meta.baseUrl}\` · ` +
			`game \`${meta.ids.gameId}\` · public user \`${meta.ids.userId}\` · ` +
			`signed in as \`${meta.ids.authUserId}\`` +
			(meta.ids.authLabel ? ` (${meta.ids.authLabel})` : "") +
			".\n",
	);
	lines.push("## How to review\n");
	lines.push(
		"- **Humans:** open `index.html` — sidebar nav tree, breakpoint " +
			"switcher, click any shot to zoom.\n" +
			"- **Claude Code:** start from `manifest.json` for the full inventory " +
			"(route + state + breakpoint paths per screen), then Read only the " +
			"`shots/*.jpg` you need. Filenames are " +
			"`{pass}__{page}[__{tab}]__{breakpoint}.jpg`, so you can glob — e.g. " +
			"`shots/auth__*__mobile.jpg` for every signed-in screen on mobile.\n",
	);
	lines.push("## What to look for\n");
	lines.push(
		"- Layout integrity at each breakpoint (overflow, clipping, tap-target " +
			"size on mobile).\n" +
			"- State differences: anonymous vs. owner views of the same page " +
			"(controls that should/shouldn't appear).\n" +
			"- Consistency of headers, tables, and charts against the games-table " +
			"theme.\n" +
			"- Empty/edge states and any visibly broken renders.\n",
	);
	lines.push(
		`## Inventory\n\nBreakpoints: ${meta.breakpoints
			.map((b) => `${b.label} (${b.width}×${b.height})`)
			.join(", ")}.\n`,
	);

	let lastPass = null;
	let lastPage = null;
	for (const s of screens) {
		if (s.pass !== lastPass) {
			const label =
				s.pass === "auth"
					? PASS_LABELS.auth(meta.ids.authLabel || meta.ids.authUserId)
					: PASS_LABELS.anon;
			lines.push(`\n### ${label}\n`);
			lastPass = s.pass;
			lastPage = null;
		}
		if (s.page !== lastPage) {
			lines.push(`\n**${PAGE_LABELS[s.page] ?? s.page}** — \`${s.route}\`\n`);
			lastPage = s.page;
		}
		const name = s.tab ? `${s.title}` : s.title;
		if (s.note) {
			lines.push(`- ${name} — verification only:`);
			for (const ln of s.note.split("\n")) lines.push(`  - \`${ln}\``);
		} else {
			const shotLinks = meta.breakpoints
				.map((b) =>
					s.shots[b.id]
						? `[${b.label}](${s.shots[b.id]})`
						: `~~${b.label}~~ (${s.errors[b.id] ? "error" : "missing"})`,
				)
				.join(" · ");
			lines.push(`- ${name}: ${shotLinks}`);
		}
	}
	return lines.join("\n") + "\n";
}

// index.html — single-pane viewer. Tree + breakpoint sub-tabs + lightbox.
// References ./shots/ rather than inlining. Inline JS/CSS is fine — a static
// file opened from disk, not served under the app's CSP.
function renderIndexHtml({ meta, screens }) {
	const data = JSON.stringify({ breakpoints: meta.breakpoints, screens });
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Per-Ankh — UX Review</title>
<style>
	:root { color-scheme: dark; }
	* { box-sizing: border-box; }
	body { margin: 0; font: 14px/1.5 system-ui, -apple-system, sans-serif;
		background: #1c1916; color: #e7ddcf; display: flex; height: 100vh; overflow: hidden; }
	#sidebar { width: 280px; flex: none; overflow-y: auto; background: #15120f;
		border-right: 1px solid #000; padding: .75rem; }
	#sidebar h1 { font-size: 1rem; margin: 0 0 .25rem; }
	#sidebar .meta { font-size: .72rem; color: #a99c87; margin-bottom: .75rem; line-height: 1.4; }
	.group { font-size: .8rem; font-weight: 700; color: #f0e7d8; text-transform: uppercase;
		letter-spacing: .04em; margin: 1rem 0 .35rem; border-bottom: 1px solid #4a423a; padding-bottom: .2rem; }
	.page-grp { margin: .25rem 0; }
	.page-grp > summary { cursor: pointer; font-weight: 600; color: #cdbfa8; padding: .2rem .25rem;
		list-style: none; font-size: .82rem; }
	.page-grp > summary::-webkit-details-marker { display: none; }
	.page-grp > summary:hover { color: #fff; }
	.leaf { display: block; width: 100%; text-align: left; background: none; border: none;
		color: #cdbfa8; padding: .2rem .25rem .2rem 1.1rem; font-size: .8rem; cursor: pointer;
		border-radius: 4px; }
	.leaf:hover { background: #2a2622; color: #fff; }
	.leaf.active { background: #3a322a; color: #fff; }
	.leaf.err { color: #ffb4a8; }
	#main { flex: 1; overflow-y: auto; padding: 1.25rem 1.5rem; }
	#hdr h2 { margin: 0 0 .15rem; font-size: 1.1rem; }
	#hdr .route { color: #a99c87; font-size: .82rem; }
	#hdr .state { display: inline-block; margin-left: .5rem; font-size: .7rem; padding: .05rem .4rem;
		border: 1px solid #4a423a; border-radius: 3px; color: #b9ad97; }
	#bps { margin: .75rem 0; display: flex; gap: .4rem; }
	#bps button { font-size: .78rem; color: #e7ddcf; background: #241f1b; border: 1px solid #4a423a;
		border-radius: 4px; padding: .2rem .6rem; cursor: pointer; }
	#bps button.active { background: #6b5d4a; border-color: #6b5d4a; color: #fff; }
	#bps button:disabled { opacity: .35; cursor: default; }
	#stage img { max-width: 100%; height: auto; display: block; border: 1px solid #000;
		border-radius: 6px; background: #000; cursor: zoom-in; }
	#stage .err { color: #ffb4a8; padding: .75rem; border: 1px solid #5a2b25; border-radius: 6px;
		background: #2a1714; }
	#stage pre.redir { font-size: .82rem; color: #b9ad97; padding: .75rem; margin: 0;
		border: 1px solid #4a423a; border-radius: 6px; background: #221e1a; white-space: pre-wrap; }
	#lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.92); display: none;
		overflow: auto; cursor: zoom-out; z-index: 10; }
	#lightbox.open { display: block; }
	#lightbox img { display: block; margin: 0 auto; }
	#lightbox img.fit { max-width: 100%; max-height: 100vh; cursor: zoom-in; }
	#lightbox img.full { max-width: none; cursor: zoom-out; }
</style>
</head>
<body>
<aside id="sidebar">
	<h1>UX Review</h1>
	<div class="meta">
		${escapeHtml(meta.generatedAt)}<br />
		base ${escapeHtml(meta.baseUrl)}<br />
		signed in as <code>${escapeHtml(meta.ids.authLabel || meta.ids.authUserId)}</code>
	</div>
	<nav id="tree"></nav>
</aside>
<main id="main">
	<div id="hdr"></div>
	<div id="bps"></div>
	<div id="stage"></div>
</main>
<div id="lightbox"><img alt="" /></div>
<script>
const DATA = ${data};
const PASS_LABEL = {
	anon: "Anonymous (signed out)",
	auth: ${JSON.stringify(
		PASS_LABELS.auth(meta.ids.authLabel || meta.ids.authUserId),
	)},
};
const PAGE_LABEL = ${JSON.stringify(PAGE_LABELS)};
const order = DATA.screens.map((s) => s.id);
let curId = order[0];
let curBp = DATA.breakpoints[0].id;

function byId(id) { return DATA.screens.find((s) => s.id === id); }

function buildTree() {
	const tree = document.getElementById("tree");
	let passEl = null, pageEl = null, lastPass = null, lastPage = null;
	for (const s of DATA.screens) {
		if (s.pass !== lastPass) {
			const h = document.createElement("div");
			h.className = "group"; h.textContent = PASS_LABEL[s.pass] || s.pass;
			tree.appendChild(h); lastPass = s.pass; lastPage = null;
		}
		if (s.page !== lastPage) {
			pageEl = document.createElement("details");
			pageEl.className = "page-grp"; pageEl.open = true;
			const sum = document.createElement("summary");
			sum.textContent = PAGE_LABEL[s.page] || s.page;
			pageEl.appendChild(sum); tree.appendChild(pageEl); lastPage = s.page;
		}
		const btn = document.createElement("button");
		btn.className = "leaf"; btn.dataset.id = s.id;
		btn.textContent = s.tab || (PAGE_LABEL[s.page] || s.page);
		const hasShot = s.shots && Object.keys(s.shots).length > 0;
		if (!hasShot && !s.note) btn.classList.add("err");
		btn.onclick = () => select(s.id);
		pageEl.appendChild(btn);
	}
}

function render() {
	const s = byId(curId);
	document.querySelectorAll(".leaf").forEach((b) =>
		b.classList.toggle("active", b.dataset.id === curId));
	const hdr = document.getElementById("hdr");
	hdr.innerHTML = '<h2>' + esc(PAGE_LABEL[s.page] || s.page) +
		(s.tab ? ' · ' + esc(s.tab) : '') + '</h2>' +
		'<span class="route">' + esc(s.route) + '</span>' +
		'<span class="state">' + esc(s.state) + '</span>';

	const bps = document.getElementById("bps");
	bps.innerHTML = "";
	if (s.note) { bps.style.display = "none"; } else {
		bps.style.display = "flex";
		for (const b of DATA.breakpoints) {
			const has = s.shots && s.shots[b.id];
			const btn = document.createElement("button");
			btn.textContent = b.label + " · " + b.width;
			btn.disabled = !has;
			btn.classList.toggle("active", b.id === curBp);
			btn.onclick = () => { curBp = b.id; render(); };
			bps.appendChild(btn);
		}
	}

	const stage = document.getElementById("stage");
	if (s.note) {
		stage.innerHTML = '<pre class="redir">' + esc(s.note) + '</pre>';
	} else if (s.shots && s.shots[curBp]) {
		const img = document.createElement("img");
		img.src = s.shots[curBp]; img.alt = s.id + " " + curBp;
		img.onclick = () => openLightbox(s.shots[curBp]);
		stage.innerHTML = ""; stage.appendChild(img);
	} else {
		const msg = (s.errors && s.errors[curBp]) || "No capture at this breakpoint.";
		stage.innerHTML = '<div class="err">⚠ ' + esc(msg) + '</div>';
	}
}

function select(id) {
	curId = id;
	const s = byId(id);
	if (!(s.shots && s.shots[curBp])) {
		const first = s.shots && Object.keys(s.shots)[0];
		if (first) curBp = first;
	}
	render();
}

function openLightbox(src) {
	const lb = document.getElementById("lightbox");
	const img = lb.querySelector("img");
	img.src = src; img.className = "fit";
	lb.classList.add("open");
}
document.getElementById("lightbox").onclick = (e) => {
	if (e.target.tagName === "IMG") { e.target.classList.toggle("fit"); e.target.classList.toggle("full"); }
	else document.getElementById("lightbox").classList.remove("open");
};
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") document.getElementById("lightbox").classList.remove("open");
	if (e.key === "ArrowDown" || e.key === "ArrowUp") {
		const i = order.indexOf(curId);
		const ni = e.key === "ArrowDown" ? Math.min(order.length - 1, i + 1) : Math.max(0, i - 1);
		select(order[ni]); e.preventDefault();
	}
});
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
buildTree(); render();
</script>
</body>
</html>
`;
}

// ------------------------------------------------------------------------

const {
	baseUrl,
	gameId: gameIdArg,
	userId: userIdArg,
	authUserId: authUserIdArg,
} = parseArgs(process.argv.slice(2));

let gameId = gameIdArg;
let userId = userIdArg;
if (!gameId || !userId) {
	console.log("Auto-discovering public game + user from local D1…");
	const found = discoverIds();
	gameId = gameId ?? found.gameId;
	userId = userId ?? found.userId;
}
const authUserId = authUserIdArg ?? userId;
const { discordUsername, isAdmin } = lookupAuthUser(authUserId);
const tournamentSlug = discoverTournamentSlug();
const ids = { gameId, userId, authUserId, authLabel: discordUsername || null };
console.log(
	`game_id=${gameId}  user_id=${userId}  auth_user_id=${authUserId}` +
		` (${discordUsername}${isAdmin ? ", admin" : ""})`,
);

console.log("Minting local session…");
const token = mintLocalSession(authUserId, discordUsername);

// screens: Map<id, {id, pass, page, tab, title, route, state, shots:{}, errors:{}, note?}>
// First writer (desktop pass) sets the metadata; later breakpoints add shots.
const screens = new Map();
async function mergeRecord(bpId, rec) {
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
	await rm(OUT_DIR, { recursive: true, force: true });
	await mkdir(SHOTS_DIR, { recursive: true });

	for (const bp of BREAKPOINTS) {
		const viewport = { width: bp.width, height: bp.height };
		console.log(`\n=== ${bp.label} (${bp.width}×${bp.height}) ===`);

		// Anonymous pass.
		const anonCtx = await browser.newContext({
			viewport,
			deviceScaleFactor: 1,
		});
		const anon = await anonCtx.newPage();
		console.log("[anon] capturing…");
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
		console.log("[auth] capturing…");
		for (const rec of await captureAuth(auth, baseUrl, ids, {
			isAdmin,
			tournamentSlug,
			discordUsername,
		})) {
			await mergeRecord(bp.id, rec);
		}
		await authCtx.close();
	}
} finally {
	await browser.close();
	deleteLocalSession(token);
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
console.log(
	`\nWrote ${path.relative(process.cwd(), OUT_DIR)}/ — ` +
		`${screenList.length} screens, ${shotCount} shots` +
		`${errCount ? `, ${errCount} capture errors` : ""}.`,
);
