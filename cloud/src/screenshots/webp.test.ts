import { describe, expect, it } from "vitest";
import { readWebpSize } from "./webp";

// The fixtures are REAL encoder output, not bytes written by hand: a header
// parser tested against a hand-rolled header only proves the test and the
// parser agree. Each was produced by sharp (the encoder the eval's resize
// pipeline uses) at a deliberately odd size, so a byte-order slip shows up as
// a wrong number rather than a square that happens to match:
//
//   sharp({ create: { width, height, channels } }).webp(opts).toBuffer()
//     lossy     37x24  quality 80          -> VP8
//     lossless  41x29  lossless: true      -> VP8L
//     alpha     53x31  quality 80, 4 chan  -> VP8X (+ ALPH, VP8)
//
// Which chunk an encoder picks is its choice, not ours — a browser's
// convertToBlob emits VP8 today and VP8X when it keeps an alpha channel — so
// all three shapes are pinned.
const LOSSY_37x24 =
	"UklGRlAAAABXRUJQVlA4IEQAAACQAwCdASolABgAPm02l0ikIyIhJWgAgA2JZwDHIoB+AAAr98NwAP7svY//ILlhdcjX/6tD5aHy0P3Coi3l/TAAAAAAAA==";
const LOSSLESS_41x29 = "UklGRh4AAABXRUJQVlA4TBEAAAAvKAAHAAdQniKXov+BiOh/AAA=";
const ALPHA_53x31 =
	"UklGRnwAAABXRUJQVlA4WAoAAAAQAAAANAAAHgAAQUxQSBAAAAABB1DAiAgACeH/eTWi/+kFVlA4IEYAAACwAwCdASo1AB8APm02l0ikIyIhJAgAgA2JZwDKpoB+AAAgjSRhoAD+7L2P/yC5YXXI1/+rQ+Wh8tD9wqI0MphrnViAAAAA";

function bytes(base64: string): Uint8Array {
	return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

describe("readWebpSize", () => {
	it("reads a lossy VP8 canvas", () => {
		expect(readWebpSize(bytes(LOSSY_37x24))).toEqual({
			width: 37,
			height: 24,
		});
	});

	it("reads a lossless VP8L canvas", () => {
		expect(readWebpSize(bytes(LOSSLESS_41x29))).toEqual({
			width: 41,
			height: 29,
		});
	});

	// The VP8X canvas, not the dimensions of the VP8 chunk further in — those
	// agree here, but the canvas is what a viewer sees and what a thumbnail
	// transformation is cut from.
	it("reads an extended VP8X canvas past the ALPH chunk", () => {
		expect(readWebpSize(bytes(ALPHA_53x31))).toEqual({
			width: 53,
			height: 31,
		});
	});

	// Null is the upload endpoint's one refusal — INVALID_IMAGE — so every
	// way of not being a readable WebP has to reach it rather than throw or
	// return a plausible size.
	it("refuses anything that is not a readable WebP", () => {
		const webp = bytes(LOSSY_37x24);
		// A PNG, which is what an un-re-encoded screenshot would be.
		expect(
			readWebpSize(
				new Uint8Array([
					0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49,
					0x48, 0x44, 0x52, 0, 0, 0x04, 0, 0, 0, 0x02, 0x40,
				]),
			),
		).toBeNull();
		// Too short to hold a chunk header at all.
		expect(readWebpSize(webp.subarray(0, 16))).toBeNull();
		// RIFF, but not WEBP.
		const wrongForm = webp.slice();
		wrongForm.set([0x41, 0x56, 0x49, 0x20], 8); // "AVI "
		expect(readWebpSize(wrongForm)).toBeNull();
		// A chunk whose declared size runs past the end of the buffer.
		expect(readWebpSize(webp.subarray(0, 30))).toBeNull();
		// Empty.
		expect(readWebpSize(new Uint8Array())).toBeNull();
	});
});
