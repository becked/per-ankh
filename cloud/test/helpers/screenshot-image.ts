// WebP fixtures for the screenshot upload tests.
//
// Real encoder output, because the upload path reads the dimensions out of the
// container itself (cloud/src/screenshots/webp.ts) — bytes written by hand
// would only prove the fixture and the parser agree. Both were produced by
// sharp, the encoder the threshold eval's resize pipeline uses:
//
//   sharp({ create: { width, height, channels: 3, background } })
//     .webp({ quality: 80 }).toBuffer()
//
// A flat colour, so they stay small: what they look like is the stubbed
// classifier's business, not the gate's.

// Clears the 640 px long-edge pre-filter.
const WEBP_800x600 =
	"UklGRqYDAABXRUJQVlA4IJoDAACwaQCdASogA1gCPm02mUmkIyKhIAgAgA2JaW7hd2Ee3AAAE9gHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtWAAD+/7F4f/+HKn07ex//ELvYwoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

// Fails it: 320 px on the long edge.
const WEBP_320x240 =
	"UklGRs4AAABXRUJQVlA4IMIAAACQEwCdASpAAfAAPm02mUmkIyKhICgAgA2JaW7hd2Ee3AAAE9gHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZMQAA/v+xeH//hyp9O3sf/xC72MKAAAAAAAAAAAAAAA==";

function decode(base64: string): Uint8Array {
	return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export const SCREENSHOT_WIDTH = 800;
export const SCREENSHOT_HEIGHT = 600;

export function screenshotBytes(): Uint8Array {
	return decode(WEBP_800x600);
}

export function tooSmallScreenshotBytes(): Uint8Array {
	return decode(WEBP_320x240);
}

// The multipart body POST /v1/games/:id/screenshots takes.
export function screenshotForm(opts?: {
	bytes?: Uint8Array;
	caption?: string;
	contentType?: string;
}): FormData {
	const form = new FormData();
	form.set(
		"image",
		new Blob([opts?.bytes ?? screenshotBytes()], {
			type: opts?.contentType ?? "image/webp",
		}),
		"shot.webp",
	);
	if (opts?.caption !== undefined) form.set("caption", opts.caption);
	return form;
}
