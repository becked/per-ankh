# Cloudflare WAF for Per-Ankh

Per-Ankh has two rate-limiting layers, and they see different things. The **application** layer lives in the Worker — per-IP budgets counted in D1 (`cloud/src/tournament/limits.ts`, `countEventsSince` in `cloud/src/games.ts`). The **edge** layer is Cloudflare's WAF, configured in the dashboard. This doc covers the edge layer: when to reach for it, how to write rules that work correctly given how this app is deployed, and the one mistake that takes the whole site down.

The edge layer's distinguishing property is that **it needs no deploy**. Application limits are compiled into the Worker, so retuning one means shipping code. A WAF rule takes effect in seconds and rolls back just as fast. That makes it the right tool for an active incident and the wrong tool for a permanent invariant — a rule in the dashboard is invisible to anyone reading this repository, so anything meant to be durable belongs in code.

## The critical fact: where a rule can see the visitor

Per-Ankh is two Workers on one zone:

| Hostname | Worker | Config |
| --- | --- | --- |
| `per-ankh.app` | `per-ankh-frontend` (SvelteKit SSR) | `wrangler.toml` |
| `api.per-ankh.app` | `per-ankh-share-api` | `cloud/wrangler.toml` |

When a visitor loads a page, the frontend Worker server-renders it, and that render makes its own subrequests to `api.per-ankh.app`. **Those subrequests do not carry the visitor's IP.** They arrive at the API from a Cloudflare egress address — on 2026-08-05 every server-rendered request in production came from `2a06:98c0:3600::103`.

The consequence for rule-writing is absolute:

> **Match on `per-ankh.app`, not `api.per-ankh.app`, whenever a rule keys on the client.** At the frontend hostname `ip.src` is the real visitor. At the API hostname, for server-rendered traffic, it is one shared Cloudflare address representing every visitor at once.

An IP-keyed rate limit or block on `api.per-ankh.app` does not throttle an abuser. It throttles the SSR egress, which means it throttles **every visitor simultaneously** — a total outage, triggered by whatever traffic volume the site happens to be serving. Do not do it. The same reasoning forbids ever adding a Cloudflare egress address to an IP Access Rule block.

Client-side navigations *are* different: once a page has hydrated, the browser calls the API directly and `ip.src` there is the real visitor. So API traffic is a mix of real visitor IPs and one shared egress address, which is precisely why it is not a safe thing to key rules on.

The application layer is no longer in the same position, and the distinction matters when reading the counters below. The frontend Worker now forwards the visitor's address on its subrequests and authenticates itself with a shared secret, so the API's own per-IP budgets are keyed on the visitor even for server-rendered traffic (`adoptTrustedFrontend` in `cloud/src/util.ts`). **A WAF rule still cannot see that** — `ip.src` at the API hostname is the network peer, which for SSR is still the egress, and no forwarded header changes it. So: application counters attribute correctly; WAF rules keyed on the client still belong at `per-ankh.app`.

One thing the application layer deliberately cannot see is the visitor's User-Agent, on every route but one. It doesn't survive the SSR hop and isn't forwarded, because the Worker's scraper exemption (`isScraperUA`) is keyed on a self-declared string and skips the audit row as well as the gate — forwarding it would make `User-Agent: Discordbot/2.0` an unmetered and unlogged path through every read budget. **UA-based rules therefore belong at the edge**, where Cloudflare can also tell you whether the bot is verified. Recipe 2 below is that rule.

The exception is `GET /v1/games/:id/card.png`, the link-preview image (`cloud/src/og-card/`). A crawler fetches it from `api.per-ankh.app` directly rather than through a render, so there is no SSR hop to strip the header: the real User-Agent arrives, `isScraperUA` fires, and the read budget is skipped by whoever sends the string — which is the point, since refusing a crawler is refusing the unfurl. What bounds that route is not a budget but its own URL: it renders only the canonical `?v=…&c=…` query string and redirects everything else, so a spoofed crawler gets one cacheable redirect per made-up URL rather than ~60 ms of raster. `ip.src` at the API hostname is the crawler's own address for these requests, not the SSR egress, so a rule keyed on them is the one API-hostname case the warning above does not cover — it still may not be an IP rule, because client-side navigations arrive on the same hostname.

## Worked example: the 2026-08-05 tournament outage

`/tournaments/2026-community-tournament` began returning 500. The cause was not the tournament:

1. Something crawled roughly 270 `/games/[id]` pages a minute at 17:07 and again at 17:09.
2. Every game page render calls `GET /v1/games/:id/tournament-link`, and that handler charged the **tournament** view budget (`TOURNAMENT_VIEW_PER_HOUR`, 600/hour) before checking whether the game was even linked to a tournament.
3. All those renders were server-side, so all 536 requests landed on the single SSR egress address, which hit exactly 600 in the rolling hour and started returning 429.
4. The tournament page loader had no 429 branch, so the 429 surfaced as a 500.

It self-healed an hour later when the burst aged out of the window.

Steps 2, 3 and 4 have since been fixed in code:

- **2** — the link read has its own budget (`tournament_link_view`, `TOURNAMENT_LINK_VIEW_PER_HOUR`), so game-page traffic no longer spends the tournament pages' allowance. The tournament *list* read was split out the same way (`tournament_list_view`), because the home page fetches it on every render and had the identical relationship to the pages.
- **3** — the frontend forwards each visitor's address on its SSR subrequests, so the burst would now land in the crawler's own bucket instead of pooling with every other visitor on the egress address.
- **4** — every rate-limited loader answers a spent budget with a 429 page (`rethrowRateLimit` in `src/lib/utils/load-errors.ts`) rather than a 500.

Step 1 is the part no code fix reaches: a crawler with its own bucket can still drain that bucket, and 270 page renders a minute is load we are simply serving. **A WAF rate limit on `/games/*` at `per-ankh.app` stops it there**, keyed on the crawler's real IP, with no deploy.

Confirm the application-layer symptom with a read-only query before reaching for a rule. All the read budgets at once, because which one is draining tells you which surface is degraded — `tournament_view` means the tournament pages are 429ing, `tournament_list_view` means the home page's tournament strip is emptying, `tournament_link_view` means game pages are quietly losing their tournament banner:

```bash
cd cloud && npx wrangler d1 execute per-ankh-share-index --remote --command \
"SELECT event_type, ip_address, COUNT(*) AS n FROM events \
 WHERE event_type IN ('tournament_view','tournament_list_view','tournament_link_view','anon_read') \
   AND created_at > datetime('now','-1 hour') \
 GROUP BY event_type, ip_address ORDER BY n DESC LIMIT 10;"
```

A bucket at its ceiling is currently rejecting: 2400 for `tournament_view`, 600 for the list and link budgets (`cloud/src/tournament/limits.ts`, or whatever the matching var is set to), 200 for `anon_read` — which is the tightest and gates the game reads themselves, so a `/games/*` crawl hits it first. These count reads, not page loads: `tournament_view` is ~4 reads per tournament page, which is why its number is the larger one for the same amount of browsing.

Read a *quiet* result with suspicion. A scraper-UA caller is exempt from the audit row as well as the gate, so traffic claiming to be a link-preview crawler leaves nothing here at all. If the site is visibly under load and this query looks calm, that's the case to check at the edge (**Security → Events**), not a sign that nothing is happening.

The top bucket is the address to write a rule for: since forwarding shipped, a server-rendered page load is counted against the visitor, so a single abuser shows up as itself rather than pooling into the egress address. Two readings worth knowing:

- **A Cloudflare egress address at the top** now means forwarding is *not* working — the shared secret is missing or mismatched on one of the two Workers. This query is the diagnostic: an egress address topping it is the symptom, and the logs may say nothing at all, since `ssr_forward_rejected` fires on a *mismatched* key and there is nothing to reject when one side simply has no key. The `secrets.ssr_trust` preflight check (`./per-ankh prod preflight`) answers the same question without waiting for an incident; §3.2 of `docs/cloud-deploy-plan.md` covers setting the key on both Workers. Meanwhile every SSR visitor is sharing one bucket, so treat the number as site-wide load rather than as one abuser.
- **A real address at the top** is the crawler, and `per-ankh.app` is still where the rule goes — the API hostname sees the egress as `ip.src` no matter what the counters say.

## Where the controls live

In the dashboard: select the `per-ankh.app` zone, then **Security**. The relevant sections are **Security rules** (custom rules and rate limiting rules), **Events** (what rules actually fired), and **Settings** (bot controls, managed `robots.txt`).

Capability varies by plan — the number of rate limiting rules, the granularity of the counting period, and whether Bot Management scores are available all depend on it. Check what the zone offers before writing a rule that depends on a field. The recipes below stick to fields available broadly.

`robots.txt` is served from **Cloudflare Managed content**, not from `static/` in this repo. That is why there is no `static/robots.txt` — editing the live file means editing it in the dashboard. It already disallows a list of AI crawlers. It is advisory: a crawler that ignores `robots.txt` is exactly the kind that causes the incident above, which is what the rules below are for.

## Recipe 1 — rate-limit game page crawling

This is the direct fix for the 2026-08-05 pattern. **Security rules → Rate limiting rules → Create rule.**

- **Expression:**
  ```
  (http.host eq "per-ankh.app" and starts_with(http.request.uri.path, "/games/") and not cf.client.bot)
  ```
- **Characteristics:** IP with NAT support (falls back to `ip.src` where unavailable)
- **Period:** 1 minute
- **Requests:** 60
- **Action:** Managed Challenge
- **Duration:** 10 minutes

`not cf.client.bot` excludes Cloudflare's verified-bot list, so Googlebot and other search crawlers you want indexing the site are not challenged. Unverified automation is.

Sixty game pages a minute is far above human browsing and far below the ~270/minute burst that caused the outage. Managed Challenge rather than Block means a real user who trips it gets through after a challenge instead of hitting a wall.

## Recipe 2 — challenge or block a specific crawler

When a single misbehaving agent is identifiable by User-Agent. **Security rules → Custom rules → Create rule.**

```
(http.host eq "per-ankh.app" and http.user_agent contains "<agent-string>")
```

Action: Managed Challenge, or Block if it is unambiguously hostile. Prefer this over a rate limit when the agent is known, because it costs nothing to evaluate and does not risk catching real users.

To find the agent string, use **Security → Events**, filter to the affected path and time window, and read the User-Agent column. Note this is the only place you can see it: the `events` table in D1 records `ip_address` but not User-Agent, and the visitor's UA is deliberately not carried across the SSR hop, so the API never sees one for server-rendered traffic either.

This is also the rule to reach for when a crawler is claiming a link-preview UA to stay under the application limits — the exemption is a self-declared header the Worker can't verify, and this is the layer that can.

## Recipe 3 — emergency brake on a path

If a single route is being hammered and you need it to stop right now, with correctness secondary to survival:

```
(http.host eq "per-ankh.app" and starts_with(http.request.uri.path, "/<path>/") and not cf.client.bot)
```

Action: Managed Challenge, applied to everyone unverified. This degrades the experience for real users on that path and should be reverted as soon as the underlying cause is addressed. Note in the rule description why it exists and when it can go.

## Verifying a rule

After creating any rule, confirm the site still serves:

```bash
for u in \
  "https://per-ankh.app/tournaments/2026-community-tournament" \
  "https://per-ankh.app/tournaments" \
  "https://per-ankh.app/games/<a-known-public-game-id>" ; do
  curl -s -o /dev/null -w "%{http_code}  $u\n" "$u"
done
```

All should be 200. A 403 or 503 means the rule is catching ordinary traffic — the usual cause is matching `api.per-ankh.app`, or omitting the `http.host` clause so the rule applies zone-wide including the API hostname.

Then watch **Security → Events** for a few minutes. A correct rule shows a small number of matches against one or a few source IPs. Hundreds of matches spread across many IPs means it is catching real visitors; revert.

## Rolling back

Every rule has an enable/disable toggle. Disable rather than delete during an incident — it preserves the expression for the post-mortem and can be re-enabled instantly. Delete once the application-layer fix has shipped and the rule is genuinely obsolete.

## Rules to never write

- **Anything IP-keyed on `api.per-ankh.app`.** Explained above. This is the one that causes a full outage.
- **An IP Access Rule blocking a Cloudflare egress address.** Same failure, arrived at from the other direction. If a Cloudflare-owned address shows up as your top talker, that is SSR, not an attacker.
- **A zone-wide rule with no `http.host` clause**, when you meant to target the frontend. It will apply to the API hostname too and inherit the problem above.
- **A permanent rule standing in for a code fix.** Edge rules are invisible to the repository. If a limit is part of how the app is supposed to behave, it belongs in `cloud/src/tournament/limits.ts` or alongside the other per-IP budgets, where it is reviewable and testable.

## See also

- `cloud/src/tournament/limits.ts` — application-layer rate-limit ceilings
- `cloud/src/games.ts` — `countEventsSince`, the shared 1-hour per-IP counter
- `cloud/src/retention.ts` — how rate-limit counter rows age out (24h)
- `cloud/src/util.ts` — `getClientIp`, which reads `CF-Connecting-IP`
- `docs/security-events.md` — the `security_events` tee and its drain
