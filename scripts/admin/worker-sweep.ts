// What the corpus sweeps that write through the Worker share: `reparse-all`
// (POST /v1/admin/games/:user_id/reparse-upload) and `reindex-all`
// (POST /v1/admin/games/:id/reindex).
//
// Both read their selection out of D1 through wrangler like every other admin
// command, and both hand each write to the Worker, because the write runs the
// Worker's own D1 pivot and a copy of it here would diverge. The CLI has no
// session, so those two endpoints also accept ADMIN_CLI_TOKEN as a bearer
// token (siteAdminActor, cloud/src/admin.ts). Every other admin route stays
// session-only.

import { isLocal } from "./wrangler";
import { DEV_VARS_PATH, readDotVars } from "../lib/dotvars";
import { warn } from "../lib/format";

// The credential, by the same split purge.ts documents: committed config comes
// from the environment table, a secret comes from the process environment,
// because the CLI has no secret store of its own and the Worker holds its own
// copy as a `wrangler secret`. Same name on both sides so there is no
// translation to remember.
export const ADMIN_CLI_TOKEN_ENV = "ADMIN_CLI_TOKEN";

export function resolveAdminCliToken(): string | null {
	const fromEnv = process.env[ADMIN_CLI_TOKEN_ENV];
	if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
	// Local only: `wrangler dev` loads cloud/.dev.vars, so the Worker's token
	// is already written down there. Reading it is what keeps a local sweep
	// from 404ing because the operator exported a different value than the
	// Worker is running with — the same reason scripts/ux-review/discover.ts
	// reads ADMIN_DISCORD_ID from that file. Never for a remote target: there
	// the file has no authority over what the deployed Worker holds.
	if (isLocal()) {
		const fromDotVars = readDotVars(DEV_VARS_PATH)[ADMIN_CLI_TOKEN_ENV];
		if (fromDotVars) return fromDotVars;
	}
	return null;
}

// The refusal when no token resolved. The caller sets the exit code.
export function warnNoAdminCliToken(): void {
	warn(
		`${ADMIN_CLI_TOKEN_ENV} is not set. The sweep posts each game to the ` +
			`Worker, which accepts a sessionless admin only with this token:\n` +
			`  export ${ADMIN_CLI_TOKEN_ENV}=…   (the value set via ` +
			`\`wrangler secret put ${ADMIN_CLI_TOKEN_ENV}\`)\n` +
			(isLocal()
				? `  or put it in cloud/.dev.vars, which \`./per-ankh dev\` loads.\n`
				: "") +
			`Re-run with --dry-run to see what it would touch without it.`,
	);
}

// A rejected admin is answered with a 404, so the route's existence doesn't
// leak. Each sweep appends what else its endpoint's 404 can mean.
export const ADMIN_AUTH_REJECTED =
	`admin auth rejected (is ${ADMIN_CLI_TOKEN_ENV} the value the Worker ` +
	`holds, and has that Discord account signed in?)`;

// A game's label in a sweep's tables: the owner's rename first, the way
// handleAdminListAllGames does it.
export function gameLabel(g: {
	game_id: string;
	game_name: string | null;
	display_name: string | null;
}): string {
	return g.display_name ?? g.game_name ?? g.game_id;
}
