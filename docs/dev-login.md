# Dev login — Discord-free local auth

Testing account-specific behavior (tournament slot claims, account switching,
re-login) normally means a full Discord OAuth round-trip per account, which is
slow and can't easily impersonate other users. The dev-login bypass mints a
session locally from an explicit Discord identity so you can log in as anyone
in one navigation.

**Local only.** The endpoint is hard-gated off in production (see
[Safety](#safety)). Never rely on it for anything but local development.

## How a login works here

A session is just three pieces of local state that Discord OAuth happens to
orchestrate:

1. a `users` row — `user_id`, `discord_id`, `discord_username`, `display_name`,
   `avatar_hash` (`cloud/src/auth.ts`, the OAuth-callback upsert)
2. tournament-slot claims via `claimTournamentSlots` — links any unclaimed slot
   whose `discord_username` matches the logging-in user
3. a KV `session:<token>` → `{ user_id, discord_username }` plus the
   `Set-Cookie` (`cloud/src/session.ts`)

Discord only adds identity verification + the token exchange. Dev-login skips
that and does the same three writes directly, so it exercises the _real_
post-login code path (including the slot claim).

## Setup

`DEV_LOGIN` must be set in `cloud/.dev.vars` (gitignored, local-only):

```
DEV_LOGIN=1
```

Wrangler reads `.dev.vars` **at startup** — if you add the flag while
`./per-ankh` is already running, restart it or the endpoint stays 404.

## Usage

With the dev server running (`./per-ankh` → SvelteKit on `:1420`, Wrangler on
`:8787`), paste into the browser address bar:

```
http://localhost:8787/v1/auth/dev/login?discord_id=<snowflake>&username=<handle>
```

The endpoint sets the session cookie and 302-redirects to the SvelteKit dev
origin, so the browser lands logged in.

### Query parameters

| param          | required | notes                                                                  |
| -------------- | -------- | ---------------------------------------------------------------------- |
| `discord_id`   | yes      | Numeric snowflake (1–20 digits). The stable identity key.              |
| `username`     | yes      | Discord handle (1–32 chars). Lowercased, stored as `discord_username`. |
| `display_name` | no       | Human-facing name. Defaults to `username` when omitted.                |
| `next`         | no       | Same-origin path to land on after login. Defaults to `/`.              |

The endpoint also seeds the Personal collection and **auto-grants tournament
beta** for the user, so the dev account can use the tournament surface
immediately (unlike the real callback, which only pins an operator-created beta
row).

### Examples

```
# Log in as the local tournament admin and land on a swiss tournament
http://localhost:8787/v1/auth/dev/login?discord_id=803604198989758524&username=.becked&display_name=.becked&next=/tournaments/test-03

# Log in as a substituted player to verify their slot auto-claims
http://localhost:8787/v1/auth/dev/login?discord_id=1172141171464745032&username=thepurplebullmoose&next=/tournaments/test-03
```

To **switch accounts**, hit the URL again with a different `discord_id` /
`username`. To test **re-login / claim**, just hit it again — the claim runs
every time.

## Local tournaments

`test-run` is the **production** slug and does not exist locally. The local D1
has its own set — list them before picking a `next`:

```bash
DB="per-ankh-share-index"
npx wrangler d1 execute $DB --local --command \
  "SELECT slug, status FROM tournaments ORDER BY created_at;"
# admins for a slug (which account to log in as for admin actions):
npx wrangler d1 execute $DB --local --command \
  "SELECT u.discord_username, u.discord_id FROM tournament_admins a
   JOIN tournaments t ON t.tournament_id = a.tournament_id
   JOIN users u ON u.user_id = a.user_id WHERE t.slug = '<slug>';"
```

## End-to-end: substitution → claim

Verifies the replacement-player flow (admin pre-link + free-text claim):

1. **Log in as the tournament admin** (`.becked` for `test-03`/`test-04`),
   `next` to the tournament.
2. **Pre-link path** — edit a slot (standings pencil or a match-side
   substitute), type a registered user's handle, pick from the autocomplete,
   save. The slot should show claimed (`✓` / `user_id` set) immediately, with
   no second login.
3. **Free-text + claim path** — substitute a slot to a handle as _free text_
   (don't pick a suggestion). Then dev-login as that user (matching
   `username`); their slot should auto-claim on the redirect, and the
   tournament should appear under My Tournaments.

To seed a fresh searchable player for step 2 without touching existing rows,
dev-login once as a new `discord_id` / `username` — that creates the `users`
row, after which they're findable in the substitute autocomplete.

## Caveats

- **Impersonating an existing user** refreshes their `display_name` on each
  login (same as the real callback does from Discord). Omitting `display_name`
  rewrites it to the `username`; pass `display_name` explicitly to preserve it.
- **Port** — if `:8787` is taken, Wrangler picks the next free port (e.g.
  `:8788`); use whatever it logs. A connection error (not a 404) means you have
  the wrong port.
- **A 404 on the redirected page** (`/tournaments/<slug>`) usually means the
  slug doesn't exist locally, not a beta problem — the dev user is granted beta.

## Safety

The handler (`handleDevLogin` in `cloud/src/auth.ts`) returns 404 unless **both**:

- `DEV_LOGIN` is set — present only in `cloud/.dev.vars` (gitignored); prod
  never sets it, and it is deliberately **not** in `wrangler.toml [vars]`, so
  `./per-ankh prod preflight` hygiene stays clean.
- the request is **non-HTTPS** — prod is always HTTPS, dev is HTTP.

Either guard alone keeps it dark in production; both together are
belt-and-suspenders. The route is registered in `cloud/src/index.ts` like any
other, but resolves to 404 in prod.
