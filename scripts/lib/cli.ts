// Shared CLI types and a minimal flag parser. Commands receive their
// post-subcommand argv slice plus a CommandOpts carrying global flags.

export interface CommandOpts {
	json: boolean;
	yes: boolean;
}

export interface ParsedFlags {
	positional: string[];
	flags: Record<string, string | true>;
}

// Parse argv: a token starting with `--` consumes the next token as its
// value (unless that next token is another flag or end-of-args, in which
// case the flag is boolean true). Everything else is positional.
//
// Intentionally minimal — no short flags, no `--key=value`, no array values.
// If we outgrow this, swap in a real parser.
export function parseFlags(argv: string[]): ParsedFlags {
	const positional: string[] = [];
	const flags: Record<string, string | true> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith("--")) {
			const name = a.slice(2);
			const next = argv[i + 1];
			if (next != null && !next.startsWith("--")) {
				flags[name] = next;
				i++;
			} else {
				flags[name] = true;
			}
		} else {
			positional.push(a);
		}
	}
	return { positional, flags };
}

export function flagInt(
	flags: Record<string, string | true>,
	name: string,
	fallback: number,
): number {
	const v = flags[name];
	if (v === undefined || v === true) return fallback;
	const n = parseInt(v, 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

// A flag that must be a positive integer when it is given, or undefined when
// it is absent. flagInt falls back for a bare `--flag`, `--flag 0` and
// `--flag abc`. For a cap or a sample size that fallback runs something the
// operator didn't ask for: a LIMIT 0 that reports "nothing to do", or the
// default sample. So this refuses instead.
export function flagPositiveInt(
	flags: Record<string, string | true>,
	name: string,
): number | undefined {
	if (flags[name] === undefined) return undefined;
	const n = flagInt(flags, name, 0);
	if (n <= 0) throw new Error(`--${name} takes a positive integer`);
	return n;
}

// An empty value reads as absent, so a `?? fallback` at the call site fires
// for `--flag ""` the way it does for an omitted flag. That shape arrives from
// CI, not from a typo: `gh workflow run ... -f base-url=` passes the input
// through as an empty string, and every caller here either falls back or
// treats the flag as an optional filter — none of them wants "".
export function flagString(
	flags: Record<string, string | true>,
	name: string,
): string | undefined {
	const v = flags[name];
	return typeof v === "string" && v !== "" ? v : undefined;
}

export function printJson(data: unknown): void {
	process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}
