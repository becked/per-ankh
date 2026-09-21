# Test save files

A local corpus of real Old World saves, used to check a parser or derivation change against real data before claiming anything about what saves contain. It is not a fixture set: nothing in the test suites reads this directory, and a fresh clone starts empty. Populate it yourself.

It exists because the repo's expensive bugs have been claims about the data that nobody measured — a flag read under an element name the game never writes, a name join that matched every player because single-player saves leave the name empty, a band printed as a point estimate. Each was answered by running the change across a dozen real saves and counting. Keep enough saves here to make that cheap, and pick them for the cases that have actually caught bugs: a single-player save (every player's name is empty), a multiplayer duel, a game with more than two nations, a realm that was eliminated mid-game, a city that changed hands, and a spread of game versions.

## Getting saves

Copy them out of an Old World install's save directory. It has to be a **completed** game: `validateCompletedGame` rejects a save without `<Game><GameOver/>`, so an in-progress save fails the upload with `NOT_COMPLETED` (a game that ended without a recorded winner is fine — those pre-date v1.0.62443 and surface as "Ended"). Age is otherwise no obstacle, and old saves are the point: `docs/save-file-format.md` documents per-event-type retention and temporal fidelity measured across a corpus spanning v1.0.62443 to v1.0.83591.

Git ignores everything here except this README and `.gitkeep`, so saves — which carry other players' names and Steam ids — cannot be committed by accident.

## What a save is

A ZIP archive containing a single XML file (`docs/save-file-format.md` is the authority on its contents). Read one without unpacking it:

```bash
unzip -l test-data/saves/OW-Persia-Year69-*.zip          # list the entry
unzip -p test-data/saves/OW-Persia-Year69-*.zip '*.xml' > /tmp/save.xml
```

`src/lib/parser/extract-zip.ts` enforces the limits the app will apply to the same file: 50 MB compressed, 100 MB uncompressed, at most 10 entries, and a compression ratio under 100.

## Exercising the parser on one

The parser runs in the browser, in a Web Worker (`src/lib/parser/worker.ts`): ZIP extraction, then XML parse, then the orchestrator in `src/lib/parser/parsers/index.ts` that assembles the `FullGameData` blob. So the way to run a save through it is to upload the save to the local app — `./per-ankh dev`, then the upload flow, with `docs/dev-login.md` for a session without Discord.

Reading the XML directly (above) answers a different and often better question: what the *game* wrote, as opposed to what our parser makes of it. `docs/save-file-format.md` says as much — tier and retention questions get answered from a save, not from `src/lib/parser/` and not from this doc.
