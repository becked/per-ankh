// Web Worker entry point for upload-path step 1: a picked image in, the
// stored variant out (issue #289). Instantiated via
// `import DownscaleWorker from "$lib/screenshots/downscale-worker?worker"` —
// the Vite worker constructor the parser worker already uses — and wrapped by
// downscale.ts, which is what components call.
//
// Off the main thread because the decode is the expensive part: a 3840x2160
// screenshot is 31.6 MiB of RGBA before anything is resized, and a tab that
// does that inline drops frames on the page behind the picker.
//
// Protocol (typed message union):
//   parent → worker: { type: "downscale", file: Blob }
//   worker → parent: { type: "result", webp, width, height, source… }
//   worker → parent: { type: "error", message, code }
//
// It re-encodes rather than forwarding the file, and that is load-bearing in
// two directions: the endpoint classifies the exact bytes it stores, and the
// re-encode is also what strips EXIF and flattens animation — which is why
// the gate's only free check is a size floor and the camera case is carried
// by the classifier's is_a_photograph question instead.

/// <reference lib="webworker" />

import { STORED_WEBP_QUALITY, storedDimensions } from "./stored-variant";

// What this will attempt to decode. `accept="image/*"` bounds nothing, and the
// cost of a picked image is its PIXEL count rather than its file size — a
// flat-UI PNG at 8000x8000 compresses to a few MB and decodes to 256 MiB of
// RGBA — so the ceiling that matters is on pixels, measured after the first
// decode and before the resize allocates a second bitmap.
//
// 40 MP leaves every screenshot workflow alone: an 8K grab is 33 MP and a
// 5K iMac @2x full screen is 14.7 MP, while a 6K XDR @2x capture is 81 MP and
// gets a crop-it-or-save-it-smaller sentence instead of a worker that dies
// with the generic message.
const MAX_SOURCE_PIXELS = 40_000_000;

// The nearly-free companion, read before the decode is spent: it catches a
// mis-picked RAW or TIFF, which `image/*` admits and the decoder then either
// refuses or spends real memory on. Decimal MB rather than the repo's usual
// MiB idiom because this number reaches the uploader as copy, and the file
// size they can see in Finder or Explorer is decimal too.
const MAX_SOURCE_BYTES = 40_000_000;

// Neither ceiling catches a decoder that dies inside `createImageBitmap`
// itself — that arrives as the wrapper's `WORKER_FAILED`, which is the right
// shape of answer with the wrong sentence in it. These two are what keep the
// cases a picker can reach out of that path.

export type DownscaleRequest = {
	type: "downscale";
	file: Blob;
};

export type DownscaleResultMsg = {
	type: "result";
	// What the upload sends and R2 stores.
	webp: Blob;
	width: number;
	height: number;
	// The decoded source's dimensions, after any EXIF rotation — what the
	// picker reports as "resized from".
	sourceWidth: number;
	sourceHeight: number;
};

export type DownscaleErrorMsg = {
	type: "error";
	message: string;
	code: string;
};

export type DownscaleMessage = DownscaleResultMsg | DownscaleErrorMsg;

// eslint-disable-next-line no-undef -- Web Worker global, not in eslint browser env
const ctx = self as unknown as DedicatedWorkerGlobalScope;

// A failure the user can be told about verbatim, paired with a code the
// wrapper re-throws. Everything else reaches the parent as its own message.
class DownscaleError extends Error {
	constructor(
		message: string,
		public code: string,
	) {
		super(message);
	}
}

ctx.onmessage = async (e: MessageEvent<DownscaleRequest>) => {
	if (e.data.type !== "downscale") return;
	try {
		ctx.postMessage(await downscale(e.data.file));
	} catch (err) {
		ctx.postMessage({
			type: "error",
			message:
				err instanceof DownscaleError
					? err.message
					: "Couldn't prepare that image",
			code: err instanceof DownscaleError ? err.code : "DOWNSCALE_FAILED",
		} satisfies DownscaleErrorMsg);
	}
};

async function downscale(file: Blob): Promise<DownscaleResultMsg> {
	if (file.size > MAX_SOURCE_BYTES) {
		throw new DownscaleError(
			`That file is ${Math.round(file.size / 1_000_000)} MB, too big to prepare for upload. Save it at a smaller size or crop it first.`,
			"FILE_TOO_LARGE",
		);
	}

	// Decoded once, unresized, to learn the dimensions the target is computed
	// from: EXIF rotation can swap them, so the picked file's own header is
	// the wrong source for them. `imageOrientation` is named rather than left
	// to the default because it is what keeps this in step with the eval's
	// sharp `.autoOrient()`.
	let source: ImageBitmap;
	try {
		source = await createImageBitmap(file, { imageOrientation: "from-image" });
	} catch {
		throw new DownscaleError(
			"That file isn't an image this browser can read",
			"DECODE_FAILED",
		);
	}

	const sourceWidth = source.width;
	const sourceHeight = source.height;

	// Before the resize, which is where a second bitmap of this size gets
	// allocated. Closed on the way out rather than left to the collector,
	// since the whole point of refusing is that these bytes are the problem.
	if (sourceWidth * sourceHeight > MAX_SOURCE_PIXELS) {
		source.close();
		throw new DownscaleError(
			`That image is ${Math.round((sourceWidth * sourceHeight) / 1_000_000)} megapixels, too big to prepare for upload. Crop it or save it at a smaller size.`,
			"SOURCE_TOO_LARGE",
		);
	}

	const { width, height } = storedDimensions(sourceWidth, sourceHeight);

	// The resize. `resizeQuality: "high"` is the browser's own downsampler;
	// drawImage's is bilinear and aliases visibly at the 2-3x factors a Retina
	// capture needs. Re-wrapping the decoded bitmap rather than re-reading the
	// blob means one decode.
	let bitmap = source;
	if (width !== sourceWidth || height !== sourceHeight) {
		bitmap = await createImageBitmap(source, {
			resizeWidth: width,
			resizeHeight: height,
			resizeQuality: "high",
		});
	}

	// Did the browser honour the resize? Not every one does — Firefox only
	// learned `resizeQuality` in 149 and ignores the dictionary before that,
	// and Safari's support is listed as partial below 16.6 — in which case
	// the call above hands back a full-size copy instead. The output
	// dimensions come out the same either way, because the blit below scales
	// whatever it is given to the canvas, so nothing downstream can tell the
	// difference: the only symptom is the aliasing `resizeQuality` was asked
	// for to avoid. Halving down to within 2x of the target first is where
	// drawImage's filter is clean, so the fallback costs picture quality
	// rather than producing it.
	const resampled = bitmap.width === width && bitmap.height === height;

	// The source is read for the last time by the test above: both branches
	// below draw from `bitmap`. Closing it here rather than after the blit is
	// what keeps peak memory at one full-size bitmap on the ignored-dictionary
	// path, where the copy that came back is full size too. When no resize was
	// needed `bitmap` IS `source`, so there it has to survive the blit.
	if (bitmap !== source) source.close();

	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext("2d");
	if (!context) {
		throw new DownscaleError(
			"This browser can't prepare images for upload",
			"NO_CANVAS",
		);
	}
	context.imageSmoothingQuality = "high";
	context.drawImage(
		resampled ? bitmap : halveToward(bitmap, width, height),
		0,
		0,
		width,
		height,
	);
	bitmap.close();

	const webp = await canvas.convertToBlob({
		type: "image/webp",
		quality: STORED_WEBP_QUALITY / 100,
	});
	// convertToBlob falls back to PNG when it can't encode the type asked
	// for, silently and with no error. The endpoint reads the dimensions out
	// of the WebP container and refuses anything else, so catching it here is
	// the difference between a browser-shaped message and a 400.
	if (webp.type !== "image/webp") {
		throw new DownscaleError(
			"This browser can't encode WebP, which screenshots are stored as",
			"NO_WEBP",
		);
	}

	return {
		type: "result",
		webp,
		width,
		height,
		sourceWidth,
		sourceHeight,
	};
}

// Repeated halvings until one more would undershoot the target, so whatever
// comes back is within 2x of it and the caller's single blit is a factor
// drawImage's bilinear filter handles without aliasing. Only reached when the
// browser ignored the resize options above.
//
// Each step draws into its own OffscreenCanvas, which is itself a drawImage
// source, so the chain needs no ImageBitmap round trip. The aspect ratio is
// uniform, so both dimensions cross the 2x line together; requiring both
// keeps a degenerate 1 px target terminating.
function halveToward(
	source: ImageBitmap,
	targetWidth: number,
	targetHeight: number,
): ImageBitmap | OffscreenCanvas {
	let current: ImageBitmap | OffscreenCanvas = source;
	let width = source.width;
	let height = source.height;
	while (width >= targetWidth * 2 && height >= targetHeight * 2) {
		width = Math.max(targetWidth, Math.round(width / 2));
		height = Math.max(targetHeight, Math.round(height / 2));
		const step = new OffscreenCanvas(width, height);
		const context = step.getContext("2d");
		if (!context) {
			throw new DownscaleError(
				"This browser can't prepare images for upload",
				"NO_CANVAS",
			);
		}
		context.imageSmoothingQuality = "high";
		context.drawImage(current, 0, 0, width, height);
		current = step;
	}
	return current;
}
