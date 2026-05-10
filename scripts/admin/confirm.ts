// Interactive confirmation prompts. Read from stdin, write the prompt to
// stderr so prompts stay visible when stdout is piped or in --json mode.

import { createInterface } from "node:readline";

function ask(prompt: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stderr });
	return new Promise((res) => {
		rl.question(prompt, (a) => {
			rl.close();
			res(a.trim());
		});
	});
}

export async function confirmYesNo(prompt: string): Promise<boolean> {
	const a = await ask(`${prompt} [y/N] `);
	return a === "y" || a === "Y";
}

// Destructive-op confirmation: requires the operator to type the literal
// word "nuke".
export async function confirmNuke(prompt: string): Promise<boolean> {
	process.stderr.write(`${prompt}\n`);
	const a = await ask(`Type 'nuke' to confirm: `);
	return a === "nuke";
}
