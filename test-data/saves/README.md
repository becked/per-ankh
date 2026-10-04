# Test save files

A local corpus of real Old World saves, used to check a parser or derivation change against real data before claiming anything about what saves contain. It is not a fixture set: nothing in the test suites reads this directory, and a fresh clone starts empty. Populate it yourself — and note that a git worktree is its own checkout, so a session working under `.claude/worktrees/` starts with neither this corpus nor the gitignored `/Reference` symlink even when both sit in the primary checkout beside it. (`scripts/lib/paths.ts` resolves the worktree layout for `Reference/XML`; nothing does for the saves.)

It exists because the repo's expensive bugs have been claims about the data that nobody measured — a flag read under an element name the game never writes, a name join that matched every player because single-player saves leave the name empty, a band printed as a point estimate. Each was answered by running the change across a dozen real saves and counting. Keep enough saves here to make that cheap, and pick them for the cases that have actually caught bugs: a single-player save (every player's name is empty), a multiplayer duel, a game with more than two nations, a realm that was eliminated mid-game, a city that changed hands, and a spread of game versions.

## Getting saves

Copy them out of your **user data** folder, not the game install — `~/.local/share/OldWorld/Saves/` on Linux, `~/Library/Application Support/OldWorld/Saves/` on macOS (`docs/cloud-rewrite-spec.md` records the macOS path; Windows differs again). Completed games are in that folder's `Completed/` subdirectory, which is the only kind worth taking: `validateCompletedGame` rejects a save without `<Game><GameOver/>`, so an in-progress save fails the upload with `NOT_COMPLETED` (a game that ended without a recorded winner is fine — those pre-date v1.0.62443 and import with the winner and victory-type cards both showing `-`). Age is otherwise no obstacle, and old saves are the point: `docs/save-file-format.md` documents per-event-type retention and temporal fidelity measured across a corpus spanning v1.0.62443 to v1.0.83591.

Git ignores everything here except this README, `.gitkeep`, and `sample.xml` (`.gitignore:71-74`), so saves — which carry other players' names and Steam ids — cannot be committed by accident. Nothing reads `sample.xml`; don't give a real save that name.

## What a save is

A ZIP archive containing a single XML file (`docs/save-file-format.md` is the authority on its contents). Read one without unpacking it:

```bash
unzip -l test-data/saves/OW-Maurya-Year111-*.zip          # list the entry
unzip -p test-data/saves/OW-Maurya-Year111-*.zip '*.xml' > /tmp/save.xml
```

`src/lib/parser/extract-zip.ts` enforces the limits the app will apply to the same file: 50 MB compressed, 100 MB uncompressed, at most 10 entries, and a compression ratio under 100.

## Exercising the parser on one

The app runs the parser in the browser, in a Web Worker (`src/lib/parser/worker.ts`): ZIP extraction, then XML parse, then the orchestrator in `src/lib/parser/parsers/index.ts` that assembles the `FullGameData` blob. Nothing in that chain is browser-bound, though — `extract-zip.ts` takes a plain `ArrayBuffer` and the only dependencies are `fflate` and `fast-xml-parser` — so it also runs headless under `tsx` (a devDependency; every `bake:*` script invokes it the same way), which is what makes "across a dozen saves" a loop rather than a dozen interactive uploads:

```ts
// scratch/parse-corpus.ts — npx tsx scratch/parse-corpus.ts test-data/saves/*.zip
import { readFileSync } from "node:fs";
import { extractXmlFromZip } from "../src/lib/parser/extract-zip.js";
import { parseSaveXml, parseActivePlayerIndex } from "../src/lib/parser/parse-xml.js";
import { extractAllGameData } from "../src/lib/parser/parsers/index.js";
import { validateCompletedGame } from "../src/lib/parser/validation.js";

for (const file of process.argv.slice(2)) {
	const { xml, entryName } = extractXmlFromZip(
		readFileSync(file).buffer as ArrayBuffer,
	);
	const data = extractAllGameData(
		parseSaveXml(xml),
		parseActivePlayerIndex(xml),
		entryName,
	);
	validateCompletedGame(data);
	// … then count whatever the claim is about.
}
```

Going through the running app — `./per-ankh dev`, then the upload flow, with `docs/dev-login.md` for a session without Discord — is the way to exercise the *upload* path end to end (D1 rows, R2 objects, the share blob). Prefer the headless loop when the question is only what the parser makes of a save: it writes nothing into your local D1, which on a machine whose local state is a restored snapshot is also a measurement source.

Reading the XML directly (above) answers a different and often better question: what the *game* wrote, as opposed to what our parser makes of it. `docs/save-file-format.md` says as much — tier and retention questions get answered from a save, not from `src/lib/parser/` and not from this doc.
