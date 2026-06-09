# Building Per-Ankh for Speed

*How we made a save-file analyzer feel instant — June 2026*

[Per-Ankh](https://per-ankh.app) parses Old World save files and turns them into
interactive charts, standings, and a zoomable hex-tile map. A single save is a
ZIP full of XML; a finished game can be thousands of turns of per-player yield
history plus a full map snapshot. Rendering all of that should feel heavy. It
doesn't — pages paint fast, the map pans at 60fps, and uploads chew through a
batch of saves without locking the tab.

None of that comes from a clever framework or a magic cache. It comes from one
decision made early and applied everywhere: **match the architecture to the
workload.** Per-Ankh's data is overwhelmingly *read*, almost never *mutated*,
and immutable once parsed. Every performance choice below falls out of taking
that seriously. Here's the technical breakdown.

## 1. Parse in the browser, off the main thread

A save file is opaque until it's parsed, and parsing is the single most
expensive thing the app does. We do it on the client, in a Web Worker
(`src/lib/parser/worker.ts`), so the main thread — the one painting the UI and
handling input — never stalls.

The worker runs a three-stage pipeline: unzip the archive, parse the XML, and
extract the structured game model. It streams `progress` messages back as it
goes (`{ phase, percent }`), so the upload modal shows a live progress bar
instead of a frozen spinner. The final result comes back as a transferable
buffer — no structured-clone copy of a multi-megabyte object across the worker
boundary.

Doing the work client-side also means our API Worker never spends CPU parsing.
The server's job is storage and metadata, not computation.

## 2. Bound memory during bulk uploads: gzip-and-drop

Users routinely drag in a whole folder of saves at once. Naively holding every
parsed game object in memory while the batch uploads would balloon the tab's
heap.

So the moment a file parses, we **gzip the parsed JSON to a `Blob` and throw
away the live JavaScript object** (`src/lib/BulkUploadModal.svelte`). Only two
things stay resident per file: the raw ZIP bytes and the compressed blob. Memory
stays flat no matter how big the batch, and the bytes we're holding are already
in the exact shape we're about to upload.

## 3. Store once, store compressed, never recompute

Parsed game data is immutable — a save's history doesn't change. We lean on that
all the way down the stack.

On upload, the client sends the raw ZIP plus the gzipped JSON. The API Worker
writes **both straight to R2 with `contentEncoding: "gzip"`** and records only
the relational metadata in D1. The blob is stored compressed and served
compressed; there's no decompress-recompress dance on the hot path, and the
bytes the browser caches are the bytes R2 holds.

Reads are deliberately boring. The Worker fetches the gzipped blob, applies a
thin per-viewer transform (strip `online_id` PII for anonymous viewers, inject
the owner's visibility flag and uploader identity), and returns it. Raw-save
downloads skip even that — the R2 body streams straight through the Worker as a
`ReadableStream`, so a 50MB save never buffers in Worker memory.

Storage split:

- **R2** — gzipped game blobs + raw save ZIPs (the big, immutable bytes)
- **D1** — relational metadata (the small, queryable fields)
- **KV** — sessions, and one expensive cache (see §6)

## 4. Render at the edge, server-first

The whole app deploys to Cloudflare Workers via `@sveltejs/adapter-cloudflare`,
and it's **server-rendered by default**. That's not an SEO checkbox — it's a
first-paint strategy. The first response a visitor gets is real HTML with real
content, rendered at the edge close to them, not an empty shell that has to boot
a JavaScript bundle before it can show anything.

SSR also makes share links work: a public game URL ships server-rendered
`og:*`/Twitter-card meta tags, so pasting a link into Discord or Slack unfurls a
proper preview card. After that first paint, SvelteKit takes over client-side and
subsequent navigations are SPA-style — no full reloads. We get the fast cold
start of server rendering and the snappy in-session feel of a single-page app.

A small but real touch: `<body data-sveltekit-preload-data="hover">` tells
SvelteKit to start loading a page's data the instant you *hover* a link, not when
you click it. By the time the click lands, the request is often already in
flight.

## 5. Cache aggressively where data can't change, not at all where it can

Caching is only safe when you're honest about what's immutable. We tier it:

**Static assets — cache forever.** Every baked atlas, sprite, and the SvelteKit
app bundle is *content-hashed* — the file's hash is part of its name. A new build
produces new filenames, so old URLs can never go stale. We serve them with
`Cache-Control: public, max-age=31536000, immutable` (`_headers`), and
adapter-cloudflare adds the same rule for `/_app/immutable/*`. Returning visitors
re-download nothing.

**Game blobs — cache by audience.** The read response tunes its `Cache-Control`
to who's asking (`cloud/src/games.ts`):

- *Owners* get `private, no-store`. An owner who just toggled visibility or
  re-imported a save must see fresh data immediately, so we never cache their
  view.
- *Public viewers* get `public, max-age=3600, s-maxage=60` — cached an hour in
  the browser but only 60 seconds at the edge. The short edge TTL means a "Make
  Private" toggle propagates within about a minute instead of being pinned on the
  CDN for an hour.

The response also sets `Vary: Cookie, Origin` so the edge never hands a
logged-out scraper's cached copy to a logged-in owner, or reuses a
credentialed-CORS response across origins. Correctness first, then hit rate.

## 6. Cache the one expensive computation server-side

Most reads are cheap blob fetches. The exception is aggregate **stats** —
win rates, nation breakdowns, head-to-heads — which require real SQL over a
user's whole game history. We don't recompute those on every page view.

The Worker memoizes each computed stats bundle in **KV with a 24-hour TTL**
(`cloud/src/stats/cache.ts`), keyed by user, viewer scope (owner vs. public), and
filter selection. A cache miss recomputes from D1 and writes the result; every
read after that is a KV hit. When the underlying games change — upload,
re-import, delete — we explicitly invalidate that user's stats keys, so the cache
is never wrong, just warm.

## 7. Keep heavy code off the critical path

The two heaviest things we ship are the charting library (Apache ECharts) and the
WebGL map renderer (deck.gl). Neither belongs on the home page.

SvelteKit's route-level code splitting handles this for free: ECharts and deck.gl
are imported only by the components that live on the game-detail and stats
routes, so they land in chunks that *only those routes* download. A visitor
landing on the home page or a tournament bracket never pays for them. The parser
Web Worker is likewise instantiated lazily — only when the upload modal actually
opens — not eagerly at startup.

## 8. A WebGL map fed by pre-baked atlases

The hex-tile map (`src/lib/SpriteMap.svelte`) renders on the GPU via deck.gl —
icon, path, and polygon layers compositing terrain, rivers, borders, cities, and
units. Sprites don't come from dozens of individual image requests; they come
from a handful of **texture atlases baked offline** from source art and packed by
hand-tuned hex geometry.

Those atlases are content-hashed like everything else and resolved at runtime
through a generated manifest, so the map gets the cache-forever treatment from §5
while staying trivially updatable: re-bake, ship new hashes, done. The bake is
deterministic — same inputs, byte-identical outputs — so it never churns the
build.

## 9. Optimistic exactly where it pays

We use optimistic UI in precisely one place: the public/private visibility
toggle. Flip the switch and the UI updates instantly; the server round-trip
happens in the background and rolls the toggle back only if it fails
(`src/lib/GameActions.svelte`). It's the one mutation frequent and trivial enough
that waiting would feel wrong.

Everything else — rename, move-to-collection, re-import, delete — is pessimistic
on purpose. These are rare, deliberate actions where confirming the server
succeeded matters more than shaving a few hundred milliseconds. We didn't build a
client-side mutation queue or a sync engine, because our workload doesn't have
the high-frequency, conflict-prone writes that would justify one. (See "what we
deliberately left out," below.)

## What we deliberately left out

Good performance work is as much about what you *don't* build. A few things we
considered and skipped, because our workload doesn't ask for them:

- **A local-first client database.** Tools built around constant editing of a
  bounded dataset benefit from mirroring the whole thing into the browser and
  syncing deltas. Per-Ankh's data is unbounded (you can't preload "all games")
  and immutable once written — there's nothing to keep in sync. SSR plus tiered
  HTTP caching covers the realistic "click into a game, hit back" path without a
  bespoke store to keep coherent.
- **A service worker / offline mode.** We're a read-mostly analysis tool behind
  auth. Offline editing has no use case, and a precache manifest would be
  complexity we'd have to maintain for no felt benefit.
- **Real-time sync (WebSockets/SSE).** Nothing in the model needs sub-second
  collaborative updates.

Each of these is genuinely the right call *for some app* — just not this one.
The discipline is refusing to import another product's architecture along with
its ideas.

## What we're still sharpening

Performance is never finished. A few tracked improvements in flight:

- Import ECharts modularly instead of pulling the whole library, to trim the
  analysis-route bundle ([#66](https://github.com/becked/per-ankh/issues/66)).
- Replace blanket `invalidateAll()` after mutations with scoped invalidation, so
  editing a game stops re-fetching unrelated header chrome
  ([#67](https://github.com/becked/per-ankh/issues/67)).
- Parallelize the independent fetches on the game-detail load
  ([#68](https://github.com/becked/per-ankh/issues/68)).

## The throughline

Parse on the client, store immutable and compressed, render at the edge, cache by
how mutable each thing actually is, and keep the heavy code off the paths most
people walk. None of it is exotic. It's just the same question asked at every
layer — *what does this workload actually need?* — and the discipline to not
build the parts it doesn't.
