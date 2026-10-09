# Screenshot classifier eval corpus

A local corpus of images used to pick the Clef variant and set the three threshold bands that gate screenshot uploads (issue #289, build order step 2). Like `test-data/saves/`, it is not a fixture set: nothing in the test suites reads this directory, and a fresh clone starts empty. Populate it yourself. The integration tests for the upload endpoint stub the Clef call, so they need no images either.

Git ignores everything here except this README (`.gitignore:81-82`). That is deliberate and not a convenience: the corpus is mostly **other people's content** — other 4X titles' screenshots, photographs, memes — which is nobody's here to redistribute, in a public repo. The repo already declines to track even Mohawk's own assets that it legitimately bundles — `static/atlases/`, `static/sprites/` and `assets/atlas-sources/` are all gitignored, and `LICENSE` carves the first two out of the MIT grant under "Third-Party Content". Old World screenshots have a second reason: a multiplayer shot shows the other players' names on screen, the same PII that keeps the saves corpus out of git.

Nothing downstream needs the images. The eval's output is a table of per-image probabilities, and the bands derived from it are the artifact that survives — `docs/momentum-model.md` is the shape to follow, a model fitted on a local corpus nobody else has, with the numbers and the fit's provenance recorded in `docs/` rather than the corpus vendored.

## Naming

Flat directory, one prefix per expected class, zero-padded: `oldworld-01.png`, `composite-01.png`, `other4x-01.png`, `photo-01.jpg`, `meme-01.jpg`. The eval derives the expected class from the prefix, so the label travels with the file and needs no manifest referencing images nobody else has. Keep the extension the file arrived with — nothing reads it but the decoder.

| prefix | what it is | why the class exists |
| --- | --- | --- |
| `oldworld-` | Old World, any view, crops included | the true positives the gate must pass |
| `composite-` | Old World UI with something pasted into a corner | the case the allowlist cannot cover |
| `other4x-` | Civ, Humankind, Stellaris | the narrowness check on `is_old_world` |
| `photo-` | camera photographs | the only images that exercise `is_a_photograph` |
| `meme-` | image macros, reaction images, anything not a game | the easy negatives |

`composite-` is the class the eval exists for, and it is the reason two labels would not do. A composite genuinely contains the game, so it scores high on `is_old_world` — an allowlist cannot reject it — and Clef runs one pass over the whole image without localizing. Under a plain Old World / not-Old-World split its rows are indistinguishable from the true positives you want to auto-accept, which is the one confusion the eval exists to resolve. That is also why the bands are conjunctive and never compensatory.

`other4x-` is the nearest miss available: another isometric 4X with a hex map and a yield bar. A band that admits Civ admits most things.

Aim for the ~50 images the issue calls for, weighted toward `composite-` and `other4x-` rather than spread evenly — `oldworld-` and `meme-` are the easy ends of the range and settle quickly. Note that nothing here exercises `contains_gore` or `contains_nsfw`, so the eval cannot calibrate those two bands; they ship at a conservative default until something does.

**A crop is not an outlier.** Highlighting one city's layout or a leader's stats is why someone saves a screenshot at all, so `oldworld-` is expected to hold arbitrary shapes — portrait and near-square included. Measured over the 12 `oldworld-` images here, 5 fall outside a 1.2–2.5 aspect band, which is what removed that band from the spec's pre-filter. The surviving floor is a long edge of ~640 px, which only `oldworld-06` (502×462) fails.

## Feed Clef the variant, not the original

Classify the bytes the upload path would **store**, not the file you dropped in: downscale to 1600 px long edge capped at ~1.8 megapixels and re-encode to WebP first, the way the client does. Two reasons, and the first is a hard failure rather than a fidelity concern.

Clef's limit is 8 MiB *decoded* across the request, and this corpus blows through it: a Retina `@2x` capture at 2870×1806 decodes to 19.8 MiB and a 1868×1720 one to 12.3 MiB. 4 of the 12 `oldworld-` images here exceed that budget on their own and cannot be sent raw — so this is a hard failure, not a fidelity preference. The production cap is a pixel count rather than a long edge for the same reason one step down: 1920×1080 decodes to 7.91 MiB and squeaks under, but 1920×1200 on a 16:10 display is 8.79 MiB and over.

The second reason is that bands fitted on originals do not transfer. In production the verdict binds the stored object (issue #289, upload path item 4), so a probability measured on bytes that are never stored is a probability about a different image.
