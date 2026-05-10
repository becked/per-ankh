# Per-Ankh

Web analytics for [Old World](https://store.steampowered.com/app/597180/Old_World/) save files. Live at <https://per-ankh.app>.

## Overview

Per-Ankh ingests Old World save files in the browser, persists them to Cloudflare (D1 + R2), and presents data visualizations and analytics on a per-game basis. Save files are parsed client-side; only the structured per-game data is uploaded.

## Final desktop release

Per-Ankh started as a Tauri desktop app. The last desktop release is preserved as a GitHub Release at [`v0.2.0`](https://github.com/becked/per-ankh/releases/tag/v0.2.0). It receives no further updates, including no security patches. To use your saves on the web app, re-upload them at <https://per-ankh.app/upload>.

## Legal Notice

Per-Ankh is an independent, unofficial fan project. It is not affiliated with, endorsed by, sponsored by, or connected to Mohawk Games, Hooded Horse, or any of their affiliates.

"Old World" is a trademark of Mohawk Games. Mohawk Games holds the copyright in _Old World_ and all of its visual assets, save file formats, and game data.

Per-Ankh's source code is licensed under the MIT License (see [LICENSE](LICENSE)). The visual assets bundled under `static/atlases/` and `static/sprites/` are derived from _Old World_ and remain the property of Mohawk Games — they are **not** covered by the MIT License and are included solely as build artifacts to support analysis of save files from games the end user legally owns. See the "Third-Party Content" section of [LICENSE](LICENSE) for details.

This software is provided "as is" without warranty of any kind.

## Architecture

- **Frontend:** SvelteKit + TypeScript, deployed to Cloudflare via `@sveltejs/adapter-cloudflare`. Source under `src/`.
- **API Worker:** Cloudflare Worker under `cloud/`. Talks to D1 (relational metadata), R2 (raw save ZIPs + parsed game blobs), and KV (sessions).
- **Parser:** TypeScript port of the original Rust parser. Runs in a Web Worker on the upload page.
- **Legacy share viewer:** static SvelteKit app under `web/`, serves `per-ankh.app/share/[id]` for share links created by the desktop app. Frozen, deployed alongside the main app.

## Development

### Setup

After cloning:

**1. Install dependencies (root + cloud Worker):**

```bash
npm install
(cd cloud && npm install)
```

**2. Configure asset paths.** The visual assets under `static/atlases/` and `static/sprites/` are derived from _Old World_ and are not committed to git (see [LICENSE](LICENSE) "Third-Party Content"). They're regenerated locally from your own [pinacotheca](https://github.com/becked/pinacotheca) checkout and Old World install.

You'll need:

- A pinacotheca checkout (anywhere on disk).
- An Old World install (the `bake:improvements` step reads its reference XML).

Copy `.env.example` to `.env` and fill in absolute paths:

```bash
cp .env.example .env
```

- `PINACOTHECA_DIR` — your pinacotheca checkout root.
- `OLD_WORLD_REFERENCE_DIR` — directory containing an `XML/` subdir (typically your Old World install). Only required by `bake:improvements`.

Both env vars fall back to relative-path candidates if unset, but the env-var path is recommended on Windows since it sidesteps symlink-permission concerns.

**3. Bake the assets:**

```bash
npm run bake:all
```

This populates `static/atlases/` and `static/sprites/` from your pinacotheca checkout. Re-run any time pinacotheca refreshes its renders.

**4. Configure the cloud Worker:** see `cloud/wrangler.toml` and `cloud/.dev.vars` (D1 ids, KV ids, `DISCORD_CLIENT_SECRET`, etc.). Apply local D1 migrations:

```bash
(cd cloud && npm run migrate:local)
```

### Running locally

The repo's `./per-ankh` shim runs the SvelteKit dev server and the cloud Worker side by side:

```bash
./per-ankh dev
```

Or run them separately:

```bash
npm run dev                      # SvelteKit dev server (port 1420)
(cd cloud && npm run dev)        # Wrangler dev (port 8787)
```

### Quality checks

```bash
npm run check        # svelte-kit sync + svelte-check
npm run lint         # eslint
npm run format       # prettier --write .
```

### Cloud Admin CLI

Manage live data on Cloudflare (D1 + R2) with `./per-ankh admin`. Requires `wrangler` auth (`wrangler login`). Run `./per-ankh admin --help` for the full command list.
