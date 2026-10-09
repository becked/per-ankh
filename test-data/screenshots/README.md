# Screenshot classifier eval corpus

A local corpus of images used to pick the Clef variant and set the three threshold bands that gate screenshot uploads (issue #289, build order step 2). Like `test-data/saves/`, it is not a fixture set: nothing in the test suites reads this directory, and a fresh clone starts empty. Populate it yourself. The integration tests for the upload endpoint stub the Clef call, so they need no images either.

Git ignores everything here except this README (`.gitignore:81-82`). That is deliberate and not a convenience: the corpus is largely **other people's content** — Old World screenshots saved from Discord, and ordinary photographs — which is nobody's here to redistribute, in a public repo. The repo already declines to track even Mohawk's own assets that it legitimately bundles — `static/atlases/`, `static/sprites/` and `assets/atlas-sources/` are all gitignored, and `LICENSE` carves the first two out of the MIT grant under "Third-Party Content". Old World screenshots have a second reason: a multiplayer shot shows the other players' names on screen, the same PII that keeps the saves corpus out of git.

Nothing downstream needs the images. The eval's output is a table of per-image probabilities, and the bands derived from it are the artifact that survives; the corpus itself is never vendored. Where those two land is still open — the bands fit the wrangler-var pattern the spec already uses for its rate and read budgets, while the table and the reasoning behind the band want a doc, for which `docs/momentum-model.md` (a model fitted on a local corpus nobody else has, its numbers and provenance recorded in `docs/`) is one precedent.

## Naming

Flat directory, one prefix per class, zero-padded: `oldworld-01.png`, `photo-01.jpg`. The eval derives the expected class from the prefix, so the label travels with the file and needs no manifest referencing images nobody else has. Keep the extension the file arrived with — nothing reads it but the decoder.

| prefix | what it is | count |
| --- | --- | --- |
| `oldworld-` | Old World, any view, crops included | 15–18 |
| `photo-` | ordinary camera photographs | 8–10 |

Two classes, because of which direction each of Clef's questions runs.

**The safety questions need only legitimate images.** `contains_nsfw` and `contains_gore` set a line that legitimate content must stay *under*, so the band comes from the `oldworld-` images alone: take the highest probability any of them scores, and put the reject threshold just above it. That is an aggressive band by construction — a map screenshot should score near zero — and it is derived entirely from images that are legal to hold. The corpus never contains illicit material, which for CSAM is categorical and not a matter of convenience.

**`photo-` is the measurable proxy for the class that cannot be assembled.** `contains_nsfw` cannot be calibrated directly against the thing it screens for. But porn and CSAM are photographs, so `is_a_photograph` carries that weight using entirely ordinary content — a street, a dog, dinner, people at a table. Two are worth getting deliberately: a photo *of a screen* showing the game, which is the adversarial edge between this question and `is_old_world`, and a few with people in frame, the nearest legal analogue to what is being screened.

**`is_old_world` gets a loose band, which is why there are no other-4X images here.** It runs in the accept direction, and a threshold in that direction is not decidable from positives alone — if every legitimate image scores ≥0.92, then 0.9, 0.5 and 0.01 all fit the corpus equally. Measuring where a near-miss lands is the only thing that would separate them, and keeping Civ out of the gallery is not what this gate is for. So set it low, accept that a non-Old-World 4X screenshot may pass, and take the benefit: a loose band is what stops odd crops being refused.

Include **a combat or battle screenshot** among the `oldworld-` images. It is the one legitimate case that might score non-trivially on `contains_gore`, and the gore band has to clear whatever it scores. If nothing legitimate trips it, that band can be set very tight — but only measurement says whether that is available.

Beyond that, more map screenshots add nothing. The counts above are what they are because a band set from a *maximum* is sensitive to sample size: each new image can only push the max up, so what matters is covering content that differs — combat, an event popup, character art, an unusual palette — rather than adding more of what is already represented.

**A crop is not an outlier.** Highlighting one city's layout or a leader's stats is why someone saves a screenshot at all, so `oldworld-` is expected to hold arbitrary shapes — portrait and near-square included. Measured over the first 12 `oldworld-` images here, 5 fall outside a 1.2–2.5 aspect band, which is what removed that band from the spec's pre-filter. The surviving floor is a long edge of ~640 px, which only `oldworld-06` (502×462) fails.

## Feed Clef the variant, not the original

Classify the bytes the upload path would **store**, not the file you dropped in: downscale to 1600 px long edge capped at ~1.8 megapixels and re-encode to WebP first, the way the client does. Two reasons, and the first is a hard failure rather than a fidelity concern.

Clef's limit is 8 MiB *decoded* across the request, and this corpus blows through it: a Retina `@2x` capture at 2870×1806 decodes to 19.8 MiB and a 1868×1720 one to 12.3 MiB. 4 of the 12 `oldworld-` images here exceed that budget on their own and cannot be sent raw — so this is a hard failure, not a fidelity preference. The production cap is a pixel count rather than a long edge for the same reason one step down: 1920×1080 decodes to 7.91 MiB and squeaks under, but 1920×1200 on a 16:10 display is 8.79 MiB and over.

The second reason is that bands fitted on originals do not transfer. In production the verdict binds the stored object (issue #289, upload path item 4), so a probability measured on bytes that are never stored is a probability about a different image.

## Running it

```bash
npm run eval:screenshots -- --dry-run          # build the stored variants, print the corpus table, call nothing
npm run eval:screenshots -- --limit 2          # the first two images by filename, to check the call shape before spending on the full run
npm run eval:screenshots                       # both variants over the whole corpus
```

`scripts/eval-screenshot-classifier.ts` derives the class from the filename prefix, downscales to the stored variant, sends one image per request, and prints the per-image probabilities, the band each question's probabilities support, and what the run cost. It needs `CLOUDFLARE_ACCOUNT_ID` and a `CLOUDFLARE_AI_TOKEN` with Workers AI Read and Edit in `.env` (see `.env.example`); `--dry-run` needs neither.

The script carries the `state` and the five questions it sends. Those are as much the output of this eval as the numbers are — a band only transfers to the upload endpoint if the endpoint sends the same request — so step 3 reuses them verbatim or re-runs the eval.
