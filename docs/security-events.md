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
| 2 | `dev_login_probe` | any request to `/v1/auth/dev/login` | `<METHOD> /v1/auth/dev/login` |
| 3 | `legacy_share_write` | `POST /v1/share`, **any status** | `POST /v1/share` |
| 4 | `rate_limited` | status 429 | matched route |
| 5 | `server_error` | status 5xx | matched route |
| 6 | `admin_probe` | status 404 under `/v1/admin/*` | matched route, or `<METHOD> /v1/admin/*` |
| 7 | `auth_fail` | status 401 or 403 | matched route |
| – | (none) | otherwise | no row |

`signup` can't be inferred from status+route (a new account and a returning login
are both `POST /v1/auth/discord/callback` → 200). `handleDiscordCallback`
(`cloud/src/auth.ts`) detects the new account via `upsert.user_id === newUserId`
and tags it with `setSecurityReason("signup")`; the classifier reads that handler
override before falling back to the status/route rules. (Sign-up is otherwise
fully open behind Discord OAuth — there is no invite-code or allowlist gate — so
new-account volume is the abuse signal.)

The two "any status" routes deliberately swallow the status-scoped signal: a
blocklist 403 or a 429 on `POST /v1/share` records as `legacy_share_write`, not
`auth_fail` / `rate_limited`. That's fine — Skiff stores `status` as its own
column, so `403/legacy_share_write` and `429/legacy_share_write` stay
distinguishable.

## Route patterns, never raw paths

The `route` column always carries a pattern. When the request matched a declared
route, that's `ctx.route` (e.g. `GET /v1/admin/games/all`). When it didn't — the
high-signal probes, `GET /v1/admin/<random>` or a non-GET to dev-login — there is
no declared pattern, so the tee synthesizes a coarse one (`<METHOD> /v1/admin/*`,
`<METHOD> /v1/auth/dev/login`) and puts the **truncated raw path (≤128 chars) in
`meta.raw_path`** for triage. The raw path never appears in `route`.

## `actor_ip`

Populated from `CF-Connecting-IP` only when the request traversed Cloudflare's
edge (`CF-RAY` present) — the same distrust rule as `getClientIp`. `NULL`
otherwise, which is why local-dev rows have a null `actor_ip` (no edge).

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
- `cloud/src/retention.ts` — `sweepSecurityEvents`.
- `cloud/src/index.ts` — the chokepoint call + the `scheduled` sweep.
- `cloud/migrations-security/0001_security_events.sql` — schema.
- `cloud/wrangler.toml` — the `SECURITY_DB` binding (prod + staging).
