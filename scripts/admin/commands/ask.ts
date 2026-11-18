// `./per-ankh admin ask <status|off|on>` — the off switch for the Explore ask
// endpoint (POST /v1/query/ask, issue #380).
//
// The switch is one SESSIONS_KV key, ASK_DISABLED_KEY (cloud/src/query/ask.ts).
// A missing key means on and a present key means off. This command writes and
// deletes that key and no other: SESSIONS_KV also holds every `session:` and
// `oauth:` key, so, as with `admin cache`, the key name is fixed here rather
// than taken from the command line.
//
// KV changes can take 60 seconds or more to reach every location, so a toggle
// is in effect everywhere within about a minute.

import { ASK_DISABLED_KEY } from "../../../cloud/src/query/ask";
import { confirmYesNo } from "../../lib/confirm";
import { type CommandOpts, printJson } from "../../lib/cli";
import { info, ok, warn } from "../../lib/format";
import { getTarget, kvBulkDelete, kvList, kvPut } from "../wrangler";

export async function run(argv: string[], opts: CommandOpts): Promise<void> {
	switch (argv[0]) {
		case "status":
			return runStatus(opts);
		case "off":
			return runOff(opts);
		case "on":
			return runOn(opts);
		case undefined:
		case "--help":
		case "-h":
			printHelp();
			return;
		default:
			throw new Error(`Unknown ask subcommand: ${argv[0]}`);
	}
}

function printHelp(): void {
	process.stdout.write(
		[
			"./per-ankh admin ask <subcommand>",
			"",
			"  status   Show whether the Explore ask input is on or off",
			"  off      Switch it off: the endpoint refuses before calling the model",
			"  on       Switch it back on",
			"",
			`The switch is the SESSIONS_KV key ${ASK_DISABLED_KEY}; no other key is`,
			"touched. A change reaches every location within about a minute. The",
			"Explore builder keeps working either way.",
			"",
		].join("\n"),
	);
}

// Whether the key exists. Listed by prefix rather than read, because a list
// answers "is it there" without depending on what the value says.
async function isOff(): Promise<boolean> {
	const keys = await kvList(ASK_DISABLED_KEY);
	return keys.some((k) => k.name === ASK_DISABLED_KEY);
}

async function runStatus(opts: CommandOpts): Promise<void> {
	const off = await isOff();
	if (opts.json) {
		printJson({ target: getTarget(), ask: off ? "off" : "on" });
		return;
	}
	info(`Explore ask on ${getTarget()}: ${off ? "OFF" : "on"}`);
}

async function runOff(opts: CommandOpts): Promise<void> {
	if (await isOff()) {
		warn(`Explore ask is already off on ${getTarget()}.`);
		return;
	}
	if (
		!opts.yes &&
		!(await confirmYesNo(`Switch Explore ask OFF on ${getTarget()}?`))
	) {
		warn("Aborted.");
		return;
	}
	// The value records when it was switched off. The endpoint reads only
	// whether the key exists.
	await kvPut(ASK_DISABLED_KEY, new Date().toISOString());
	ok(
		`Explore ask switched off on ${getTarget()}. Every location within about a minute.`,
	);
}

async function runOn(opts: CommandOpts): Promise<void> {
	if (!(await isOff())) {
		warn(`Explore ask is already on on ${getTarget()}.`);
		return;
	}
	if (
		!opts.yes &&
		!(await confirmYesNo(`Switch Explore ask back ON on ${getTarget()}?`))
	) {
		warn("Aborted.");
		return;
	}
	await kvBulkDelete([ASK_DISABLED_KEY]);
	ok(
		`Explore ask switched on on ${getTarget()}. Every location within about a minute.`,
	);
}
