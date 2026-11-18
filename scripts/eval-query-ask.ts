// The Explore ask eval (issue #380): runs the test set in
// scripts/eval-query-ask-questions.ts through Workers AI and reports, per model
// and reasoning effort, how many questions came back right and what each one
// cost.
//
// The ask endpoint's model and effort (ASK_MODEL, ASK_REASONING_EFFORT) and
// its three hourly ceilings come from this report. The request is not written
// here: the prompt, the tool, the retry and the checks are imported from
// cloud/src/query/ask.ts, the module the endpoint calls the model through. An
// edit to the prompt or the tool invalidates the numbers, and re-running this
// is how the new ones are found.
//
// A question passes when the ask path's outcome is the expected one: one of
// its canonical selections, an "unsupported" reply, or a refusal. Player and tournament names resolve against the fixture rosters in
// the test set, not against D1.
//
// COST is computed from each response's `usage`, with every input token priced
// as uncached. Cached input costs 1/50 of uncached on Flash and 1/30 on Pro,
// and Workers AI documents no cache lifetime, so a ceiling sized on the cached
// price could be off by that factor. The cached-token count is reported beside
// it. A retry is a second call and a second cost, which is what the endpoint
// charges against the limits too.
//
// AUTH: the Workers AI REST API with CLOUDFLARE_ACCOUNT_ID and
// CLOUDFLARE_AI_TOKEN (Workers AI Read and Edit), from the environment or the
// gitignored .env, as `npm run eval:screenshots` reads them. `--dry-run` needs
// neither and makes no call.
//
// Run: npm run eval:ask -- [--dry-run] [--model flash|pro] [--effort none,low]
//                          [--repeat n] [--only id] [--concurrency n] [--json]

import "dotenv/config";

import {
	ASK_MODELS,
	ASK_SESSION_AFFINITY,
	ASK_SYSTEM_PROMPT,
	ASK_TOOL,
	REASONING_EFFORTS,
	askQuestion,
	type AskModelInputs,
	type AskOutcome,
	type ReasoningEffort,
} from "../cloud/src/query/ask";
import { canonicalSelection, parseSelection } from "../cloud/src/query/select";
import {
	FIXTURE_PLAYERS,
	FIXTURE_TOURNAMENTS,
	QUESTIONS,
	type EvalQuestion,
	type Expected,
} from "./eval-query-ask-questions";
import { flagInt, flagString, parseFlags, printJson } from "./lib/cli";
import { bold, dim, info, printTable, warn, type Column } from "./lib/format";

type ModelName = keyof typeof ASK_MODELS;

// USD per million tokens, from the model pages (issue #380 records them).
const PRICES: Record<
	ModelName,
	{ input: number; output: number; cachedInput: number }
> = {
	flash: { input: 0.3, output: 1.2, cachedInput: 0.006 },
	pro: { input: 1.32, output: 3.96, cachedInput: 0.044 },
};

// ─── The model call ─────────────────────────────────────────────────────────

function requireEnv(name: string): string {
	const v = process.env[name];
	if (v == null || v.trim() === "") {
		throw new Error(
			`${name} is not set. The eval needs CLOUDFLARE_ACCOUNT_ID and a ` +
				`CLOUDFLARE_AI_TOKEN with Workers AI Read and Edit, in the environment or ` +
				`in .env (gitignored). Use --dry-run to check the test set without either.`,
		);
	}
	return v.trim();
}

interface ApiEnvelope {
	success?: boolean;
	result?: unknown;
	errors?: { code?: number; message?: string }[];
}

// Workers AI answers 429 once the account's per-minute inference rate is
// reached. Four calls in flight reached it, so the waits are long enough for a
// minute's window to move.
const RETRY_DELAYS_MS = [5000, 15000, 30000, 60000];

async function runModel(
	model: string,
	inputs: AskModelInputs,
	accountId: string,
	token: string,
): Promise<unknown> {
	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
	let lastError = "";
	for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
		if (attempt > 0) {
			await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
		}
		let res: Response;
		try {
			res = await fetch(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
					"x-session-affinity": ASK_SESSION_AFFINITY,
				},
				body: JSON.stringify(inputs),
			});
		} catch (e) {
			lastError = e instanceof Error ? e.message : String(e);
			continue;
		}
		const text = await res.text();
		// 429 and 5xx are worth another attempt. A 400 or a 403 is the request
		// or the token, and fails the same way every time.
		if (res.status === 429 || res.status >= 500) {
			lastError = `HTTP ${res.status}: ${text.slice(0, 300)}`;
			continue;
		}
		if (!res.ok) throw new Error(`${model}: HTTP ${res.status}: ${text}`);
		let envelope: ApiEnvelope;
		try {
			envelope = JSON.parse(text) as ApiEnvelope;
		} catch {
			throw new Error(`${model}: response was not JSON: ${text.slice(0, 300)}`);
		}
		if (!envelope.success || envelope.result == null) {
			const msg = (envelope.errors ?? [])
				.map((e) => `${e.code ?? "?"} ${e.message ?? ""}`.trim())
				.join("; ");
			throw new Error(`${model}: ${msg || text.slice(0, 300)}`);
		}
		return envelope.result;
	}
	throw new Error(
		`${model}: giving up after ${RETRY_DELAYS_MS.length + 1} attempts: ${lastError}`,
	);
}

// ─── Scoring ────────────────────────────────────────────────────────────────

function passes(expected: Expected, outcome: AskOutcome): boolean {
	if ("selections" in expected) {
		return (
			outcome.kind === "selection" &&
			expected.selections.includes(outcome.canonical)
		);
	}
	if ("unsupported" in expected) return outcome.kind === "unsupported";
	return outcome.kind !== "selection";
}

function expectedLabel(expected: Expected): string {
	if ("selections" in expected) return expected.selections[0];
	if ("unsupported" in expected) return "unsupported";
	return "refused";
}

function outcomeLabel(outcome: AskOutcome): string {
	switch (outcome.kind) {
		case "selection":
			return outcome.canonical;
		case "unsupported":
			return `unsupported: ${outcome.reason}`;
		case "failed":
			return `failed: ${outcome.message}`;
	}
}

interface QuestionRun {
	model: ModelName;
	effort: ReasoningEffort;
	id: string;
	pass: boolean;
	outcome: string;
	expected: string;
	attempts: number;
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	costUncached: number;
	ms: number;
	error?: string;
}

function cost(model: ModelName, input: number, output: number): number {
	const p = PRICES[model];
	return (input * p.input + output * p.output) / 1e6;
}

async function runOne(
	model: ModelName,
	effort: ReasoningEffort,
	q: EvalQuestion,
	accountId: string,
	token: string,
	today: string,
): Promise<QuestionRun> {
	const started = Date.now();
	const base = {
		model,
		effort,
		id: q.id,
		expected: expectedLabel(q.expected),
	};
	try {
		const outcome = await askQuestion(q.question, {
			callModel: (inputs) =>
				runModel(ASK_MODELS[model], inputs, accountId, token),
			loadRoster: async (vocabulary) =>
				vocabulary === "player" ? FIXTURE_PLAYERS : FIXTURE_TOURNAMENTS,
			today,
			effort,
		});
		const input = outcome.usage.reduce((n, u) => n + u.inputTokens, 0);
		const cached = outcome.usage.reduce((n, u) => n + u.cachedInputTokens, 0);
		const output = outcome.usage.reduce((n, u) => n + u.outputTokens, 0);
		return {
			...base,
			pass: passes(q.expected, outcome),
			outcome: outcomeLabel(outcome),
			attempts: outcome.attempts,
			inputTokens: input,
			cachedInputTokens: cached,
			outputTokens: output,
			costUncached: cost(model, input, output),
			ms: Date.now() - started,
		};
	} catch (e) {
		return {
			...base,
			pass: false,
			outcome: "error",
			attempts: 0,
			inputTokens: 0,
			cachedInputTokens: 0,
			outputTokens: 0,
			costUncached: 0,
			ms: Date.now() - started,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

// One call in flight by default. Four reached the account's per-minute
// inference rate, and a 429 that outlasts the retries scores as an error.
const DEFAULT_CONCURRENCY = 1;

async function pool<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	async function worker(): Promise<void> {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]);
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, worker),
	);
	return out;
}

// ─── The test set's own check ───────────────────────────────────────────────

// Every expected selection must parse and already be canonical. A typo in the
// test set would otherwise fail every model the same way and read as a model
// failure.
function checkTestSet(): string[] {
	const problems: string[] = [];
	const ids = new Set<string>();
	for (const q of QUESTIONS) {
		if (ids.has(q.id)) problems.push(`${q.id}: duplicate id`);
		ids.add(q.id);
		if (!("selections" in q.expected)) continue;
		for (const s of q.expected.selections) {
			const parsed = parseSelection(new URLSearchParams(s));
			if (!parsed.ok) {
				problems.push(`${q.id}: ${parsed.message}: ${s}`);
				continue;
			}
			const canonical = canonicalSelection(parsed.selection);
			if (canonical !== s) {
				problems.push(`${q.id}: not canonical. Expected ${canonical}`);
			}
		}
	}
	return problems;
}

// ─── Report ─────────────────────────────────────────────────────────────────

function usd(n: number): string {
	return `$${n.toFixed(5)}`;
}

function summarize(runs: QuestionRun[]): void {
	const groups = new Map<string, QuestionRun[]>();
	for (const r of runs) {
		const key = `${r.model}/${r.effort}`;
		groups.set(key, [...(groups.get(key) ?? []), r]);
	}
	const cols: Column[] = [
		{ header: "MODEL/EFFORT", width: 14 },
		{ header: "PASS", width: 7, align: "right" },
		{ header: "SEL", width: 5, align: "right" },
		{ header: "UNSUP", width: 5, align: "right" },
		{ header: "ERR", width: 4, align: "right" },
		{ header: "RETRY", width: 5, align: "right" },
		{ header: "IN/Q", width: 7, align: "right" },
		{ header: "CACHED/Q", width: 8, align: "right" },
		{ header: "OUT/Q", width: 6, align: "right" },
		{ header: "MEAN $/Q", width: 10, align: "right" },
		{ header: "MAX $/Q", width: 10, align: "right" },
		{ header: "P50 MS", width: 7, align: "right" },
	];
	const rows: string[][] = [];
	for (const [key, group] of groups) {
		const ok = group.filter((r) => !r.error);
		const n = Math.max(ok.length, 1);
		const byKind = (kind: "selections" | "unsupported") =>
			group.filter((r) => {
				const q = QUESTIONS.find((x) => x.id === r.id);
				return q != null && kind in q.expected && r.pass;
			}).length;
		const total = (kind: "selections" | "unsupported") =>
			group.filter((r) => {
				const q = QUESTIONS.find((x) => x.id === r.id);
				return q != null && kind in q.expected;
			}).length;
		const ms = [...ok.map((r) => r.ms)].sort((a, b) => a - b);
		rows.push([
			key,
			`${group.filter((r) => r.pass).length}/${group.length}`,
			`${byKind("selections")}/${total("selections")}`,
			`${byKind("unsupported")}/${total("unsupported")}`,
			String(group.length - ok.length),
			String(ok.filter((r) => r.attempts > 1).length),
			String(Math.round(ok.reduce((s, r) => s + r.inputTokens, 0) / n)),
			String(Math.round(ok.reduce((s, r) => s + r.cachedInputTokens, 0) / n)),
			String(Math.round(ok.reduce((s, r) => s + r.outputTokens, 0) / n)),
			usd(ok.reduce((s, r) => s + r.costUncached, 0) / n),
			usd(Math.max(0, ...ok.map((r) => r.costUncached))),
			String(ms[Math.floor(ms.length / 2)] ?? 0),
		]);
	}
	process.stdout.write("\n");
	printTable(cols, rows);
	process.stdout.write(
		dim(
			"\n$/Q prices every input token as uncached and includes the retry where one ran.\n",
		),
	);
}

function printFailures(runs: QuestionRun[]): void {
	const failed = runs.filter((r) => !r.pass);
	if (failed.length === 0) return;
	process.stdout.write(`\n${bold("Misses")}\n`);
	for (const r of failed) {
		process.stdout.write(
			`  ${r.model}/${r.effort} ${bold(r.id)} (${r.attempts} call${r.attempts === 1 ? "" : "s"})\n` +
				`    expected ${r.expected}\n` +
				`    got      ${r.error ? `error: ${r.error}` : r.outcome}\n`,
		);
	}
}

// ─── Main ───────────────────────────────────────────────────────────────────

function printHelp(): void {
	process.stdout.write(
		[
			"npm run eval:ask -- [flags]",
			"",
			"  --dry-run          Check the test set and print the prompt size; no API calls",
			"  --model M          flash | pro (default: both)",
			"  --effort E[,E]     Reasoning efforts to try: none, low, high, max (default: none,low)",
			"  --repeat N         Run each question N times (default 1)",
			"  --only ID          Run one question",
			"  --concurrency N    Calls in flight at once (default 1)",
			"  --json             Print every run as JSON",
			"",
			"Credentials: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN (Workers AI Read + Edit).",
			"",
		].join("\n"),
	);
}

async function main(): Promise<void> {
	const { flags } = parseFlags(process.argv.slice(2));
	if (flags.help === true) {
		printHelp();
		return;
	}

	const problems = checkTestSet();
	if (problems.length > 0) {
		for (const p of problems) warn(p);
		throw new Error(`The test set has ${problems.length} problem(s)`);
	}

	const promptChars = ASK_SYSTEM_PROMPT.length;
	const toolChars = JSON.stringify(ASK_TOOL).length;
	if (flags["dry-run"] === true) {
		info(
			`Test set: ${QUESTIONS.length} questions, every expected selection canonical.`,
		);
		info(`System prompt: ${promptChars} characters. Tool: ${toolChars}.`);
		return;
	}

	const modelFlag = flagString(flags, "model");
	const models: ModelName[] = modelFlag
		? [modelFlag as ModelName]
		: ["flash", "pro"];
	for (const m of models) {
		if (!(m in ASK_MODELS)) throw new Error(`Unknown model: ${m}`);
	}
	const efforts = (flagString(flags, "effort") ?? "none,low").split(
		",",
	) as ReasoningEffort[];
	for (const e of efforts) {
		if (!REASONING_EFFORTS.includes(e)) {
			throw new Error(`Unknown effort: ${e}`);
		}
	}
	const repeats = flagInt(flags, "repeat", 1);
	const only = flagString(flags, "only");
	const questions = only ? QUESTIONS.filter((q) => q.id === only) : QUESTIONS;
	if (questions.length === 0) throw new Error(`No question with id ${only}`);

	const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
	const token = requireEnv("CLOUDFLARE_AI_TOKEN");
	const today = new Date().toISOString().slice(0, 10);

	const plan: { model: ModelName; effort: ReasoningEffort; q: EvalQuestion }[] =
		[];
	for (const model of models) {
		for (const effort of efforts) {
			for (let i = 0; i < repeats; i++) {
				for (const q of questions) plan.push({ model, effort, q });
			}
		}
	}
	info(
		`${plan.length} questions: ${models.join(", ")} × ${efforts.join(", ")} × ${repeats} × ${questions.length}. ` +
			`System prompt ${promptChars} characters.`,
	);

	const concurrency = flagInt(flags, "concurrency", DEFAULT_CONCURRENCY);
	const runs = await pool(plan, concurrency, (p) =>
		runOne(p.model, p.effort, p.q, accountId, token, today),
	);

	if (flags.json === true) {
		printJson(runs);
		return;
	}
	summarize(runs);
	printFailures(runs);
}

main().catch((e: unknown) => {
	process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
	process.exit(1);
});
