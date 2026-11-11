// SVG → PNG inside the Worker, with no browser.
//
// A link-preview crawler will not take an SVG: Discord's `og:image` accepts
// png/jpg/webp/gif/avif and nothing else, and Cloudflare's image
// transformations deliver SVG untransformed rather than rasterizing it. So
// the card is built as SVG (card-svg.ts) and turned into bytes here.
//
// resvg is wasm, imported as a module so workerd compiles it at deploy time
// rather than at the first request. `initWasm` is idempotent per isolate and
// kept behind a memoized promise — a second call throws ("Already initialized"),
// which concurrent first requests in one isolate would otherwise hit.
//
// Fonts are passed as bytes: resvg reads no system fonts in a Worker and
// `loadSystemFonts` is false regardless, so the two baked Inter instances are
// the entire font stack. A codepoint neither covers draws nothing.

import { initWasm, Resvg } from "@resvg/resvg-wasm";
import wasm from "@resvg/resvg-wasm/index_bg.wasm";
import {
	CARD_FONT_400_BASE64,
	CARD_FONT_700_BASE64,
	CARD_FONT_FAMILY,
} from "../generated/card-fonts";

function decodeBase64(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

let fontBuffers: Uint8Array[] | null = null;

function fonts(): Uint8Array[] {
	fontBuffers ??= [
		decodeBase64(CARD_FONT_400_BASE64),
		decodeBase64(CARD_FONT_700_BASE64),
	];
	return fontBuffers;
}

let ready: Promise<void> | null = null;

function initOnce(): Promise<void> {
	ready ??= initWasm(wasm);
	return ready;
}

/** Rasterize a card SVG to PNG bytes at its own intrinsic size. */
export async function renderCardPng(svg: string): Promise<Uint8Array> {
	await initOnce();
	// Both wasm handles are freed by hand, and the `finally` blocks are why a
	// throw cannot skip it. resvg's bindings register a wrapped `RenderedImage`
	// with a FinalizationRegistry, but a directly-constructed `Resvg` is never
	// registered at all — its constructor sets the pointer and returns, and
	// `__destroy_into_raw` only ever *unregisters* — so `free()` is the only
	// thing that reclaims the parsed tree and the font database built with it.
	// Unfreed, each render would hold its allocation for the isolate's life,
	// against a 128 MB limit, on a route whose work is cache misses.
	const resvg = new Resvg(svg, {
		font: {
			loadSystemFonts: false,
			fontBuffers: fonts(),
			defaultFontFamily: CARD_FONT_FAMILY,
		},
	});
	try {
		const rendered = resvg.render();
		try {
			return rendered.asPng();
		} finally {
			rendered.free();
		}
	} finally {
		resvg.free();
	}
}
