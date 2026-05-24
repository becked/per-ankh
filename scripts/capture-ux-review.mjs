// Capture a UX-review walkthrough of every anonymous-accessible page against
// the running dev server and emit a single self-contained HTML file at
// docs/ux-review.html (images base64-inlined, so the file is portable and
// checked into git).
//
// Scope is deliberately the *anonymous* (signed-out) surface. As the routes
// are coded today, only three render real content without a session:
//
//   /                — marketing landing (the tournaments list lives here)
//   /games/[id]      — public games only; 10 tabs
//   /users/[user_id] — anon sees the target's public games only; 3 tabs
//
// Everything else (/dashboard, /account, /upload, /tournaments,
// /tournaments/[slug]) redirects a signed-out visitor to /?next=…, so it's
// out of scope for this anonymous review.
//
// Requirements:
//   1. The local dev server is up (`./per-ankh` — http://localhost:1420).
//   2. A public game + a user with public games exist locally. By default
//      the script auto-discovers them from the local D1 (wrangler --local,
//      no prod access); override with --game-id / --user-id.
//
// Run with: npm run ux:review

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import sharp from "sharp";

const DEFAULT_BASE_URL = "http://localhost:1420";
const OUT_FILE = path.resolve("docs", "ux-review.html");
const CLOUD_DIR = path.resolve("cloud");

// 1440×900 mirrors a typical laptop viewport. deviceScaleFactor 1 keeps the
// inlined JPEGs small — this is a review artifact, not a shipped asset.
const VIEWPORT = { width: 1440, height: 900 };

// Inlined images: downscale to this width and JPEG-encode. A whole-scroll
// fullPage capture at 1440 wide is more detail than a review needs, and JPEG
// at this quality keeps the committed HTML in the low single-digit MB.
const INLINE_WIDTH = 1280;
const JPEG_QUALITY = 72;

// Game-detail tabs, in nav order. `label` is the trigger's accessible name
// (bits-ui Tabs.Trigger emits a <button>); getByRole matches by accessible
// name and survives Tailwind class churn. The "Timeline" tab is commented
// out in GameDetailView.svelte (pending redesign) so it's omitted here.
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

// User-profile tabs are URL-driven (?tab=…) and the load() refetches per
// tab, so we navigate by URL rather than clicking — guarantees the right
// load runs. `param` is the ?tab= value; `label` is for the caption.
const USER_TABS = [
	{ label: "Overview", param: "overview" },
	{ label: "Games", param: "games" },
	{ label: "Stats", param: "stats" },
];

function parseArgs(argv) {
	const out = { baseUrl: DEFAULT_BASE_URL, gameId: null, userId: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--base-url") out.baseUrl = argv[++i];
		else if (a === "--game-id") out.gameId = argv[++i];
		else if (a === "--user-id") out.userId = argv[++i];
		else if (a === "--help" || a === "-h") {
			console.log(
				"usage: node scripts/capture-ux-review.mjs " +
					"[--base-url <url>] [--game-id <id>] [--user-id <id>]",
			);
			process.exit(0);
		} else {
			console.error(`unknown arg: ${a}`);
			process.exit(1);
		}
	}
	return out;
}

// Auto-discover a public game and a user with public games from the local
// D1. Runs `wrangler d1 execute --local` (local SQLite state — never touches
// the production database).
function discoverIds() {
	const sql =
		"SELECT game_id, user_id FROM games WHERE is_public = 1 " +
		"ORDER BY total_turns DESC LIMIT 1;";
	let stdout;
	try {
		stdout = execFileSync(
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
	} catch (err) {
		throw new Error(
			`Auto-discovery via wrangler failed (${err.message}). ` +
				`Pass --game-id and --user-id explicitly.`,
		);
	}
	// wrangler --json prints a JSON array of result sets.
	const parsed = JSON.parse(stdout);
	const row = parsed?.[0]?.results?.[0];
	if (!row?.game_id || !row?.user_id) {
		throw new Error(
			"No public game found in local D1. Mark a game public or pass " +
				"--game-id / --user-id.",
		);
	}
	return { gameId: row.game_id, userId: row.user_id };
}

// Settle async client rendering (ECharts, deck.gl map) after a navigation or
// tab switch. We can't wait on full "networkidle" — external avatar images
// (Discord CDN) on the recent-game cards keep the connection pool busy
// indefinitely — so cap the idle wait and add a fixed render settle. The
// timeout is empirical for this app's client-side chart/map rendering.
async function settle(page) {
	await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
	await page.waitForTimeout(900);
	await page.evaluate(() => window.scrollTo(0, 0));
}

// Capture the current page full-height and return a base64 data URI.
async function shoot(page) {
	const png = await page.screenshot({ type: "png", fullPage: true });
	const jpeg = await sharp(png)
		.resize({ width: INLINE_WIDTH, withoutEnlargement: true })
		.jpeg({ quality: JPEG_QUALITY })
		.toBuffer();
	return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

function escapeHtml(s) {
	return String(s).replace(
		/[&<>"]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
	);
}

// Build the self-contained review document from the collected sections.
function renderHtml({ baseUrl, gameId, userId, generatedAt, sections }) {
	const nav = sections
		.map((s) => `<a href="#${s.id}">${escapeHtml(s.title)}</a>`)
		.join("");

	const body = sections
		.map((s) => {
			const shots = s.shots
				.map((shot) => {
					if (shot.error) {
						return `<figure class="shot error">
	<figcaption>${escapeHtml(shot.caption)}</figcaption>
	<div class="err">⚠ ${escapeHtml(shot.error)}</div>
</figure>`;
					}
					return `<figure class="shot">
	<figcaption>${escapeHtml(shot.caption)}</figcaption>
	<img loading="lazy" alt="${escapeHtml(shot.caption)}" src="${shot.img}" />
</figure>`;
				})
				.join("\n");
			return `<section id="${s.id}">
	<h2>${escapeHtml(s.title)} <span class="route">${escapeHtml(s.route)}</span></h2>
${shots}
</section>`;
		})
		.join("\n");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Per-Ankh — Anonymous UX Review</title>
<style>
	:root { color-scheme: dark; }
	* { box-sizing: border-box; }
	body {
		margin: 0; font: 15px/1.5 system-ui, -apple-system, sans-serif;
		background: #1c1916; color: #e7ddcf;
	}
	header {
		position: sticky; top: 0; z-index: 2; padding: 1rem 1.5rem;
		background: #15120f; border-bottom: 1px solid #000;
	}
	header h1 { margin: 0 0 .25rem; font-size: 1.15rem; }
	header .meta { font-size: .8rem; color: #a99c87; }
	nav { margin-top: .6rem; display: flex; flex-wrap: wrap; gap: .4rem; }
	nav a {
		font-size: .8rem; color: #e7ddcf; text-decoration: none;
		padding: .15rem .5rem; border: 1px solid #4a423a; border-radius: 4px;
	}
	nav a:hover { background: #2a2622; }
	main { max-width: 1320px; margin: 0 auto; padding: 1.5rem; }
	section { margin-bottom: 2.5rem; }
	h2 { font-size: 1rem; border-bottom: 1px solid #4a423a; padding-bottom: .3rem; }
	h2 .route { font-weight: 400; color: #a99c87; font-size: .85rem; }
	.shot { margin: 0 0 1.75rem; }
	.shot figcaption {
		font-size: .82rem; color: #cdbfa8; margin-bottom: .4rem; font-weight: 600;
	}
	.shot img {
		max-width: 100%; height: auto; display: block;
		border: 1px solid #000; border-radius: 6px; background: #000;
	}
	.shot.error .err {
		color: #ffb4a8; font-size: .85rem; padding: .75rem;
		border: 1px solid #5a2b25; border-radius: 6px; background: #2a1714;
	}
</style>
</head>
<body>
<header>
	<h1>Per-Ankh — Anonymous UX Review</h1>
	<div class="meta">
		Generated ${escapeHtml(generatedAt)} ·
		base ${escapeHtml(baseUrl)} ·
		game <code>${escapeHtml(gameId)}</code> ·
		user <code>${escapeHtml(userId)}</code>
	</div>
	<nav>${nav}</nav>
</header>
<main>
${body}
</main>
</body>
</html>
`;
}

const { baseUrl, gameId: gameIdArg, userId: userIdArg } = parseArgs(
	process.argv.slice(2),
);

let gameId = gameIdArg;
let userId = userIdArg;
if (!gameId || !userId) {
	console.log("Auto-discovering public game + user from local D1…");
	const found = discoverIds();
	gameId = gameId ?? found.gameId;
	userId = userId ?? found.userId;
}
console.log(`game_id=${gameId}  user_id=${userId}`);

const browser = await chromium.launch({ headless: true });
const sections = [];
try {
	const ctx = await browser.newContext({ viewport: VIEWPORT });
	const page = await ctx.newPage();

	// --- Home ---
	{
		console.log("Capturing / (Home)…");
		const shots = [];
		const resp = await page.goto(`${baseUrl}/`, { waitUntil: "load" });
		if (!resp || !resp.ok()) {
			shots.push({
				caption: "Home",
				error: `Failed to load: status ${resp ? resp.status() : "none"}`,
			});
		} else {
			await settle(page);
			shots.push({ caption: "Home", img: await shoot(page) });
		}
		sections.push({ id: "home", title: "Home", route: "/", shots });
	}

	// --- Game detail (10 tabs) ---
	{
		const route = `/games/${gameId}`;
		console.log(`Capturing ${route} (Game detail)…`);
		const shots = [];
		const resp = await page.goto(`${baseUrl}${route}`, {
			waitUntil: "load",
		});
		const tabsAppeared = await page
			.getByRole("tab", { name: "Overview" })
			.waitFor({ state: "visible", timeout: 10_000 })
			.then(() => true)
			.catch(() => false);

		if (!resp || !resp.ok() || !tabsAppeared) {
			shots.push({
				caption: "Game detail",
				error:
					"Tabs never appeared — game may be private, missing, or the page " +
					"redirected. Pass a public --game-id.",
			});
		} else {
			for (const label of GAME_TABS) {
				console.log(`  · ${label}`);
				const tab = page.getByRole("tab", { name: label, exact: true });
				if ((await tab.count()) === 0) {
					shots.push({ caption: label, error: "Tab not found" });
					continue;
				}
				await tab.click();
				await settle(page);
				shots.push({ caption: label, img: await shoot(page) });
			}
		}
		sections.push({ id: "game", title: "Game detail", route, shots });
	}

	// --- User profile (3 tabs, URL-driven) ---
	{
		const route = `/users/${userId}`;
		console.log(`Capturing ${route} (User profile)…`);
		const shots = [];
		for (const { label, param } of USER_TABS) {
			console.log(`  · ${label}`);
			const url = `${baseUrl}${route}?tab=${param}`;
			const resp = await page.goto(url, { waitUntil: "load" });
			const ready = await page
				.getByRole("tab", { name: "Overview" })
				.waitFor({ state: "visible", timeout: 10_000 })
				.then(() => true)
				.catch(() => false);
			if (!resp || !resp.ok() || !ready) {
				shots.push({
					caption: label,
					error:
						"Profile tabs never appeared — page may have redirected to home. " +
						"Pass a --user-id that has public games.",
				});
				continue;
			}
			await settle(page);
			shots.push({ caption: label, img: await shoot(page) });
		}
		sections.push({ id: "user", title: "User profile", route, shots });
	}
} finally {
	await browser.close();
}

await mkdir(path.dirname(OUT_FILE), { recursive: true });
const html = renderHtml({
	baseUrl,
	gameId,
	userId,
	generatedAt: new Date().toISOString(),
	sections,
});
await writeFile(OUT_FILE, html);

const shotCount = sections.reduce(
	(n, s) => n + s.shots.filter((x) => !x.error).length,
	0,
);
const errCount = sections.reduce(
	(n, s) => n + s.shots.filter((x) => x.error).length,
	0,
);
const sizeMb = (Buffer.byteLength(html) / 1e6).toFixed(2);
console.log(
	`\nWrote ${path.relative(process.cwd(), OUT_FILE)} — ` +
		`${shotCount} screenshots${errCount ? `, ${errCount} errors` : ""} (${sizeMb} MB).`,
);
