# Contributing to Per-Ankh

Setup (dependencies, asset baking, running the app) is in the [README](README.md#development). This doc is the PR workflow. Keep PRs small — one logical change each.

## Fork-and-PR workflow

```bash
# 1. Fork becked/per-ankh on GitHub (the Fork button), then clone your fork:
git clone https://github.com/<you>/per-ankh.git
cd per-ankh
git remote add upstream https://github.com/becked/per-ankh.git

# 2. Branch from an up-to-date main:
git fetch upstream
git checkout -b my-change upstream/main

# 3. Make your change, then run the checks:
npm run lint && npm run check              # frontend (repo root)
(cd cloud && npm run typecheck && npm test)  # cloud Worker

# 4. Push to your fork:
git push -u origin my-change
```

Then on GitHub, use **Compare & pull request**. Confirm the direction: base `becked/per-ankh` `main` ← compare `<you>/per-ankh` `my-change`.

Before writing much code, skim [`CLAUDE.md` → Contributing](CLAUDE.md#contributing--making-prs-that-merge-cleanly) — the list of what keeps a PR mergeable (reuse existing helpers, wire every parallel call site, no dead code).

## Leave "Allow edits by maintainers" checked

The checkbox on the PR page is checked by default — leave it. It lets the maintainer push fixups (rebase, lint, a naming tweak) straight to your branch so a near-ready PR merges without a round-trip. No collaborator invite needed.

## Keeping your branch current

If `main` moves while your PR is open, rebase (don't merge):

```bash
git fetch upstream
git rebase upstream/main
git push --force-with-lease
```

## Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`, `perf:`, `test:`, `chore:`).
- **Markdown:** prose is soft-wrapped, one paragraph per line — don't hard-wrap to a column.
