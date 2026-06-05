// Central CLI for the per-ankh cloud app (Worker + SvelteKit).
// Invoked via the `per-ankh` bash shim at repo root: `./per-ankh <command>`.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { main as adminMain } from "./admin/index";
import { prodMain, stagingMain } from "./prod/index";
import { main as backupMain } from "./backup";

// scripts/per-ankh.ts → repo root is one level up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Color = "cyan" | "magenta";
const COLORS: Record<Color, string> = {
	cyan: "\x1b[36m",
	magenta: "\x1b[35m",
};
const RESET = "\x1b[0m";

function makePrefixer(label: string, color: Color, stream: NodeJS.WriteStream) {
	const useColor = stream.isTTY;
	const prefix = useColor
		? `${COLORS[color]}[${label}]${RESET} `
		: `[${label}] `;
	let leftover = "";
	return {
		write(chunk: Buffer) {
			const text = leftover + chunk.toString("utf8");
			const lines = text.split("\n");
			leftover = lines.pop() ?? "";
			for (const line of lines) stream.write(`${prefix}${line}\n`);
		},
		flush() {
			if (leftover.length > 0) {
				stream.write(`${prefix}${leftover}\n`);
				leftover = "";
			}
		},
	};
}

interface ChildSpec {
	label: string;
	color: Color;
	cwd: string;
	command: string;
	args: string[];
	env?: NodeJS.ProcessEnv;
}

function startChild(spec: ChildSpec): ChildProcess {
	if (!existsSync(spec.command)) {
		process.stderr.write(
			`[${spec.label}] missing binary: ${spec.command}\n` +
				`[${spec.label}] run \`npm install\` in ${spec.cwd} first.\n`,
		);
		process.exit(1);
	}
	const child = spawn(spec.command, spec.args, {
		cwd: spec.cwd,
		stdio: ["ignore", "pipe", "pipe"],
		shell: false,
		env: spec.env ?? process.env,
	});
	const out = makePrefixer(spec.label, spec.color, process.stdout);
	const err = makePrefixer(spec.label, spec.color, process.stderr);
	child.stdout?.on("data", (c: Buffer) => out.write(c));
	child.stderr?.on("data", (c: Buffer) => err.write(c));
	child.on("close", () => {
		out.flush();
		err.flush();
	});
	return child;
}

function cmdDev(): never {
	// Spawn the underlying binaries directly rather than going through `npm run`.
	// `npm` may not resolve under spawn() with shell:false (e.g. when managed
	// by nvm/fnm/Volta), so we skip the indirection. The npm scripts these
	// replicate are: cloud/package.json "dev" → wrangler dev, root
	// package.json "dev" → vite dev.
	const specs: ChildSpec[] = [
		{
			label: "worker",
			color: "cyan",
			cwd: resolve(REPO_ROOT, "cloud"),
			command: resolve(REPO_ROOT, "cloud/node_modules/.bin/wrangler"),
			args: ["dev"],
		},
		{
			label: "web",
			color: "magenta",
			cwd: REPO_ROOT,
			command: resolve(REPO_ROOT, "node_modules/.bin/vite"),
			args: ["dev"],
			// Read by svelte.config.js to widen the CSP's connect-src to
			// include http://localhost:8787 (the wrangler dev worker).
			// Without this, the browser blocks every cloudApi call. argv-
			// based detection in svelte.config.js was unreliable across
			// Vite's various config-loading paths; an explicit env var
			// removes the ambiguity.
			env: { ...process.env, PER_ANKH_DEV: "1" },
		},
	];

	const children = specs.map(startChild);
	let shuttingDown = false;
	let exitCode = 0;

	const shutdown = (signal: NodeJS.Signals | null, code: number) => {
		if (shuttingDown) return;
		shuttingDown = true;
		exitCode = code;
		for (const c of children) {
			if (c.exitCode === null && c.signalCode === null) {
				c.kill("SIGTERM");
			}
		}
		setTimeout(() => {
			for (const c of children) {
				if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
			}
		}, 5000).unref();
	};

	process.on("SIGINT", () => shutdown("SIGINT", 130));
	process.on("SIGTERM", () => shutdown("SIGTERM", 143));

	for (const child of children) {
		child.on("exit", (code, signal) => {
			const childCode = code ?? (signal ? 1 : 0);
			shutdown(null, childCode);
		});
	}

	process.on("exit", () => {
		// Last-resort cleanup if anything is still alive.
		for (const c of children) {
			if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
		}
	});

	// Wait for both children to fully exit before exiting parent.
	let remaining = children.length;
	for (const child of children) {
		child.on("close", () => {
			remaining -= 1;
			if (remaining === 0) process.exit(exitCode);
		});
	}

	// Block forever; exit happens via the close handler above.
	return new Promise<never>(() => {}) as never;
}

function printHelp(): void {
	process.stdout.write(
		[
			"per-ankh — central CLI for the cloud-based per-ankh app",
			"",
			"Usage:",
			"  ./per-ankh <command>",
			"",
			"Commands:",
			"  dev               Run Worker (:8787) + SvelteKit (:1420) locally, foreground.",
			"  admin <sub>...    Cloud admin & monitoring (see `./per-ankh admin --help`).",
			"  prod <sub>...     Production deploy & preflight (see `./per-ankh prod --help`).",
			"  staging <sub>...  Staging deploy & preflight (see `./per-ankh staging --help`).",
			"  backup [--local]  Snapshot D1 to a .sql + .sqlite file (see `./per-ankh backup --help`).",
			"  --help,-h         Show this help.",
			"",
			"Preconditions for `dev`:",
			"  - npm install run in repo root and cloud/",
			"  - cloud/wrangler.toml SESSIONS_KV ids filled in",
			"  - cloud/.dev.vars has DISCORD_CLIENT_SECRET",
			"  - D1 migrations applied: (cd cloud && npm run migrate:local)",
			"",
		].join("\n"),
	);
}

async function main(): Promise<void> {
	const cmd = process.argv[2];
	switch (cmd) {
		case "dev":
			cmdDev();
			return;
		case "admin":
			await adminMain(process.argv.slice(3));
			return;
		case "prod":
			await prodMain(process.argv.slice(3));
			return;
		case "staging":
			await stagingMain(process.argv.slice(3));
			return;
		case "backup":
			await backupMain(process.argv.slice(3));
			return;
		case "--help":
		case "-h":
		case undefined:
			printHelp();
			process.exit(cmd === undefined ? 1 : 0);
		// eslint-disable-next-line no-fallthrough
		default:
			process.stderr.write(`Unknown command: ${cmd}\n\n`);
			printHelp();
			process.exit(1);
	}
}

main().catch((e: unknown) => {
	const msg = e instanceof Error ? e.message : String(e);
	process.stderr.write(`\n${msg}\n`);
	process.exit(1);
});
