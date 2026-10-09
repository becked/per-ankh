# Screenshot classifier eval corpus

A local corpus of images used to pick the Clef variant and set the three threshold bands that gate screenshot uploads (issue #289, build order step 2). Like `test-data/saves/`, it is not a fixture set: nothing in the test suites reads this directory, and a fresh clone starts empty. Populate it yourself. The integration tests for the upload endpoint stub the Clef call, so they need no images either.

Git ignores everything here except this README (`.gitignore:81-82`). That is deliberate and not a convenience: the corpus is mostly **other people's content** — other 4X titles' screenshots, photographs, memes — which is nobody's here to redistribute, in a public repo. The repo already declines to track even Mohawk's own assets that it legitimately bundles — `static/atlases/`, `static/sprites/` and `assets/atlas-sources/` are all gitignored, and `LICENSE` carves the first two out of the MIT grant under "Third-Party Content". Old World screenshots have a second reason: a multiplayer shot shows the other players' names on screen, the same PII that keeps the saves corpus out of git.

Nothing downstream needs the images. The eval's output is a table of per-image probabilities, and the bands derived from it are the artifact that survives — `docs/momentum-model.md` is the shape to follow, a model fitted on a local corpus nobody else has, with the numbers and the fit's provenance recorded in `docs/` rather than the corpus vendored.

## Layout

One subdirectory per expected class, so the class is the path rather than a manifest that references images nobody else has:

```
test-data/screenshots/
  own/         # Old World, ours — the true positives the gate must pass
  other-4x/    # Civ, Humankind, Stellaris — must fail is_old_world
  photo/       # camera photographs — is_a_photograph carries this case
  meme/        # image macros, reaction images, anything not a game at all
  composite/   # Old World UI with something pasted into a corner
```

`composite/` is the class the eval exists for. `is_old_world` is an allowlist and a composite genuinely contains the game, so it scores high; Clef runs one pass over the whole image without localizing, which is why the bands are conjunctive and never compensatory. A corpus without composites would set bands that look fine and pass exactly the images the gate was built to stop.

`other-4x/` is the narrowness check on `is_old_world`: another isometric 4X with a hex map and a yield bar is the nearest miss available, and a band that admits Civ admits most things.

Aim for the ~50 images the issue calls for, weighted toward the two classes above rather than spread evenly — `own/` and `meme/` are the easy ends of the range and settle quickly.

## Feed Clef the variant, not the original

Classify the bytes the upload path would **store**, not the file you dropped in: downscale to 1600 px long edge capped at ~1.8 megapixels and re-encode to WebP first, the way the client does. Two reasons, and the first is a hard failure rather than a fidelity concern.

Clef's limit is 8 MiB *decoded* across the request. Decoded RGBA at 3840×2160 is 33 MB and at 1920×1200 is 8.79 MiB — a raw screenshot cannot be sent at all, and the 16:10 case is what makes the production cap a pixel count rather than a long edge. And bands fitted on originals do not transfer: in production the verdict binds the stored object, so a probability measured on bytes that are never stored is measuring a different image.
