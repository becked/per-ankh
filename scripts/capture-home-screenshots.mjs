// Capture the three screenshots used on the marketing home (/) — Overview,
// Map, and Yields tabs — against the running dev server. Each tab is
// driven in headless Chromium, the visible page area is screenshotted as
// PNG, then re-encoded as WebP via sharp and written to
// static/screenshots/{overview,map,yields}.webp.
//
// Requirements:
//   1. The local dev server is up (`./per-ankh` — http://localhost:1420).
//   2. The target game is marked public (`is_public = TRUE`) so anonymous
//      Chromium can load it. If you keep it private, pass --cookie
//      "pa_session=<your-session-cookie>" to authenticate.
//
// Run with: npm run bake:screenshots

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import sharp from "sharp";

const DEFAULT_GAME_ID = "jv5NMGnkG7k9yOqrNjxjt";
const DEFAULT_BASE_URL = "http://localhost:1420";
const OUT_DIR = path.resolve("static", "screenshots");

// 1440×900 mirrors a typical laptop viewport. The home page renders the
// screenshots at one-third width inside a max-w-5xl wrapper, so this
// resolution leaves plenty of pixel headroom after the WebP downscale.
const VIEWPORT = { width: 1440, height: 900 };

// Tabs to capture. `selector` is the rendered button's accessible name
// (bits-ui Tabs.Trigger emits a <button>); Playwright's `getByRole` matches
// by accessible name and survives Tailwind class churn.
const TABS = [
	{ key: "overview", label: "Overview" },
	{ key: "map", label: "Map" },
	{ key: "yields", label: "Yields" },
];

function parseArgs(argv) {
	const out = {
		gameId: DEFAULT_GAME_ID,
		baseUrl: DEFAULT_BASE_URL,
		cookie: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--game-id") out.gameId = argv[++i];
		else if (a === "--base-url") out.baseUrl = argv[++i];
		else if (a === "--cookie") out.cookie = argv[++i];
		else if (a === "--help" || a === "-h") {
			console.log(
				"usage: node scripts/capture-home-screenshots.mjs [--game-id <id>] [--base-url <url>] [--cookie <pa_session=...>]",
			);
			process.exit(0);
		} else {
			console.error(`unknown arg: ${a}`);
			process.exit(1);
		}
	}
	return out;
}

const { gameId, baseUrl, cookie } = parseArgs(process.argv.slice(2));
const gameUrl = `${baseUrl}/games/${gameId}`;

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
	const ctx = await browser.newContext({
		viewport: VIEWPORT,
		deviceScaleFactor: 2,
	});

	if (cookie) {
		// Allow capturing private games when the user passes a session
		// cookie. Format expected: "name=value" (e.g. "pa_session=...").
		const [name, ...rest] = cookie.split("=");
		const value = rest.join("=");
		const url = new URL(baseUrl);
		await ctx.addCookies([
			{
				name: name.trim(),
				value: value.trim(),
				domain: url.hostname,
				path: "/",
				secure: url.protocol === "https:",
				httpOnly: false,
				sameSite: "Lax",
			},
		]);
	}

	const page = await ctx.newPage();
	console.log(`Navigating to ${gameUrl}`);
	const resp = await page.goto(gameUrl, { waitUntil: "networkidle" });
	if (!resp || !resp.ok()) {
		throw new Error(
			`Failed to load ${gameUrl}: status ${resp ? resp.status() : "no response"}. ` +
				`Is the dev server running and is the game public (or did you pass --cookie)?`,
		);
	}

	// Wait until the tab list is rendered. If the page redirected (e.g. to
	// /login because the game is private), Overview won't appear.
	await page
		.getByRole("tab", { name: "Overview" })
		.waitFor({ state: "visible", timeout: 10_000 })
		.catch(() => {
			throw new Error(
				`Tabs never appeared. Likely causes: the game is private (pass --cookie), ` +
					`or the game_id doesn't exist on this server.`,
			);
		});

	for (const tab of TABS) {
		console.log(`Capturing ${tab.label}…`);
		await page.getByRole("tab", { name: tab.label }).click();
		// Charts/maps inside the tab content are async. networkidle isn't
		// enough on its own because ECharts renders client-side after the
		// fetch resolves; the 600ms settle is empirical for this app.
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(600);
		await page.evaluate(() => window.scrollTo(0, 0));

		const png = await page.screenshot({ type: "png", fullPage: false });
		const webp = await sharp(png)
			.resize({ width: 1280, withoutEnlargement: true })
			.webp({ quality: 82 })
			.toBuffer();
		const outPath = path.join(OUT_DIR, `${tab.key}.webp`);
		await writeFile(outPath, webp);
		console.log(
			`  → ${path.relative(process.cwd(), outPath)} (${webp.length} bytes)`,
		);
	}
} finally {
	await browser.close();
}

console.log("Done.");
