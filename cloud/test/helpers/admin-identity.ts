// The Discord id the integration Worker treats as the site admin.
//
// isSiteAdmin (cloud/src/admin.ts) matches users.discord_id against the
// ADMIN_DISCORD_ID secret, so admin-only endpoints are untestable unless the
// isolate has one bound. vitest.config.mts binds this value and makeSiteAdmin()
// creates the matching user — both import it from here so they can't drift.
//
// Deliberately outside makeUser's counter range (which starts at 1e18) so no
// incidentally-created test user is ever a site admin.
export const SITE_ADMIN_DISCORD_ID = "999999999999999999";

// The ADMIN_CLI_TOKEN the integration Worker is bound with.
//
// siteAdminFromCliToken (cloud/src/admin.ts) is the headless half of the same
// gate, so the token path is untestable unless the isolate has one bound.
// vitest.config.mts binds this value; tests send it as `Bearer`. Bound here
// rather than read from cloud/.dev.vars — that file is gitignored and these
// tests must pass on a fresh checkout, the same reason SSR_TRUSTED_TEST_KEY
// lives in ssr-identity.ts.
export const ADMIN_CLI_TEST_TOKEN = "test-admin-cli-token";
