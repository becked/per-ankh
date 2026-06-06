// Cloud environment descriptor table — the single source of truth for the
// facts that differ between the production and staging deployments (hostnames,
// D1/R2 resource names, wrangler --env flag, frontend build vars). Consumed by
// the prod/staging deploy commands (scripts/prod/) and the admin CLI
// (scripts/admin/). Local dev is not an entry here: it isn't a cloud
// environment — the admin CLI's `--local` target maps to prod names against
// .wrangler state.

export type CloudEnvName = "prod" | "staging";

export interface CloudEnv {
	name: CloudEnvName;
	// Splices into wrangler arg arrays: [] for prod (top-level config),
	// ["--env", "staging"] for staging.
	wranglerEnvFlag: string[];
	// D1 database_name and R2 bucket_name — must match the corresponding
	// wrangler.toml blocks (top-level for prod, [env.staging] for staging).
	dbName: string;
	r2Bucket: string;
	frontendOrigin: string;
	apiOrigin: string;
	apiBase: string;
	// The legacy share viewer (web/) is frozen and has no staging deployment.
	legacyOrigin: string | null;
	// Extra process env exported when building the frontend for this
	// environment. Empty for prod: the code defaults in src/lib/api-cloud.ts
	// and src/lib/page-meta.ts already point at production, so a bare
	// `npm run build` is a correct prod build.
	frontendBuildEnv: Record<string, string>;
	// Whether deploys write CHANGELOG.md / bump version / tag. Prod-only
	// release bookkeeping; staging deploys are throwaway.
	runsChangelog: boolean;
	// Whether this environment's data is throwaway — destroyed and replaced
	// wholesale by `reclone` (and the natural gate for any future tooling
	// that treats the env as a fixture target, e.g. seed --staging). Never
	// true for prod.
	disposableData: boolean;
}

export const ENVIRONMENTS: Record<CloudEnvName, CloudEnv> = {
	prod: {
		name: "prod",
		wranglerEnvFlag: [],
		dbName: "per-ankh-share-index",
		r2Bucket: "per-ankh-shares",
		frontendOrigin: "https://per-ankh.app",
		apiOrigin: "https://api.per-ankh.app",
		apiBase: "https://api.per-ankh.app/v1",
		legacyOrigin: "https://legacy.per-ankh.app",
		frontendBuildEnv: {},
		runsChangelog: true,
		disposableData: false,
	},
	staging: {
		name: "staging",
		wranglerEnvFlag: ["--env", "staging"],
		dbName: "per-ankh-share-index-staging",
		r2Bucket: "per-ankh-shares-staging",
		frontendOrigin: "https://staging.per-ankh.app",
		apiOrigin: "https://api-staging.per-ankh.app",
		apiBase: "https://api-staging.per-ankh.app/v1",
		legacyOrigin: null,
		frontendBuildEnv: {
			VITE_API_URL: "https://api-staging.per-ankh.app/v1",
			VITE_PUBLIC_ORIGIN: "https://staging.per-ankh.app",
		},
		runsChangelog: false,
		disposableData: true,
	},
};

export function getEnv(name: CloudEnvName): CloudEnv {
	return ENVIRONMENTS[name];
}
