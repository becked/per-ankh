// Generate og-default.png — a 1200×630 unfurl card for Discord/Slack/X
// previews. Renders the U+13251 hieroglyph (𓉑) in brand orange on a
// dark-brown tile, then composites that onto the brand-tan card with
// "Per-Ankh — Old World save analytics" text.
//
// Writes to BOTH `static/` (cloud SvelteKit app) and `web/static/`
// (legacy share viewer) so both apps unfurl with the same brand.
//
// Run with: npm run bake:og

import { chromium } from "playwright";
import sharp from "sharp";
import path from "node:path";

const root = process.argv[2];
if (!root) {
	console.error("usage: node make-og-default.mjs <repo-root>");
	process.exit(1);
}

const W = 1200;
const H = 630;

// Brand colors from src/app.css / tailwind.config.js.
const BG = { r: 210, g: 180, b: 140 }; // #D2B48C — tan
const BORDER = { r: 80, g: 50, b: 30 }; // brown
const ICON_BG = { r: 0x21, g: 0x1a, b: 0x12 }; // dark brown — same as favicon
const ORANGE = "#ffa500";

const ICON_SIZE = 360;
const ICON_RADIUS = 32;

// Render the 𓉑 glyph oversized so the font's ascender area can't clip
// it; trim and recenter inside a rounded dark-brown tile that matches the
// favicon's look.
const RENDER_PX = 1024;
const FONT_PX = 760;

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

// Trim alpha bbox of glyph render.
const trimmedMeta = await sharp(rendered).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
const trimmed = trimmedMeta.data;
const { width: tw, height: th } = trimmedMeta.info;

// Fit the trimmed glyph into a square that's ~70% of the ICON_SIZE tile,
// then center it on a rounded dark-brown background.
const glyphFit = Math.round(ICON_SIZE * 0.7);
const scale = glyphFit / Math.max(tw, th);
const scaledW = Math.round(tw * scale);
const scaledH = Math.round(th * scale);
const scaledGlyph = await sharp(trimmed).resize(scaledW, scaledH, { kernel: "lanczos3" }).png().toBuffer();

const roundedTile = await sharp({
	create: {
		width: ICON_SIZE,
		height: ICON_SIZE,
		channels: 4,
		background: { ...ICON_BG, alpha: 1 },
	},
})
	.composite([
		// Rounded-corner mask via SVG, applied with dest-in.
		{
			input: Buffer.from(
				`<svg width="${ICON_SIZE}" height="${ICON_SIZE}"><rect x="0" y="0" width="${ICON_SIZE}" height="${ICON_SIZE}" rx="${ICON_RADIUS}" ry="${ICON_RADIUS}" fill="white"/></svg>`,
			),
			blend: "dest-in",
		},
		{
			input: scaledGlyph,
			top: Math.floor((ICON_SIZE - scaledH) / 2),
			left: Math.floor((ICON_SIZE - scaledW) / 2),
		},
	])
	.png()
	.toBuffer();

const card = await sharp({
	create: {
		width: W,
		height: H,
		channels: 4,
		background: { ...BG, alpha: 1 },
	},
})
	.composite([
		// Border + text overlay (SVG keeps the layout simple vs. drawing
		// stroked rects with sharp directly).
		{
			input: Buffer.from(
				`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
					<rect x="20" y="20" width="${W - 40}" height="${H - 40}"
					      fill="none" stroke="rgb(${BORDER.r},${BORDER.g},${BORDER.b})" stroke-width="6" />
					<text x="${W / 2}" y="${H - 90}" font-family="serif" font-size="64" fill="rgb(${BORDER.r},${BORDER.g},${BORDER.b})" text-anchor="middle">Per-Ankh</text>
					<text x="${W / 2}" y="${H - 40}" font-family="serif" font-size="28" fill="rgb(${BORDER.r},${BORDER.g},${BORDER.b})" text-anchor="middle">Old World save analytics</text>
				</svg>`,
			),
			top: 0,
			left: 0,
		},
		{
			input: roundedTile,
			top: Math.floor((H - ICON_SIZE) / 2) - 60,
			left: Math.floor((W - ICON_SIZE) / 2),
		},
	])
	.png()
	.toBuffer();

const targets = [
	path.join(root, "static", "og-default.png"),
	path.join(root, "web", "static", "og-default.png"),
];

for (const out of targets) {
	await sharp(card).toFile(out);
	console.log(`wrote ${out}`);
}
