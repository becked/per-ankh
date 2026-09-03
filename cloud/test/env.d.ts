// Augment the `cloudflare:test` env with our worker's bindings plus the
// test-only TEST_MIGRATIONS binding from vitest.config.mts.
//
// `wrangler types` would normally generate the production bindings into a
// `worker-configuration.d.ts`; we declare them by hand since this project
// doesn't generate that file (and the test binding wouldn't be in it).

import type { D1Migration } from "@cloudflare/vitest-pool-workers/types";

declare global {
	namespace Cloudflare {
		interface Env {
			SHARE_DB: D1Database;
			SECURITY_DB: D1Database;
			SESSIONS_KV: KVNamespace;
			SHARE_BUCKET: R2Bucket;
			TEST_MIGRATIONS: D1Migration[];
			TEST_SECURITY_MIGRATIONS: D1Migration[];
			ALLOWED_ORIGINS: string;
			// Bound from the top-level [vars] block like ALLOWED_ORIGINS.
			// Declared because SessionEnv requires it, so anything reached
			// through StatsCacheEnv — the /stats bundle cache — takes `env`
			// directly rather than through a cast.
			SESSION_COOKIE_NAME: string;
			// Tunable per-IP read ceilings. Declared so the rate-limit tests can
			// substitute a value the way `wrangler secret put` does in production
			// (see tournament/rate-limit-view.test.ts).
			TOURNAMENT_VIEW_PER_HOUR: string;
			TOURNAMENT_LIST_VIEW_PER_HOUR: string;
			TOURNAMENT_LINK_VIEW_PER_HOUR: string;
			GLOBAL_STATS_VIEW_PER_HOUR: string;
			CHALLENGE_VIEW_PER_HOUR: string;
			CHALLENGE_LINK_VIEW_PER_HOUR: string;
			// Shared key for trusted SSR requests, bound in vitest.config.mts.
			// Declared so a test can clear it and prove forwarding goes dark
			// (see integration/ssr-trust.test.ts).
			SSR_TRUSTED_KEY: string;
		}
	}
}
