# Security-events tee (Skiff drain)

The API Worker emits **one D1 row per security-relevant request** into a
`security_events` table. **Skiff** — external, read-only security-triage tooling —
drains that table over the D1 REST API with a read-only token, cursoring on the
AUTOINCREMENT `id`. Nothing writes back; the app emits matched **route patterns**
only, and mapping patterns to anything else happens on Skiff's side.

Origin and the negotiated decisions: issue #71. Provisioning/rollout runbook:
[`cloud-deploy-plan.md` §3.9](./cloud-deploy-plan.md).

## Architecture

- **Chokepoint.** `emitSecurityEvent` (`cloud/src/security-events.ts`) is called
  from the fetch envelope in `cloud/src/index.ts`, right after `emitAccessLog`. It
  reads the same request-scoped log context (`getLogContext()` in
  `cloud/src/log.ts`) for `route` / `request_id` / `path` / `method` / `cf_ray`.
  Because it sits in the envelope, it also runs on the safety-net 500 path.
- **Dedicated database.** The table lives in its **own** D1 (binding
  `SECURITY_DB`, `per-ankh-security-events`), **not** `SHARE_DB`. D1 is
  single-threaded per database, and the reasons that fire hardest (`auth_fail`,
  `admin_probe`, `rate_limited`) are exactly the attack scenarios — co-locating
  would let a probe storm contend with live games/tournaments/auth queries. A
  separate DB makes that impossible by construction.
- **Non-blocking, fail-safe.** The synchronous classification is wrapped in
  `try/catch`; the D1 write is deferred via `ctx.waitUntil(insert().catch(...))`.
  A failure (missing table, unavailable DB, a throw) is logged and dropped — the
  response is already built and is never altered or delayed. A row is written
  only for *matched* requests; ordinary 2xx traffic emits nothing.

## Reason vocabulary & precedence

One row per request, exactly one reason. First match wins. Route-scoped reasons
beat status-scoped ones (the status buckets 429 / 5xx / 404 / 401–403 are mutually
exclusive, so only the route reasons need to precede them):

| # | reason | condition | route emitted |
|---|--------|-----------|---------------|
| 1 | `signup` | a new account was created | `POST /v1/auth/discord/callback` |
| 1 | `terms_gate` | the screenshot upload terms have not been accepted | `POST /v1/games/:id/screenshots` |
| 2 | `dev_login_probe` | any request to `/v1/auth/dev/login` | `<METHOD> /v1/auth/dev/login` |
| 3 | `rate_limited` | status 429 | matched route |
| 4 | `server_error` | status 5xx | matched route |
| 5 | `admin_probe` | status 404 under `/v1/admin/*` | matched route, or `<METHOD> /v1/admin/*` |
| 6 | `auth_fail` | status 401 or 403 | matched route |
| – | (none) | otherwise | no row |

Both handler-set reasons share slot 1 — they are set by different handlers, so they never compete.

`signup` can't be inferred from status+route (a new account and a returning login
are both `POST /v1/auth/discord/callback` → 200). `handleDiscordCallback`
(`cloud/src/auth.ts`) detects the new account via `upsert.user_id === newUserId`
and tags it with `setSecurityReason("signup")`; the classifier reads that handler
override before falling back to the status/route rules. (Sign-up is otherwise
fully open behind Discord OAuth — there is no invite-code or allowlist gate — so
new-account volume is the abuse signal.)

`terms_gate` is the same "not derivable here" case from the other direction. `POST /v1/games/:id/screenshots` refuses with `403 TERMS_NOT_ACCEPTED` until an account has accepted the upload terms, and that refusal is the designed *first step* of the upload flow — the client collects the agreement off it and retries. On the status rule alone it would record as `auth_fail`, once per new uploader, so the drain would carry one authentication failure per account that ever uploads a screenshot. Neither alternative was taken: moving the status off the 401/403 pair would change the documented API and the client's one branch, and exempting the code in the classifier would put a handler-specific carve-out inside a rule whose whole point is that status decides. Instead `handleScreenshotUpload` (`cloud/src/screenshots/handlers.ts`) calls `setSecurityReason("terms_gate")` before returning the 403 — the row is still emitted, and it is labelled truthfully.

The "any status" route deliberately swallows the status-scoped signal: a 403 or
a 429 on `/v1/auth/dev/login` records as `dev_login_probe`, not `auth_fail` /
`rate_limited`. That's fine — Skiff stores `status` as its own column, so
`403/dev_login_probe` and `429/dev_login_probe` stay distinguishable.

## Route patterns, never raw paths

The `route` column always carries a pattern. When the request matched a declared
route, that's `ctx.route` (e.g. `GET /v1/admin/games/all`). When it didn't — the
high-signal probes, `GET /v1/admin/<random>` or a non-GET to dev-login — there is
no declared pattern, so the tee synthesizes a coarse one (`<METHOD> /v1/admin/*`,
`<METHOD> /v1/auth/dev/login`) and puts the **truncated raw path (≤128 chars) in
`meta.raw_path`** for triage. The raw path never appears in `route`.

## `actor_ip`

Populated from `CF-Connecting-IP` when the request traversed Cloudflare's edge (`CF-RAY` present) **or** proved it came from our SSR Worker with `SSR_TRUSTED_KEY` — the same trust rule as `getClientIp`. `NULL` otherwise.

On a trusted server-rendered request the address is the **visitor's**, forwarded by the frontend Worker and swapped in before dispatch (`adoptTrustedFrontend`, `cloud/src/util.ts`) — which is the point: an event names the person rather than Cloudflare's SSR egress, where every server-rendered visitor would otherwise appear as one address. It is an assertion by a caller holding the shared secret rather than a peer address this Worker observed, and the column doesn't distinguish the two, so it is exactly as good as that secret.

Local-dev rows are null for the browser's own API calls (no edge, nothing forwarded). Requests that came through SSR carry the dev machine's address, since `cloud/.dev.vars.example` ships the same key as the committed `.env.development` so the forwarding path is exercised locally.

## Schema

`cloud/migrations-security/0001_security_events.sql`:

| column | type | notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | drain cursor; ids are never reused |
| `ts` | TEXT NOT NULL | ISO-8601 UTC event time |
| `route` | TEXT NOT NULL | matched/synthesized pattern |
| `status` | INTEGER NOT NULL | response status |
| `reason` | TEXT NOT NULL | from the vocabulary above |
| `actor_ip` | TEXT | NULL when off-edge |
| `request_id` | TEXT NOT NULL | correlates to the access-log line |
| `meta` | TEXT | small JSON, optional (e.g. `{"raw_path": …}`) |

There's an index on `ts` for the retention sweep. The cursor drain rides the `id`
PK.

## Retention

Skiff drains continuously and its credential is **read-only by design** — deletion
is ours, never the drain's. `sweepSecurityEvents` (`cloud/src/retention.ts`) is a
single age-out `DELETE` (30-day floor) run nightly from the existing `scheduled`
handler (`cloud/src/index.ts`), alongside the `events`-table sweep. It's only a
safety floor so the table can't grow unbounded if the drain stalls. Staging is
opted out of the cron (`crons = []`), so staging rows don't auto-prune — fine, as
staging is low-volume and recloned.

## Adding a reason

1. Add it to `SECURITY_REASONS` in `cloud/src/security-events.ts` (with an inline
   condition comment).
2. If it's derivable from status+route, add a branch to `resolveSecurityEvent` in
   the correct precedence slot and cover it in `security-events.test.ts`.
3. If it needs handler knowledge (like `signup`), call `setSecurityReason(...)`
   from the handler and let the override path carry it.

Skiff doesn't key on specific reason values (the reason rides through as data), so
a new value needs nothing on their side — but flag it so it isn't a surprise.

## Code map

- `cloud/src/security-events.ts` — `resolveSecurityEvent` (pure classifier),
  `emitSecurityEvent` (the tee), `SECURITY_REASONS`.
- `cloud/src/log.ts` — `setSecurityReason` / `getLogContext`.
- `cloud/src/auth.ts` — the `signup` tag.
- `cloud/src/screenshots/handlers.ts` — the `terms_gate` tag.
- `cloud/src/retention.ts` — `sweepSecurityEvents`.
- `cloud/src/index.ts` — the chokepoint call + the `scheduled` sweep.
- `cloud/migrations-security/0001_security_events.sql` — schema.
- `cloud/wrangler.toml` — the `SECURITY_DB` binding (prod + staging).
