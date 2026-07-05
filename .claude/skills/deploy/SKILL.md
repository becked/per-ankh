---
name: deploy
description: >-
  Deploy Per-Ankh to production or staging, or run any part of the deploy
  runbook — preflight, migrate, worker, frontend, smoke, status, changelog.
  Use when the user explicitly asks to deploy/ship/release, run preflight or
  smoke, apply remote/staging D1 migrations, cut a changelog/version stamp, or
  check deployed worker versions. NOT for local development or writing code —
  those never touch prod or staging.
metadata:
  type: project
  source-of-truth: docs/cloud-deploy-plan.md
---
# Deploying Per-Ankh (prod / staging)

**Red line — read first.** Never run any `prod`, `staging`, or `--remote` command — or any direct `wrangler`/`npx wrangler` call against a live Worker/D1/R2/KV, including read-only ones like `preflight`, `status`, and `smoke` — unless the user's current message explicitly names that exact command. Anything touching `prod`, `staging`, or `--remote` is off-limits by default; ask first. These commands authenticate against the user's Cloudflare account (a 1Password prompt on this machine) and can hit live resources even when nominally read-only. Local (`--local`, `.wrangler` state) is fine.

`./per-ankh prod` automates the deploy runbook (`docs/cloud-deploy-plan.md` §4). Implementation under `scripts/prod/`. Subcommands:

```bash
./per-ankh prod preflight   # All safety checks (git, lint, check, format, audit, secret leak scan,
                            #   [vars] vs secrets hygiene, required-secret presence, pending migrations)
./per-ankh prod deploy      # preflight → changelog → migrate → worker → frontend → smoke (with confirm)
./per-ankh prod migrate     # Apply pending D1 migrations (with confirm + preview)
./per-ankh prod smoke       # GET probes against per-ankh.app, api.per-ankh.app/v1/auth/me, legacy
./per-ankh prod status      # Local git, deployed worker versions, secrets, pending migrations
./per-ankh prod changelog   # Preview the next changelog entry; --write to persist + tag
```

Flags: `--dry-run`, `--yes`, `--allow-dirty`, `--allow-branch`, `--skip-checks`, `--skip-worker`, `--skip-frontend`, `--skip-smoke`, `--skip-changelog`, `--edit-changelog`, `--json`. Preflight blocks on uncommitted changes, off-main, behind origin, secret leaks, `[vars]` keys with secret-shaped names, prod/staging wrangler-config drift (vars key sets + binding names — wrangler doesn't inherit either into `[env.staging]`), missing required secrets on the target Worker env, format/lint/typecheck/audit failures. Functional smoke (OAuth flow, upload, share visibility) stays manual — see deploy plan §5.

## Staging

`./per-ankh staging <sub>` runs the same pipeline against the staging environment (`staging.per-ankh.app` + `api-staging.per-ankh.app`, separate D1/KV/R2, separate Discord app — see `docs/cloud-deploy-plan.md` §9 for one-time provisioning). Same subcommands and flags minus `changelog` (staging deploys never write `CHANGELOG.md`, bump the version, or tag) plus `reclone`, which destroys staging data and re-clones D1 + R2 from prod — see deploy plan §9.3. Preflight blocks on the same checks as prod — staging is a staging environment, not a dev playground. `staging.per-ankh.app` sits behind Cloudflare Access; the smoke frontend probe authenticates with the Access service token from the gitignored `.staging.vars` at repo root (`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`), and degrades to asserting the Access login redirect (with a warning) when the file is absent. The session cookie name is per-environment (`SESSION_COOKIE_NAME` var: `session` prod, `session_staging` staging) because both share `Domain=per-ankh.app` — see `cloud/src/session.ts`.

## D1 migrations on a live env

`prod deploy` runs pending `SHARE_DB` migrations itself (or `./per-ankh prod migrate` standalone, with confirm + preview). Rehearse a new migration on staging (or a `./per-ankh staging deploy`, which applies pending migrations itself) before running it on production. The second D1 — `SECURITY_DB` (the Skiff security-events drain, `cloud/migrations-security/`) — is **deliberately not** wired into `prod deploy` (which targets `SHARE_DB` only); apply it by hand via `npm run migrate:security:{remote,staging}`. See `docs/security-events.md`.

## Changelog & deploy stamps

Each `prod deploy` generates a new entry in `CHANGELOG.md` from the conventional-commit log since the last `deploy/*` tag, groups it by `feat`/`fix`/`perf`/other, bumps `package.json` `version` to a calver stamp (`YYYY-MM-DD-<shortsha>`), commits as `chore(release): deploy <stamp>`, and tags `deploy/<stamp>`. The deploy script does **not** push to GitHub — the next deploy finds the previous `deploy/*` tag locally via `git describe`, so pushing is optional bookkeeping (handy for a GitHub-visible deploy history, but not load-bearing). Use `--edit-changelog` to open `$EDITOR` on the file before the commit lands, `--skip-changelog` to bypass entirely, or run `./per-ankh prod changelog` standalone to preview without writing. If there are no new commits since the last deploy tag, the changelog step skips silently.

## Deploy ordering

When a release includes a Worker schema/validation change that the frontend depends on (e.g. a new `PARSER_VERSION`, or a new share-blob field), deploy the **Worker first, frontend second** — a frontend that ships ahead of the Worker breaks uploads/reads. See `cloud/src/CLAUDE.md`.
