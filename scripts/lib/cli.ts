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

export function flagString(
	flags: Record<string, string | true>,
	name: string,
): string | undefined {
	const v = flags[name];
	return typeof v === "string" ? v : undefined;
}

export function printJson(data: unknown): void {
	process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}
