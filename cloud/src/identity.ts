// The display name shown for a user across the API: an operator-set `alias`
// overrides the Discord-sourced `display_name`. `t` is the table alias used in
// the surrounding query (e.g. "u", "users"). Alias the result back to
// display_name so response shapes/types stay unchanged.
export const displayNameSql = (t: string): string =>
	`COALESCE(${t}.alias, ${t}.display_name)`;
