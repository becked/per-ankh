// Generate the per-ankh.app favicon set from the U+13251 hieroglyph (𓉑).
// Renders the glyph in brand orange on the brand dark-brown background via
// headless Chromium, then derives ICO + PNG variants and writes them to
// both `static/` (cloud SvelteKit app) and `web/static/` (legacy share
// viewer) so both apps stay in sync.
//
// Run with: npm run bake:favicon
//
// Outputs (per target dir):
//   favicon.ico          — multi-res 16/32/48
//   favicon-32.png       — 32×32
//   apple-touch-icon.png — 180×180
//   favicon.png          — 512×512

import { chromium } from "playwright";
import sharp from "sharp";
import pngToIco from "png-to-ico";
import path from "node:path";
import { writeFile } from "node:fs/promises";

const root = process.argv[2];
if (!root) {
	console.error("usage: node bake-favicon.mjs <repo-root>");
	process.exit(1);
}

// Brand palette — kept in sync with src/app.css.
const ORANGE = "#ffa500";
const DARK_BROWN = { r: 0x21, g: 0x1a, b: 0x12, alpha: 1 };

// Render the glyph oversized so the font's ascender area can't clip it;
// trim and recenter afterwards. (Apple Symbols / Noto Sans Egyptian
// Hieroglyphs both ship on macOS; the system stack picks one at runtime.)
const RENDER_PX = 1024;
const FONT_PX = 440;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: RENDER_PX, height: RENDER_PX },
	deviceScaleFactor: 1,
});
const page = await context.newPage();

await page.setContent(
	`<!doctype html>
<html><head><style>
  html, body { margin:0; padding:0; background:transparent; }
  body {
    width:${RENDER_PX}px; height:${RENDER_PX}px;
    display:flex; align-items:center; justify-content:center;
    font-family: "Apple Symbols","Noto Sans Egyptian Hieroglyphs","Segoe UI Historic", sans-serif;
    color:${ORANGE};
    line-height:1;
  }
  .glyph { font-size:${FONT_PX}px; }
</style></head>
<body><span class="glyph">&#x13251;</span></body></html>`,
	{ waitUntil: "load" },
);

await page.evaluate(() => document.fonts.ready);

const rendered = await page.screenshot({ omitBackground: true });
await browser.close();

// Trim alpha bbox, then pad onto a square dark-brown canvas with ~16%
// breathing room so the glyph doesn't kiss the edges at 16/32 px.
const trimmedMeta = await sharp(rendered).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
const trimmed = trimmedMeta.data;
const { width: tw, height: th } = trimmedMeta.info;

const side = Math.max(tw, th);
const pad = Math.round(side * 0.16);
const canvasSide = side + pad * 2;

const masterPng = await sharp({
	create: {
		width: canvasSide,
		height: canvasSide,
		channels: 4,
		background: DARK_BROWN,
	},
})
	.composite([
		{
			input: trimmed,
			top: Math.floor((canvasSide - th) / 2),
			left: Math.floor((canvasSide - tw) / 2),
		},
	])
	.png()
	.toBuffer();

// Resize once per output size from the master.
async function resize(target) {
	return sharp(masterPng).resize(target, target, { kernel: "lanczos3" }).png().toBuffer();
}

const png16 = await resize(16);
const png32 = await resize(32);
const png48 = await resize(48);
const png180 = await resize(180);
const png512 = await resize(512);

// Multi-resolution ICO from raw PNG buffers.
const ico = await pngToIco([png16, png32, png48]);

const targets = [
	path.join(root, "static"),
	path.join(root, "web", "static"),
];

for (const dir of targets) {
	await writeFile(path.join(dir, "favicon.ico"), ico);
	await writeFile(path.join(dir, "favicon-32.png"), png32);
	await writeFile(path.join(dir, "apple-touch-icon.png"), png180);
	await writeFile(path.join(dir, "favicon.png"), png512);
	console.log(`wrote favicon set to ${dir}`);
}
