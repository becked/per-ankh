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
	// The screenshots bucket (issue #289) and the public R2 custom domain in
	// front of it. A second bucket rather than a prefix in r2Bucket, because
	// this one is public: the same domain over the shares bucket would expose
	// every save blob and ZIP by key. The host is here as well as in the
	// Worker's SCREENSHOT_BASE_URL because deleting a game's screenshots from
	// the CLI has to purge their URLs, and the objects are edge-cached with no
	// Worker in the image path to re-evaluate anything.
	screenshotBucket: string;
	imageHost: string;
	frontendOrigin: string;
	apiOrigin: string;
	apiBase: string;
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
		screenshotBucket: "per-ankh-screenshots",
		imageHost: "https://img.per-ankh.app",
		frontendOrigin: "https://per-ankh.app",
		apiOrigin: "https://api.per-ankh.app",
		apiBase: "https://api.per-ankh.app/v1",
		frontendBuildEnv: {},
		runsChangelog: true,
		disposableData: false,
	},
	staging: {
		name: "staging",
		wranglerEnvFlag: ["--env", "staging"],
		dbName: "per-ankh-share-index-staging",
		r2Bucket: "per-ankh-shares-staging",
		screenshotBucket: "per-ankh-screenshots-staging",
		imageHost: "https://img.staging.per-ankh.app",
		frontendOrigin: "https://staging.per-ankh.app",
		apiOrigin: "https://api-staging.per-ankh.app",
		apiBase: "https://api-staging.per-ankh.app/v1",
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
