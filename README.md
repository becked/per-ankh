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

**4. Configure the cloud Worker.** Bindings (D1 ids, KV ids, R2 buckets) live in the committed `cloud/wrangler.toml`. Local secrets go in `cloud/.dev.vars`, which is gitignored — copy the template and edit it:

```bash
cp cloud/.dev.vars.example cloud/.dev.vars
```

For local development you generally only need `DEV_LOGIN=1` (the template's default), which enables the Discord-free login bypass — see [Logging in locally](#logging-in-locally). `DISCORD_CLIENT_SECRET` is only required if you want to exercise real Discord OAuth locally. Wrangler reads `.dev.vars` at startup, so restart `./per-ankh dev` after editing it.

**5. Apply local D1 migrations.** There are two local databases — the main share index and the security-events store — and both need migrating:

```bash
(cd cloud && npm run migrate:local && npm run migrate:security:local)
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

### Logging in locally

The fastest way to get a session is the **dev-login bypass** — no Discord app required. It needs `DEV_LOGIN=1` in `cloud/.dev.vars` (the default in the template). With `./per-ankh dev` running, paste a URL like this into your browser:

```
http://localhost:8787/v1/auth/dev/login?discord_id=123456789&username=devuser
```

That mints a session as the given identity and redirects you back logged in. Hit it again with a different `discord_id`/`username` to switch accounts. Full details — query params, account switching, and impersonating existing users — are in [`docs/dev-login.md`](docs/dev-login.md).

To test **real Discord OAuth** instead, set `DISCORD_CLIENT_SECRET` in `cloud/.dev.vars` and register `http://localhost:1420/auth/callback` as a redirect URI on the Discord app.

### Quality checks

```bash
npm run check        # svelte-kit sync + svelte-check
npm run lint         # eslint
npm run format       # prettier --write .
```

### Cloud Admin CLI

Manage live data on Cloudflare (D1 + R2) with `./per-ankh admin`. Requires `wrangler` auth (`wrangler login`). Targets production by default; `--local` operates on the local `.wrangler` state and `--staging` on the staging environment. Run `./per-ankh admin --help` for the full command list.

Raw `wrangler` D1/KV commands (e.g. `wrangler d1 execute … --local`) must be run from **`cloud/`**, not the repo root. The repo has two configs: root `wrangler.toml` is the frontend worker (no D1/KV bindings, its own separate `.wrangler/` state), and `cloud/wrangler.toml` has the backend bindings. Run them from the root and you'll hit an empty local database and it will look broken.

### Deploying

`./per-ankh prod deploy` runs the full deploy pipeline (preflight checks → migrate → worker → frontend → smoke). `./per-ankh prod preflight` runs the safety checks without deploying. See `./per-ankh prod --help`.

`./per-ankh staging deploy` runs the same pipeline (minus the changelog/version/tag step) against the staging environment at `staging.per-ankh.app` — see `docs/cloud-deploy-plan.md` §9 for the one-time provisioning.
