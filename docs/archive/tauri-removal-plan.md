# Tauri Removal — Implementation Plan

> **⚠️ Historical — archived 2026-06-30.** A completed migration plan — the Tauri/Rust removal is done. Superseded by `CLAUDE.md` for the current single cloud build. Audit: [`doc-audit-2026-06-30`](../doc-audit-2026-06-30.md).

Replaces Phase F + G of [`cloud-productionization-plan.md`](./cloud-productionization-plan.md). The user has decided not to wait for a bake window before pulling out Tauri — we move to Cloudflare and fix issues as they surface.

## Goals

- Delete all Tauri runtime code and Rust source from this branch.
- Collapse the dual-build (`BUILD_TARGET=tauri|cloud`) into a single cloud build.
- Leave the legacy share system **completely untouched**: `web/` (legacy share viewer), `cloud/src/index.ts` `/v1/share/*` endpoints, and existing R2 share blobs all stay. Old `per-ankh.app/share/[id]` URLs continue to work.
- v0.2.0 GitHub Release is the desktop-final artifact — no new tag needed.

## Out of scope

- Repurposing `release.yml` as a cloud-deploy workflow (separate effort).
- Migrating `web/` into the cloud SvelteKit app.
- Pruning `src/lib/types/` — preserved because `web/src/lib/types` symlinks into it (`web/src/lib/api-web.ts` imports many `$lib/types/*` types). The directory becomes frozen-by-hand instead of auto-generated; that's fine because the legacy share schema it describes is also frozen.

## Constraint summary (verified during exploration)

- `src/lib/types/` has consumers only in (a) Tauri-bound `src/lib/*` files we're deleting and (b) `web/` which we keep. Therefore: delete `src/lib/types.ts` (the index re-exporter, only consumer was `GameSidebar.svelte`); preserve `src/lib/types/` directory.
- `web/src/lib/` symlinks into `src/lib/` for: `types`, `config`, `game-detail`, `generated`, `HexMap.svelte`, `SpriteMap.svelte`, `MapTooltip.svelte`, `SearchInput.svelte`, `Chart.svelte`, `ChartContainer.svelte`, `GamePageSkeleton.svelte`, `AboutDisclaimer.svelte`. None of these are slated for deletion.
- `Reference/` symlink stays — it's used by `scripts/bake-improvements.ts` and `scripts/lib/paths.ts` to read XML from the local OW install.
- 10 files actually import from `@tauri-apps/*` (verified via grep): `Header.svelte`, `UpdateModal.svelte`, `api.ts`, `utils/dialogs.ts`, `utils/updater.ts`, `stores/update.ts`, `event-test/+page.svelte` — all in the delete set.
- `__BUILD_TARGET__` switch sites: `app.d.ts`, `+layout.ts`, `+layout.svelte`, `+page.svelte`, plus `vite.config.js`, `svelte.config.js`, `scripts/per-ankh.ts` (one comment + one env passthrough).

## Phased commits

Branch: `cloud-rewrite` (current). Each commit leaves the cloud build green and bisectable.

---

### Commit 1 — `chore: drop parity harness and Tauri dev scripts`

Independent dev-side cleanup; no runtime change.

**Delete:**

- `scripts/parity/` (entire directory; harness compares TS parser output to Rust `dump_parsed` binary, which lives in `src-tauri/`)
- `scripts/hooks/pre-commit` (regenerates Rust→TS types via `cargo test --lib export_bindings`)
- `scripts/hooks/` (empty after pre-commit removal)
- `dev.sh` (272-line shell script — Tauri dev server manager; comment at top of `scripts/per-ankh.ts` explicitly marks it "decommissioning")
- `tauri.sh` (508-line Tauri development helper)

**Edit:**

- `package.json`: remove these scripts: `parity:smoke`, `parity:full`, `parity:self-check`, `parity:share`, `parity:share:full`
- `.gitignore`: remove `scripts/parity/reports/`
- `scripts/per-ankh.ts:6-7`: drop the "Coexists with `dev.sh` (Tauri, decommissioning) and …" comment block

**Verify:**

- `npm run check` passes
- `npm run dev:cloud` still starts the dev server cleanly
- `git grep -E 'parity|dev\.sh|tauri\.sh'` returns only doc references (handled in Commit 4)

---

### Commit 2 — `feat(cloud): remove Tauri runtime`

The load-bearing change. Deletes Tauri-bound frontend, the Rust crate, and collapses the build-target switches.

**Frontend deletes (all `@tauri-apps/*`-importing or `api.ts`-importing files):**

- `src/lib/api.ts`
- `src/lib/types.ts` (index re-exporter; _not_ the `types/` directory)
- `src/lib/Header.svelte`
- `src/lib/GameSidebar.svelte`
- `src/lib/UpdateModal.svelte`
- `src/lib/ShareControl.svelte`
- `src/lib/SettingsModal.svelte`
- `src/lib/CollectionsModal.svelte`
- `src/lib/ImportModal.svelte`
- `src/lib/desktop/` (entire dir — `HomeDashboard.svelte`)
- `src/lib/utils/dialogs.ts`
- `src/lib/utils/updater.ts`
- `src/lib/stores/update.ts`
- `src/routes/game/[id]/` (Tauri-only desktop game detail; _not_ `/games/[id]/`)
- `src/routes/event-test/`
- `src/routes/debug-nations/`

**Frontend simplifications:**

- `src/routes/+layout.svelte`: drop the `isCloudRoute` derivation, the Tauri branch, and the `Header`/`GameSidebar`/`UpdateModal` imports. Layout collapses to: cloud header on every route except `/`, `/login`, `/auth/*` (which already use `showCloudHeader`'s false branch).
- `src/routes/+layout.ts`: drop `export const ssr = __BUILD_TARGET__ === "cloud"` (just `export const ssr = true`); drop the `if (__BUILD_TARGET__ !== "cloud") return { user: null };` early return.
- `src/routes/+page.svelte`: drop the `__BUILD_TARGET__ === "cloud"` branch — the landing page becomes unconditionally the cloud landing.
- `src/app.d.ts`: drop the `declare const __BUILD_TARGET__` block.

**Native crate:**

- Delete `src-tauri/` (entire directory)
- Delete `app-icon.png`, `app-icon-original.png` at repo root if grep confirms they're Tauri-only (Tauri bundle source). If `static/` already has its own favicon set, these go.

**Build config:**

- `vite.config.js`: remove `TAURI_DEV_HOST`, `BUILD_TARGET`, the `define` block, and the Tauri-specific `server` block (port 1420 strict, watch-ignore on `src-tauri/`). Restore minimal SvelteKit vite config.
- `svelte.config.js`: drop `staticAdapter` import and the adapter-switch ternary. Always use `cloudflareAdapter({})`. Always apply the CSP config (no longer gated on `target === "cloud"`).

**`package.json`:**

- Drop dependencies: `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-opener`, `@tauri-apps/plugin-process`, `@tauri-apps/plugin-updater`
- Drop devDependencies: `@tauri-apps/cli`, `@sveltejs/adapter-static`
- Drop scripts: `tauri`, `tauri:dev`, `tauri:build`, `types:generate`, `build:tauri`
- Rename scripts: `dev:cloud` → `dev`, `build:cloud` → `build` (drop the now-redundant `:cloud` suffix; also remove the existing `dev` / `build` entries that defaulted to Tauri)
- Run `npm install` to regenerate `package-lock.json`

**`.gitignore`:**

- Remove the "Rust / Cargo" block (`/src-tauri/target/`, `**/target/`, `**/*.rs.bk`, `*.pdb`, `/src-tauri/.cargo/config.toml`)
- Remove the "Tauri Build Outputs" block (`/src-tauri/target/`, `/src-tauri/WixTools/`, `/src-tauri/gen/`)
- Remove the "Tauri Signing Keys" block (`.tauri-signing-key`, `.tauri-signing-key.pub`)
- Keep `Reference` (still used by bake scripts)
- Keep `.wrangler/`, `.svelte-kit`, `node_modules`, etc. — all unaffected

**`scripts/per-ankh.ts`:**

- `:98`: the `BUILD_TARGET=cloud` env passthrough on the dev spawn becomes redundant once vite always defaults to cloud — drop it.
- `:83`: same comment cleanup.

**Verify (must all pass before commit):**

- `npm run check` (svelte-check, type-check)
- `npm run lint`
- `npm run dev` — server starts; visit `/`, `/login`, `/dashboard`, `/upload`, `/games`, `/games/[id]` (an existing game), `/account`. No console errors.
- `npm run build` — cloud build artifact appears in `build/`
- `cd cloud && npm test` — Worker tests still pass
- `cd web && npm run check` — legacy share viewer still type-checks (since its symlinks resolve back through `src/lib/types`, `src/lib/game-detail`, etc., which we preserved)
- `git grep -in '@tauri-apps\|invoke(' src/ static/ scripts/` — should return zero hits
- `git grep -in 'tauri' src/ static/ scripts/` — should return only comment-form references in `src/lib/parser/parsers/*.ts` (provenance comments like "Direct port of `src-tauri/src/parser/parsers/cities.rs`"). These are kept as historical attribution; harmless.

If grep finds a stray import: fix in this commit, don't merge a half-removed state.

---

### Commit 3 — `chore: drop Tauri release workflow`

**Delete:**

- `.github/workflows/release.yml` (entirely Tauri-bound: rust toolchain, libwebkit2gtk, swatinem/rust-cache pointing at `./src-tauri`, Apple codesigning for Tauri bundles, `tauri-action`)

**Effect:** Future `v*` tags no longer trigger any workflow. v0.2.0's `latest.json` remains the auto-updater's reply for existing desktop installs as long as v0.2.0 stays GitHub's "Latest" release.

**Side note (no code change required):** if a future `v*` tag is cut for a cloud release and GitHub auto-marks it "Latest", `releases/latest/download/latest.json` returns 404, and existing v0.2.0 desktop installs see a network error — Tauri's updater treats that as "no update available" and stays quiet. Acceptable failure mode for a handful of users.

**Verify:**

- `gh workflow list` no longer shows "Release"
- Pushing the eventual merge commit doesn't trigger any failed workflow run

---

### Commit 4 — `docs: rewrite project docs for cloud-only`

Can be a single commit or split per-doc; review focus is per-file regardless. Doing all docs in one commit is fine given the user's "no ceremony" framing.

**`CLAUDE.md`** — substantial rewrite. Currently ~80% Tauri-specific. Sections to delete or rewrite:

- "⚠️ Tauri Desktop Environment - NOT a Web Browser" — DELETE
- "Tauri Built-ins vs Web APIs" — DELETE
- "Rust Standards" — DELETE
- "Backend: SQL Query Safety / Error Context / DuckDB / Schema Migrations" — DELETE (the cloud Worker uses D1, not DuckDB; if any cloud guidance is worth preserving here, write fresh)
- "Initial Setup" + "Running the Application" + Tauri build commands — REWRITE for `npm run dev` / Wrangler dev
- "Frontend: API Layer" — REWRITE around `api-cloud.ts`
- "Player Identity & Winner Model" — DELETE or move to a project-history doc; that model lived in DuckDB and doesn't apply to the cloud backend
- "Map Atlas Pipeline" — KEEP (bake scripts unchanged)
- "Game Detail View (Shared Desktop + Web)" — REWRITE or rename. The "shared with desktop" framing is gone; "shared with the legacy `web/` viewer" stays accurate
- "Svelte 5 Standards", "Frontend: Null/Undefined Handling", "Frontend: Enum Formatting", "Frontend: Color Usage" — KEEP, lightly edit
- "Cloud Admin CLI" — KEEP
- "Development Principles", "Commit Messages" — KEEP

**`README.md`** — rewrite. Lead with "Per-Ankh is a web app at https://per-ankh.app for analyzing Old World save files." Add a "Desktop release (final)" section pointing at the v0.2.0 GitHub Release. Keep dev quickstart for contributors.

**`docs/cloud-rewrite-spec.md`:**

- §2 "Parity Test Harness" — collapse to a one-paragraph historical note or drop entirely
- §1235-1240 references to the legacy share viewer's pattern divergence — leave as-is (still accurate; web/ stays)
- Other Tauri references in the spec body — convert from "what we'll build" to "what we built" tense if not already

**`docs/cloud-productionization-plan.md`:**

- §4-§9 (Phases A-F) — already mostly historical or in-progress; collapse to a "What we did" snapshot
- §10 (Phase G) — replace with note that v0.2.0 already serves as desktop-final
- §11 Rollback story — drop (Tauri is gone; the safety net is burned)
- §12 Smaller follow-ups — KEEP, prune any that are now done
- §13 Observability fast-follow — KEEP

**`docs/tauri-removal-plan.md`** (this file) — leave in place as a historical record of the removal. Consider moving to `docs/archive/` once docs/ tidies up.

**`CHANGELOG.md`** — add an entry for the removal:

```
## 0.3.0
- Tauri desktop runtime removed. Per-Ankh is now a web app at https://per-ankh.app.
- The final desktop release remains available as GitHub Release v0.2.0.
```

(Version number inferred from `package.json` already being at 0.3.0; adjust if user prefers.)

**Verify:**

- `npm run format` clean
- All internal doc links resolve (no broken `[text](./path)` references after deletions)

---

### Commit 5 (manual, no code change) — Update v0.2.0 release notes

```bash
gh release edit v0.2.0 --notes "$(cat <<'EOF'
## Final Desktop Release

This is the **last** bundled desktop release of Per-Ankh. The project is now a
web app at <https://per-ankh.app>.

- No future updates, including no security patches.
- Local DuckDB data stays on your machine. To use your saves on the web app,
  re-upload them via <https://per-ankh.app/upload>.
- Source for this release is preserved at the `v0.2.0` tag.

[Original release notes follow…]
EOF
)"
```

(Preserve the existing release notes below the new header. Edit via the GitHub UI if `gh release edit` proves awkward to splice.)

## Risks and how we catch them

| Risk                                                            | Mitigation                                                                                                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stray `@tauri-apps/*` import in a less-trafficked file          | Post-commit-2 grep gate (must return zero hits before commit)                                                                                                         |
| A cloud route silently relying on a deleted Tauri-only type     | Pre-flight grep across `src/` for `$lib/types/` and `$lib/api` consumers — completed during exploration; all consumers are in the delete set or in `web/` (preserved) |
| `web/` build breaks because a symlinked file changed            | `cd web && npm run check` runs as part of Commit 2 verify gate                                                                                                        |
| `release.yml` deletion misses an in-flight release              | None pending; safe to drop                                                                                                                                            |
| v0.2.0 auto-updater on existing installs phones home and breaks | Documented as acceptable in §Commit 3; if user later cuts a `v*` cloud tag, `releases/latest/download/latest.json` returns 404 and Tauri's updater fails silently     |

## Things explicitly NOT changing

- `web/` directory (legacy share viewer)
- `cloud/src/index.ts` `/v1/share/*` endpoints
- Existing R2 share blobs
- `src/lib/types/` directory contents (only the `types.ts` re-exporter goes)
- `Reference` symlink (still feeds bake scripts)
- `cloud/` Worker code (already cloud-native)
- `static/atlases/`, `static/sprites/`, bake pipelines
- Any cloud component (`Cloud*.svelte`, `BulkReparseModal`, `BulkUploadModal`, `UploadModal`, `VisibilityToggle`, `ReimportButton`)
- v0.2.0 GitHub Release binaries (only the notes get a header)
