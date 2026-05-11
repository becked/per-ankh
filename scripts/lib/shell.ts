// Spawn helpers for the operator CLIs.
//
// runStreamed:  long-running commands (wrangler deploy, npm run build, npm
//               run check) where the operator wants live progress. Streams
//               stdout+stderr with an optional [label] prefix.
// runCaptured:  short commands where we need to parse stdout (wrangler
//               secret list --json, git rev-parse). stderr still streams
//               to the operator so failures aren't silent.

import { spawn } from "node:child_process";

type Color = "cyan" | "magenta" | "yellow" | "green";

const COLORS: Record<Color, string> = {
	cyan: "\x1b[36m",
	magenta: "\x1b[35m",
	yellow: "\x1b[33m",
	green: "\x1b[32m",
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

export interface RunOpts {
	cwd?: string;
	label?: string;
	color?: Color;
	env?: NodeJS.ProcessEnv;
}

// Stream stdout+stderr live with optional [label] prefix. Resolves with the
// exit code; does NOT throw on non-zero exit — callers decide what to do.
export function runStreamed(
	cmd: string,
	args: string[],
	opts: RunOpts = {},
): Promise<number> {
	return new Promise((res, rej) => {
		const child = spawn(cmd, args, {
			cwd: opts.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
			env: opts.env ?? process.env,
		});
		const label = opts.label ?? cmd;
		const color = opts.color ?? "cyan";
		const out = makePrefixer(label, color, process.stdout);
		const err = makePrefixer(label, color, process.stderr);
		child.stdout?.on("data", (c: Buffer) => out.write(c));
		child.stderr?.on("data", (c: Buffer) => err.write(c));
		child.on("error", rej);
		child.on("close", (code) => {
			out.flush();
			err.flush();
			res(code ?? 0);
		});
	});
}

export interface CapturedResult {
	stdout: string;
	stderr: string;
	code: number;
}

// Capture stdout/stderr separately for parsing. Resolves regardless of exit
// code; check `code` for success.
export function runCaptured(
	cmd: string,
	args: string[],
	opts: RunOpts = {},
): Promise<CapturedResult> {
	return new Promise((res, rej) => {
		const child = spawn(cmd, args, {
			cwd: opts.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
			env: opts.env ?? process.env,
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (c: Buffer) => {
			stdout += c.toString("utf8");
		});
		child.stderr?.on("data", (c: Buffer) => {
			stderr += c.toString("utf8");
		});
		child.on("error", rej);
		child.on("close", (code) => res({ stdout, stderr, code: code ?? 0 }));
	});
}
