// Content-addressed cache for parity dumps.
//
// Each side's dump is keyed on (dumper SHA, save SHA). Re-runs over the same
// corpus skip both Rust and TS dump work entirely when nothing has changed.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type CacheSide = "rust" | "ts";

export interface CacheKey {
	side: CacheSide;
	/** SHA of the dumper artifact (rust bin contents, or TS parser tree). */
	dumperSha: string;
	/** SHA-256 of the save file. */
	saveSha: string;
}

export function cacheKeyToHash(key: CacheKey): string {
	return createHash("sha256")
		.update(`${key.side}\n${key.dumperSha}\n${key.saveSha}`)
		.digest("hex");
}

export function cachePath(cacheDir: string, key: CacheKey): string {
	return join(cacheDir, key.side, `${cacheKeyToHash(key)}.json`);
}

export async function readCachedDump(path: string): Promise<unknown | null> {
	if (!existsSync(path)) return null;
	try {
		const raw = await readFile(path, "utf8");
		return JSON.parse(raw);
	} catch {
		// Treat any read/parse failure as a cache miss; the caller will
		// regenerate and overwrite.
		return null;
	}
}

export async function writeCachedDump(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(value));
}

/** SHA-256 of a file's contents on disk. Used as the save SHA cache input. */
export async function sha256File(path: string): Promise<string> {
	const data = await readFile(path);
	return createHash("sha256").update(data).digest("hex");
}

/** SHA-256 of a string. */
export function sha256Of(s: string): string {
	return createHash("sha256").update(s).digest("hex");
}

/** File size in bytes (cheap stat, used for save provenance in reports). */
export async function fileSizeBytes(path: string): Promise<number> {
	const s = await stat(path);
	return s.size;
}
