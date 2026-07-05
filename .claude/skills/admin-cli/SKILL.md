---
name: admin-cli
description: >-
  Operate the live Per-Ankh app via `./per-ankh admin` — inspect or manage
  users, games, events, legacy shares, security, and tournaments — or run the
  local-only dev helpers (dev-login, tournament seed). Use when the user asks
  to look up a user/game, check stats or events, moderate/block/nuke shares,
  grant tournament beta/admin, seed a local fixture, or mint a local dev
  session. NOT for writing app code.
metadata:
  type: project
  implementation: scripts/admin/
---
# Cloud Admin CLI (`./per-ankh admin`)

**Red line — read first.** `./per-ankh admin` defaults to **production**. Never run it against production or with `--staging`/`--remote` — including read-only reads — unless the user's current message explicitly asks for that exact command; ask first. It authenticates against the user's Cloudflare account (a 1Password prompt on this machine). Only the `--local` path (and the hard-local-only `dev-login` / `tournament seed`) is safe to run unprompted.

`./per-ankh admin` is the operator CLI for the live app — covers both the cloud-rewrite world (users, games, events) and the frozen legacy share world. Implementation lives under `scripts/admin/`. Calls `wrangler` directly (no API key — relies on `wrangler login`). Run `./per-ankh admin --help` for the full list. The list below is illustrative, not exhaustive — `--help` groups the full surface (Stats, Users, Games, Events, Shares, Security, Tournaments, Dev).

```bash
./per-ankh admin stats                       # Global counts + recent activity
./per-ankh admin users [--limit N] [--sort recent|uploads|created]
./per-ankh admin user <user_id>              # Detail (games, collections, online_ids)
./per-ankh admin games [--limit N] [--user U]
./per-ankh admin events [--type T] [--user U]
./per-ankh admin shares list [--limit N]     # Legacy shares
./per-ankh admin block-key <key> [reason]
./per-ankh admin nuke-key <key>              # Block + delete all legacy shares (type "nuke")
./per-ankh admin nuke-user <user_id>         # Delete cloud user + games + R2 blobs (type "nuke")
```

## Tournaments

`./per-ankh admin tournament <sub>` — `create`, `list`, `show`, `delete`, `grant-admin`, `revoke-admin`, `seed`, `beta-grant`, `beta-revoke`, `beta-list`:

```bash
./per-ankh admin tournament beta-grant <discord_id>    # Add to the tournament create-allowlist (CLI-only)
./per-ankh admin tournament beta-list                  # Show the create-allowlist
./per-ankh admin --local tournament seed <slug> [name] # Build a full local fixture (see below)
```

Build a full local fixture (Swiss + championship via the real planner) with `./per-ankh admin --local tournament seed <slug> [name]`, flags `--qualifiers N` (default 6), `--players-per-division N` (default 8), `--fill mid-swiss|swiss-done|mid-championship|complete` (default `mid-championship`).

## Dev (local only)

`./per-ankh admin --local dev-login [--username NAME]` provisions a fake local user + 30-day session cookie (and adds them to the tournament create-allowlist) for testing a second account. Both `tournament seed` and `dev-login` are **local-only** and refuse to run against remote (staging included). For the browser-side Discord-free login bypass, see `docs/dev-login.md`.

## Flags & targeting

Add `--json` to any read command for pipeable output; add `--yes` to skip confirmation on destructive ops. `--local` targets the local `.wrangler` state; `--staging` targets the staging D1/R2 (remote, mutually exclusive with `--local`); the default is **production**. The dev-only commands (`dev-login`, `tournament seed`) refuse both remote targets, staging included.
