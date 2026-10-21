// `./per-ankh admin duel-event-titles` — every event story that has fired in a
// two-player multiplayer duel, with how often each one fired, swept from the
// raw saves. Feeds an event balance pass, so the counts matter as much as the
// titles: `--csv` writes a spreadsheet.
//
// SOURCE — the raw saves, not the stored blob. `story_events` only began
// shipping a game's whole history at parser 2.14.0; below that the blob carries
// the newest 100 player-scoped rows and no character- or city-scoped rows at
// all (cloud/src/schemas/game.ts). Much of the corpus predates 2.14.0, so the
// blob would answer a truncated question. The raw ZIP at saves/<game_id>.zip
// has been written on every upload since the first cloud commit (a6d637a, the
// same commit that created the games table), and the save is the authoritative
// record: each <...EventStoryTurn> container holds one child per event type
// that fired, tag name = the EVENTSTORY_* zType (docs/save-file-format.md).
//
// DUEL — map_size covers both zTypes the corpus carries: MAPSIZE_SMALLEST (the
// current name, shown in-game as "Duel") and MAPSIZE_DUEL (legacy; no longer in
// mapSize.xml). "Two-player multiplayer" is expressed as exactly two players,
// both human — that test is what actually decides it. game_mode only rules out
// the two single-player modes, so an unlisted mode (LAN is already in the
// corpus) still counts rather than being dropped unseen.
//
// Slow by nature: one wrangler spawn per save, hundreds of them. Downloads are
// cached on disk and reused, so re-running to reshape the output costs no
// further remote reads.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { XMLParser } from "fast-xml-parser";

import { d1Query, sqlStr } from "../wrangler";
import { readCachedSave } from "../saves";
import type { CommandOpts } from "../../lib/cli";
import { flagInt, flagString, parseFlags, printJson } from "../../lib/cli";
import { bold, dim, info, warn } from "../../lib/format";
import { mapLimit } from "../../lib/map-limit";
import { resolveReferenceXml } from "../../lib/paths";
import { stripMarkup } from "../../../src/lib/utils/formatting";

// Both spellings of the duel map size present in the corpus.
const DUEL_MAP_SIZES = ["MAPSIZE_SMALLEST", "MAPSIZE_DUEL"];
const SINGLE_PLAYER_MODES = ["SINGLE_PLAYER", "SINGLE_PLAYER_SIMPLE"];

const sqlList = (values: string[]): string => values.map(sqlStr).join(", ");

// A fired event is a child of a `<...EventStoryTurn>` container, named for its
// zType and holding the turn it fired on:
//   <AllEventStoryTurn><EVENTSTORY_FAMILY_GAMES>21</EVENTSTORY_FAMILY_GAMES>…
// Scoped containers prefix the tag with the target they belong to
// (`<P.0.EVENTSTORY_X>`, `<FAMILY_AMARNA.EVENTSTORY_X>`), so the entry pattern
// skips a leading prefix.
//
// Reading the containers rather than sweeping the whole save for EVENTSTORY_
// tags is what makes the counts mean something — and it keeps
// `<EventStoryTested>`, which lists events the game merely *evaluated*, out of
// a report about what fired.
const EVENT_CONTAINER = /<([A-Za-z]*EventStoryTurn)>([\s\S]*?)<\/\1>/g;
const EVENT_ENTRY = /<(?:[A-Z0-9_.]+\.)?(EVENTSTORY_[A-Z0-9_]+)>/g;

// The container that carries a player's whole fired-event history. The
// per-family/religion/tribe/player containers are breakdowns of the same
// firings and the per-character/city ones are a subset of it, so this is the
// one container a firing is guaranteed to appear in exactly once per player.
const PLAYER_CONTAINER = "AllEventStoryTurn";
// Character and city nodes both carry their records under this bare name.
const SUBJECT_CONTAINER = "EventStoryTurn";

interface GameRow {
	game_id: string;
	game_mode: string | null;
}

interface XmlEntry {
	zType?: string;
	Name?: string;
	"en-US"?: string;
}

// How often one event type fired across the swept saves. `games` is the
// dependable frequency signal; the other two say how an event distributes.
interface EventStat {
	// Games in which the event fired at least once.
	games: number;
	// Player slots that fired it — at most two per duel. A save records the
	// turn a player last saw an event, not each firing, so a repeat within one
	// player's game does not add to this.
	playerGames: number;
	// Characters and cities that carry their own record of it. Zero for a
	// purely player-scoped event; large for one that fires per character.
	characterCityRecords: number;
}

const emptyStat = (): EventStat => ({
	games: 0,
	playerGames: 0,
	characterCityRecords: 0,
});

const xmlParser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
});

async function loadEntries(path: string): Promise<XmlEntry[]> {
	const xml = await readFile(path, "utf-8");
	const parsed = xmlParser.parse(xml) as {
		Root?: { Entry?: XmlEntry | XmlEntry[] };
	};
	const entry = parsed.Root?.Entry;
	if (entry == null) return [];
	return Array.isArray(entry) ? entry : [entry];
}

// zType → English title, plus every zType the reference data defines. Titles
// resolve in two hops the same way the bake scripts do it: eventStory*.xml
// gives each event a <Name> text key, and the key is looked up in a map merged
// across every text-*.xml. The merge matters — 361 of the title keys live
// outside text-eventStoryTitle*.xml (EOTI's, for instance, sit in
// text-eventStory-eoti.xml alongside the body copy).
//
// `known` is returned alongside because a zType with no title is two different
// things: an event the data defines but leaves untitled (no <Name> at all —
// the silent setup and chain-link halves of an event, which never raise a
// titled popup), and an event absent from the current XML entirely (a mod, or
// a base-game event since removed or renamed). The report has to tell those
// apart.
//
// Titles are not unique: 359 of them are shared by more than one zType (95
// events share "{NATION-0} in the Old World"), so every row is keyed by zType
// and carries the title alongside rather than the other way round.
async function loadTitles(): Promise<{
	titles: Map<string, string>;
	known: Set<string>;
}> {
	const infosDir = resolve(resolveReferenceXml(), "Infos");
	const files = await readdir(infosDir);

	const storyFiles = files.filter((f: string) => /^eventStory.*\.xml$/.test(f));
	const textFiles = files.filter((f: string) => /^text-.*\.xml$/.test(f));

	const [storyEntries, textEntries] = await Promise.all([
		Promise.all(
			storyFiles.map((f: string) => loadEntries(resolve(infosDir, f))),
		),
		Promise.all(
			textFiles.map((f: string) => loadEntries(resolve(infosDir, f))),
		),
	]);

	const textByKey = new Map<string, string>();
	for (const entries of textEntries) {
		for (const t of entries) {
			if (t.zType && t["en-US"]) textByKey.set(t.zType, t["en-US"]);
		}
	}

	const titles = new Map<string, string>();
	const known = new Set<string>();
	for (const entries of storyEntries) {
		for (const e of entries) {
			if (!e.zType?.startsWith("EVENTSTORY_")) continue;
			known.add(e.zType);
			if (!e.Name) continue;
			const raw = textByKey.get(e.Name);
			if (!raw) continue;
			const title = stripMarkup(raw).trim();
			if (title) titles.set(e.zType, title);
		}
	}
	return { titles, known };
}

// One save's fired events. Counted per game first so that a game contributes
// at most one to each event's `games`, however many scopes recorded it.
function scanSave(xml: string): Map<string, EventStat> {
	const perGame = new Map<string, EventStat>();
	for (const container of xml.matchAll(EVENT_CONTAINER)) {
		const [, name, body] = container;
		for (const entry of body.matchAll(EVENT_ENTRY)) {
			const zType = entry[1];
			let stat = perGame.get(zType);
			if (!stat) {
				stat = emptyStat();
				stat.games = 1;
				perGame.set(zType, stat);
			}
			if (name === PLAYER_CONTAINER) stat.playerGames++;
			else if (name === SUBJECT_CONTAINER) stat.characterCityRecords++;
		}
	}
	return perGame;
}

type Status = "titled" | "untitled" | "not_in_reference";

interface ReportRow extends EventStat {
	zType: string;
	title: string;
	status: Status;
	gamePct: number;
}

function buildRows(
	stats: Map<string, EventStat>,
	titles: Map<string, string>,
	known: Set<string>,
	scanned: number,
): ReportRow[] {
	const rows: ReportRow[] = [];
	for (const [zType, stat] of stats) {
		const title = titles.get(zType);
		rows.push({
			...stat,
			zType,
			title: title ?? "",
			status: title
				? "titled"
				: known.has(zType)
					? "untitled"
					: "not_in_reference",
			gamePct: scanned > 0 ? (stat.games / scanned) * 100 : 0,
		});
	}
	// Frequency first — that is the column a balance pass reads.
	return rows.sort(
		(a, b) =>
			b.games - a.games ||
			b.playerGames - a.playerGames ||
			a.zType.localeCompare(b.zType),
	);
}

const CSV_HEADER = [
	"event_type",
	"title",
	"games",
	"pct_of_games",
	"player_games",
	"character_city_records",
	"status",
];

// RFC 4180 field/row quoting. The Worker has the same primitives in
// cloud/src/tournament/export.ts, but cloud/ is a separate package without
// `"type": "module"`, so importing them here resolves to a CJS shim with no
// named exports.
function csvField(value: string | number): string {
	const s = String(value);
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(rows: ReportRow[]): string {
	const lines = [
		CSV_HEADER.join(","),
		...rows.map((r) =>
			[
				r.zType,
				r.title,
				r.games,
				r.gamePct.toFixed(1),
				r.playerGames,
				r.characterCityRecords,
				r.status,
			]
				.map(csvField)
				.join(","),
		),
	];
	// UTF-8 BOM, CRLF rows — matching the tournament export, so a title with a
	// curly quote or an em-dash survives a spreadsheet import.
	return "﻿" + lines.join("\r\n") + "\r\n";
}

function buildReport(rows: ReportRow[], scanned: number): string {
	const titled = rows.filter((r) => r.status === "titled").length;
	const untitled = rows.filter((r) => r.status === "untitled").length;
	const unknown = rows.filter((r) => r.status === "not_in_reference").length;
	const lines: string[] = [
		"# Events fired in two-player multiplayer duels",
		"",
		`${rows.length} event types across ${scanned} games — ${titled} titled, ${untitled} untitled in the game data, ${unknown} not in the current reference data.`,
		"",
		"- **games** — duel games the event fired in at least once.",
		"- **player games** — player slots that fired it, at most two per game. A save records the turn a player last saw an event, not every firing.",
		"- **char/city** — characters and cities holding their own record of it; zero for a purely player-scoped event.",
		"- **untitled** events are defined in eventStory\\*.xml with no `<Name>` — the setup and chain-link halves of an event, which fire without raising a titled popup.",
		"- **not in reference** means the event is absent from the eventStory\\*.xml we have: a mod's event, or a base-game one removed or renamed since those games were played.",
		"",
		"Titles are as the game data writes them, so a few carry the runtime",
		"substitution slots the game fills in from the board — {CHARACTER-SHORT-0},",
		"{CITY-0}, {G1:Man:Woman}.",
		"",
		"| Event | Title | Games | % | Player games | Char/city | Status |",
		"| --- | --- | ---: | ---: | ---: | ---: | --- |",
		...rows.map(
			(r) =>
				`| \`${r.zType}\` | ${r.title || "—"} | ${r.games} | ${r.gamePct.toFixed(1)}% | ${r.playerGames} | ${r.characterCityRecords} | ${r.status} |`,
		),
	];
	return lines.join("\n") + "\n";
}

export async function run(args: string[], opts: CommandOpts): Promise<void> {
	const { flags } = parseFlags(args);
	const concurrency = flagInt(flags, "concurrency", 6);
	const outPath = flagString(flags, "out");
	const asCsv = flags.csv !== undefined;
	const cacheDir = resolve(
		flagString(flags, "cache-dir") ?? resolve(tmpdir(), "per-ankh-duel-saves"),
	);
	await mkdir(cacheDir, { recursive: true });

	const games = await d1Query<GameRow>(
		`SELECT g.game_id, g.game_mode
		   FROM games g
		   JOIN player_summaries p ON p.game_id = g.game_id
		  WHERE g.map_size IN (${sqlList(DUEL_MAP_SIZES)})
		    AND COALESCE(g.game_mode, '') NOT IN (${sqlList(SINGLE_PLAYER_MODES)})
		  GROUP BY g.game_id
		 HAVING COUNT(*) = 2 AND SUM(p.is_human) = 2
		  ORDER BY g.game_id`,
	);
	if (games.length === 0) {
		warn("No two-player multiplayer duels matched.");
		return;
	}

	const byMode = new Map<string, number>();
	for (const g of games) {
		const mode = g.game_mode ?? "(null)";
		byMode.set(mode, (byMode.get(mode) ?? 0) + 1);
	}
	info(
		`${games.length} games matched — ` +
			[...byMode]
				.sort((a, b) => b[1] - a[1])
				.map(([mode, n]) => `${mode} ${n}`)
				.join(", "),
	);
	info(`Reading saves (${concurrency} at a time), cache: ${cacheDir}`);

	const stats = new Map<string, EventStat>();
	const missing: string[] = [];
	const failed: Array<{ game_id: string; error: string }> = [];
	let scanned = 0;

	await mapLimit(games, concurrency, async (game, i) => {
		try {
			const save = await readCachedSave(game.game_id, cacheDir);
			if (!save) {
				missing.push(game.game_id);
				return;
			}
			for (const [zType, stat] of scanSave(save.xml)) {
				const agg = stats.get(zType) ?? emptyStat();
				agg.games += stat.games;
				agg.playerGames += stat.playerGames;
				agg.characterCityRecords += stat.characterCityRecords;
				stats.set(zType, agg);
			}
			scanned++;
		} catch (e) {
			failed.push({ game_id: game.game_id, error: String(e) });
		}
		if ((i + 1) % 25 === 0) info(`  …${i + 1}/${games.length}`);
	});

	const { titles, known } = await loadTitles();
	const rows = buildRows(stats, titles, known, scanned);

	for (const f of failed) warn(`${f.game_id}: ${f.error}`);
	if (missing.length > 0) {
		warn(`${missing.length} save(s) had no object in R2`);
	}

	const document = asCsv ? buildCsv(rows) : buildReport(rows, scanned);
	if (outPath) {
		await writeFile(resolve(outPath), document, "utf-8");
		info(`Wrote ${resolve(outPath)}`);
	}

	if (opts.json) {
		printJson({
			games_matched: games.length,
			scanned,
			missing,
			failed,
			event_types: rows.length,
			events: rows.map((r) => ({
				event_type: r.zType,
				title: r.title,
				games: r.games,
				pct_of_games: Number(r.gamePct.toFixed(1)),
				player_games: r.playerGames,
				character_city_records: r.characterCityRecords,
				status: r.status,
			})),
		});
		return;
	}

	if (outPath) {
		const titled = rows.filter((r) => r.status === "titled").length;
		process.stdout.write(
			`\n${bold(`${rows.length} event types`)} across ${scanned} games\n` +
				`${dim(`titled ${titled}, untitled ${rows.filter((r) => r.status === "untitled").length}, not in reference ${rows.filter((r) => r.status === "not_in_reference").length}`)}\n`,
		);
		return;
	}
	process.stdout.write(document);
}
