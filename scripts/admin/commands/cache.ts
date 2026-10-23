// `./per-ankh admin cache <subcommand>` — inspect and clear the KV-backed
// caches. Both live in SESSIONS_KV alongside the `session:` and `oauth:` keys
// (see cloud/src/stats/cache.ts and cloud/src/video/cache.ts), so KINDS below
// is the safety boundary: no combination of flags can reach an auth key and
// sign every user out.
//
// This clears *every* schema version of a prefix, not just the current one —
// invalidateStatsCache in the Worker walks only `stats:v{BUNDLE_SCHEMA_VERSION}`,
// leaving entries orphaned by a version bump to age out over 24h. Sweeping
// those is the point of an operator command.
//
// Scope note: the parsed-game blob cache (cloud/src/blob-cache.ts) is NOT
// reachable from here, and can't be. It lives in each POP's Cache API storage
// rather than KV — wrangler has no cache command, and zone purge can't address
// the keys because they're synthetic and belong to no zone. It also doesn't
// need an operator lever: the cache key carries the game's parser_version, so a
// reparse drifts the key and every POP misses at once. Stale bytes despite that
// mean the D1-batch-rollback path in handleGameUpload, which the Worker evicts
// locally, and which expires on its own inside 24h.

import { kvBulkDelete, kvList, type KvKey } from "../wrangler";
import { confirmTyping } from "../../lib/confirm";
import {
	type Column,
	emdash,
	formatDate,
	info,
	ok,
	printCount,
	printTable,
	warn,
} from "../../lib/format";
import {
	type CommandOpts,
	flagInt,
	flagString,
	parseFlags,
	printJson,
} from "../../lib/cli";

// The only prefixes this command may touch.
const KINDS = {
	stats: {
		prefix: "stats:",
		label: "stats bundles",
		note: "next /stats read recomputes from D1",
	},
	videos: {
		prefix: "videos:",
		label: "video feeds",
		note: "next profile/tournament view refetches from YouTube (spends Data API quota)",
	},
} as const;

type CacheKind = keyof typeof KINDS;

const KIND_NAMES = Object.keys(KINDS) as CacheKind[];

export async function run(argv: string[], opts: CommandOpts): Promise<void> {
	const sub = argv[0];
	const rest = argv.slice(1);
	switch (sub) {
		case "list":
			return runList(rest, opts);
		case "clear":
			return runClear(rest, opts);
		case undefined:
		case "--help":
		case "-h":
			printHelp();
			return;
		default:
			throw new Error(`Unknown cache subcommand: ${sub}`);
	}
}

function printHelp(): void {
	process.stdout.write(
		[
			"./per-ankh admin cache <subcommand>",
			"",
			"  list [--kind K] [--match S] [--limit N]   Show cached entries",
			"  clear <stats|videos|all> [--match S]      Delete cached entries",
			"",
			"  --kind   stats | videos  (default: both)",
			"  --match  Substring filter over key names, e.g.",
			"             --match ':user:abc123:'   one user's stats bundles",
			"             --match ':playlist:'      tournament video playlists",
			"",
			"Only the stats: and videos: prefixes are reachable — session: and",
			"oauth: keys share the namespace and are never touched.",
			"",
			"The parsed-game blob cache is a separate layer and is NOT reachable",
			"here: it lives in each POP's Cache API storage, which has no CLI or",
			"purge surface. It needs no operator action — a reparse advances the",
			"game's parser_version, which drifts the cache key so every POP misses.",
			"Anything still stale expires within 24h. See cloud/src/blob-cache.ts.",
			"",
		].join("\n"),
	);
}

// Resolve the --kind flag (list) or the positional kind (clear) to the set of
// caches to operate on. `all` and an omitted --kind both mean every kind.
function resolveKinds(value: string | undefined, usage: string): CacheKind[] {
	if (value === undefined || value === "all") return KIND_NAMES;
	if ((KIND_NAMES as string[]).includes(value)) return [value as CacheKind];
	throw new Error(
		`Unknown cache kind: ${value}. Expected ${KIND_NAMES.join(" | ")} | all.\n${usage}`,
	);
}

interface CacheEntry extends KvKey {
	kind: CacheKind;
}

// List each kind's prefix and apply the --match substring filter. Mirrors the
// filtering invalidateStatsCache does in the Worker: KV can only narrow by
// prefix, so anything more specific is a client-side pass over the names.
async function collect(
	kinds: CacheKind[],
	match: string | undefined,
): Promise<CacheEntry[]> {
	const entries: CacheEntry[] = [];
	for (const kind of kinds) {
		const keys = await kvList(KINDS[kind].prefix);
		for (const k of keys) {
			if (match != null && !k.name.includes(match)) continue;
			entries.push({ ...k, kind });
		}
	}
	return entries;
}

// Clear every stats bundle — what `cache clear stats` with no --match does,
// without the prompt or the table. Exported for the reparse sweep, which
// rewrites game_player_turn across the corpus and so invalidates every bundle
// at once; it runs under its own typed confirmation and reports the count this
// returns (reparse.ts). Deliberately not reachable with a --match filter: a
// sweep's blast radius is the whole corpus, so a narrower clear would leave
// entries nothing else rebuilds.
export async function clearStatsBundles(): Promise<number> {
	const entries = await collect(["stats"], undefined);
	if (entries.length === 0) return 0;
	await kvBulkDelete(entries.map((e) => e.name));
	return entries.length;
}

function formatExpiry(expiration: number | undefined): string {
	if (expiration == null) return emdash(null);
	return formatDate(new Date(expiration * 1000).toISOString());
}

function entryNoun(n: number): string {
	return n === 1 ? "entry" : "entries";
}

async function runList(argv: string[], opts: CommandOpts): Promise<void> {
	const { flags } = parseFlags(argv);
	const usage = "Usage: ./per-ankh admin cache list [--kind K] [--match S]";
	const kinds = resolveKinds(flagString(flags, "kind"), usage);
	const match = flagString(flags, "match");
	const limit = flagInt(flags, "limit", 50);

	info(`Listing ${kinds.map((k) => KINDS[k].prefix).join(" + ")} entries...`);
	const entries = await collect(kinds, match);

	if (opts.json) {
		printJson(entries);
		return;
	}
	if (entries.length === 0) {
		warn("No cached entries found.");
		return;
	}

	const shown = entries.slice(0, limit);
	const cols: Column[] = [
		{ header: "KIND", width: 6 },
		{ header: "KEY", width: 74 },
		{ header: "EXPIRES", width: 16 },
	];
	printTable(
		cols,
		shown.map((e) => [e.kind, e.name, formatExpiry(e.expiration)]),
	);
	printCount(
		shown.length,
		shown.length < entries.length
			? `of ${entries.length} entries shown`
			: `${entryNoun(shown.length)} shown`,
	);
}

async function runClear(argv: string[], opts: CommandOpts): Promise<void> {
	const { positional, flags } = parseFlags(argv);
	const usage =
		"Usage: ./per-ankh admin cache clear <stats|videos|all> [--match S]";
	const target = positional[0];
	if (!target) {
		throw new Error(usage);
	}
	const kinds = resolveKinds(target, usage);
	const match = flagString(flags, "match");

	info(`Listing ${kinds.map((k) => KINDS[k].prefix).join(" + ")} entries...`);
	const entries = await collect(kinds, match);
	if (entries.length === 0) {
		info("Nothing to clear.");
		return;
	}

	if (!opts.yes) {
		const byKind = kinds
			.map((k) => {
				const n = entries.filter((e) => e.kind === k).length;
				return `  ${String(n).padStart(5)} ${KINDS[k].label} — ${KINDS[k].note}`;
			})
			.join("\n");
		const yes = await confirmTyping(
			`CLEAR CACHE: ${entries.length} ${entryNoun(entries.length)}` +
				`${match != null ? ` matching '${match}'` : ""}\n` +
				`${byKind}\n` +
				`  Cached data only — no session, upload, or D1 record is touched.`,
			"clear",
		);
		if (!yes) {
			info("Cancelled.");
			return;
		}
	}

	await kvBulkDelete(entries.map((e) => e.name));

	if (opts.json) {
		printJson({ deleted: entries.length, keys: entries.map((e) => e.name) });
		return;
	}
	ok(`Cleared ${entries.length} cached ${entryNoun(entries.length)}.`);
}
