// Generate static/og-default.png — a 1200×630 placeholder for Discord/
// Slack/Twitter unfurls of public game pages. Composes the app icon
// centered on the brand-tan background.
import sharp from "sharp";
import path from "node:path";

const root = process.argv[2];
if (!root) {
	console.error("usage: node make-og-default.mjs <repo-root>");
	process.exit(1);
}

const W = 1200;
const H = 630;

// Brand colors from src/app.css / tailwind.config.js — tan background,
// brown ring, orange accent. Hex matches existing theme.
const BG = { r: 210, g: 180, b: 140 }; // #D2B48C — tan
const BORDER = { r: 80, g: 50, b: 30 }; // brown

const iconPath = path.join(root, "app-icon.png");
const iconSize = 360;

const icon = await sharp(iconPath).resize(iconSize, iconSize).png().toBuffer();

await sharp({
	create: {
		width: W,
		height: H,
		channels: 4,
		background: { ...BG, alpha: 1 },
	},
})
	.composite([
		// Border rectangle drawn via SVG overlay — simple enough vs
		// generating a stroked rect with sharp directly.
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
			input: icon,
			top: Math.floor((H - iconSize) / 2) - 60,
			left: Math.floor((W - iconSize) / 2),
		},
	])
	.png()
	.toFile(path.join(root, "static", "og-default.png"));

console.log("wrote static/og-default.png");
