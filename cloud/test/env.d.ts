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
			SESSIONS_KV: KVNamespace;
			SHARE_BUCKET: R2Bucket;
			TEST_MIGRATIONS: D1Migration[];
			ALLOWED_ORIGINS: string;
			ALLOWED_ORIGIN: string;
		}
	}
}
