// Reading a stored screenshot's own dimensions out of its bytes.
//
// The upload's quality floor and its pixel ceiling are both decisions about
// the image, so they have to be made from the image. The client sends
// width/height alongside it, but a client-asserted dimension gates nothing —
// and the same parse doubles as the format check, which matters more than
// usual here because the object is stored on a public host with an
// image/webp content type and never re-encoded by us.
//
// WebP is a RIFF container holding one of three image chunks, and all three
// carry the dimensions in their first few bytes:
//   VP8   lossy, after the 3-byte frame tag and the 3-byte start code
//   VP8L  lossless, 14 bits each of (width - 1) and (height - 1), bit-packed
//   VP8X  extended (alpha, animation), 24 bits each of (canvas - 1)
// A browser's canvas.convertToBlob({ type: "image/webp" }) emits VP8 today
// and VP8X when it keeps an alpha channel, but which one is the encoder's
// choice, not ours — so all three are read rather than only the one seen.

export interface ImageSize {
	width: number;
	height: number;
}

const RIFF = 0x52494646; // "RIFF"
const WEBP = 0x57454250; // "WEBP"

// A container needs the 12-byte RIFF header plus a chunk header before any
// chunk payload can be addressed.
const MIN_WEBP_BYTES = 20;

function fourCC(view: DataView, offset: number): number {
	return view.getUint32(offset, false);
}

// Null for anything that isn't a WebP we can read a size out of — a wrong
// magic, a truncated chunk, an unknown image chunk, or a zero dimension. The
// caller turns that into one refusal; there is nothing a finer-grained
// diagnosis would let it do differently.
export function readWebpSize(bytes: Uint8Array): ImageSize | null {
	if (bytes.byteLength < MIN_WEBP_BYTES) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (fourCC(view, 0) !== RIFF || fourCC(view, 8) !== WEBP) return null;

	// Chunks start after the 12-byte RIFF header. Each is a 4-byte FourCC, a
	// 4-byte little-endian payload size, and the payload padded to even.
	let offset = 12;
	while (offset + 8 <= bytes.byteLength) {
		const tag = fourCC(view, offset);
		const size = view.getUint32(offset + 4, true);
		const payload = offset + 8;
		if (payload + size > bytes.byteLength) return null;
		const found = sizeFromChunk(view, tag, payload, size);
		if (found) return found;
		// Only the image chunks answer; anything else (ICCP, EXIF, XMP, and
		// the ANIM/ANMF pair) is skipped. `size + (size & 1)` is the pad byte.
		offset = payload + size + (size & 1);
	}
	return null;
}

const VP8 = 0x56503820; // "VP8 "
const VP8L = 0x5650384c; // "VP8L"
const VP8X = 0x56503858; // "VP8X"

function sizeFromChunk(
	view: DataView,
	tag: number,
	payload: number,
	size: number,
): ImageSize | null {
	if (tag === VP8) {
		// 3-byte frame tag, then the 0x9d 0x01 0x2a start code, then two
		// 16-bit words whose low 14 bits are the dimensions.
		if (size < 10) return null;
		if (
			view.getUint8(payload + 3) !== 0x9d ||
			view.getUint8(payload + 4) !== 0x01 ||
			view.getUint8(payload + 5) !== 0x2a
		) {
			return null;
		}
		return nonZero(
			view.getUint16(payload + 6, true) & 0x3fff,
			view.getUint16(payload + 8, true) & 0x3fff,
		);
	}
	if (tag === VP8L) {
		// A 0x2f signature byte, then 14 bits of (width - 1) and 14 bits of
		// (height - 1), packed little-endian across the next four bytes.
		if (size < 5 || view.getUint8(payload) !== 0x2f) return null;
		const bits = view.getUint32(payload + 1, true);
		return nonZero((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
	}
	if (tag === VP8X) {
		// 4 bytes of flags, then 24-bit (canvas width - 1) and 24-bit
		// (canvas height - 1). The canvas is what a viewer sees, which is the
		// dimension the strip tile and the thumbnail are cut from.
		if (size < 10) return null;
		return nonZero(
			uint24(view, payload + 4) + 1,
			uint24(view, payload + 7) + 1,
		);
	}
	return null;
}

function uint24(view: DataView, offset: number): number {
	return (
		view.getUint8(offset) |
		(view.getUint8(offset + 1) << 8) |
		(view.getUint8(offset + 2) << 16)
	);
}

function nonZero(width: number, height: number): ImageSize | null {
	return width > 0 && height > 0 ? { width, height } : null;
}
