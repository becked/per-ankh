// One game's save ZIP off R2, cached on disk — the read both corpus sweeps in
// ./commands/ begin with.
//
// Shared for the reason mapLimit is (../lib/map-limit.ts): the two sweeps want
// identical behaviour out of this step. A wrangler spawn per save dominates
// the wall clock, so a download is kept on disk and reused across runs; an
// interrupted run can leave a zero-byte file behind, which would fail the
// archive check forever if it counted as a hit; and the bytes have to reach
// extractXmlFromZip as exactly the slice Node read, not the pooled buffer
// they sit in.

import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { r2Get } from "./wrangler";
import { extractXmlFromZip } from "../../src/lib/parser/extract-zip";

export interface CachedSave {
	// The archive exactly as stored. The reparse sweep posts these bytes back:
	// their SHA-256 is the dedup key that makes the Worker recognize the game
	// instead of creating a second one.
	zip: Buffer;
	xml: string;
	// The name of the ZIP entry the XML came from. It travels with the XML
	// because it is data: a save with no `SaveDate` attribute carries its write
	// timestamp only here (parseEntryNameDate,
	// src/lib/parser/parsers/match-metadata.ts). A sweep that dropped it would
	// write `save_date: null` where the browser sweep writes the date, and the
	// two must agree — the browser reaches the same parse through
	// `extractAllGameData`'s entryName argument (src/lib/parser/worker.ts).
	entryName: string;
}

// Null means R2 holds no object for this game — a miss, which both sweeps
// report as such. Anything else (a wrangler failure, a corrupt archive)
// throws.
export async function readCachedSave(
	gameId: string,
	cacheDir: string,
): Promise<CachedSave | null> {
	const dest = resolve(cacheDir, `${gameId}.zip`);
	// Only a non-empty cache entry counts (see above).
	const cached = existsSync(dest) && (await stat(dest)).size > 0;
	if (!cached && !(await r2Get(`saves/${gameId}.zip`, dest))) return null;
	const zip = await readFile(dest);
	const { xml, entryName } = extractXmlFromZip(
		zip.buffer.slice(
			zip.byteOffset,
			zip.byteOffset + zip.byteLength,
		) as ArrayBuffer,
	);
	return { zip, xml, entryName };
}
