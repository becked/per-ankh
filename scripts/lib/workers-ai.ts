// The Workers AI REST call the evals make (npm run eval:screenshots and npm
// run eval:ask). The Worker reaches the same models through its AI binding. A
// script has no binding, so it calls the REST API with an account ID and a
// token.

export interface WorkersAiCredentials {
	accountId: string;
	token: string;
}

// CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN, from the environment or the
// gitignored .env (the caller imports dotenv/config). `dryRunChecks` ends the
// error message: what the eval's --dry-run still checks without them.
export function workersAiCredentials(
	dryRunChecks: string,
): WorkersAiCredentials {
	return {
		accountId: requireEnv("CLOUDFLARE_ACCOUNT_ID", dryRunChecks),
		token: requireEnv("CLOUDFLARE_AI_TOKEN", dryRunChecks),
	};
}

function requireEnv(name: string, dryRunChecks: string): string {
	const v = process.env[name];
	if (v == null || v.trim() === "") {
		throw new Error(
			`${name} is not set. The eval needs CLOUDFLARE_ACCOUNT_ID and a ` +
				`CLOUDFLARE_AI_TOKEN with Workers AI Read and Edit, in the environment or ` +
				`in .env (gitignored). Use --dry-run to ${dryRunChecks} without either.`,
		);
	}
	return v.trim();
}

interface ApiEnvelope {
	success?: boolean;
	result?: unknown;
	errors?: { code?: number; message?: string }[];
}

export interface WorkersAiCall {
	// The full model ID, as the AI binding takes it.
	model: string;
	// Sent as JSON.
	body: unknown;
	// Starts every error message, to say which call failed.
	label: string;
	// The wait before each retry, so there is one more attempt than delays.
	retryDelaysMs: readonly number[];
	// Sent beside the auth and content-type headers.
	headers?: Record<string, string>;
}

// One model call. Returns the envelope's `result` unread: the caller narrows
// it with the same reader the Worker uses on the binding's answer.
export async function runWorkersAi(
	credentials: WorkersAiCredentials,
	call: WorkersAiCall,
): Promise<unknown> {
	const url = `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/ai/run/${call.model}`;
	let lastError = "";
	for (let attempt = 0; attempt <= call.retryDelaysMs.length; attempt++) {
		if (attempt > 0) {
			await new Promise((r) => setTimeout(r, call.retryDelaysMs[attempt - 1]));
		}
		let res: Response;
		try {
			res = await fetch(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${credentials.token}`,
					"Content-Type": "application/json",
					...call.headers,
				},
				body: JSON.stringify(call.body),
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
		if (!res.ok) throw new Error(`${call.label}: HTTP ${res.status}: ${text}`);
		let envelope: ApiEnvelope;
		try {
			envelope = JSON.parse(text) as ApiEnvelope;
		} catch {
			throw new Error(
				`${call.label}: response was not JSON: ${text.slice(0, 300)}`,
			);
		}
		if (!envelope.success || envelope.result == null) {
			const msg = (envelope.errors ?? [])
				.map((e) => `${e.code ?? "?"} ${e.message ?? ""}`.trim())
				.join("; ");
			throw new Error(`${call.label}: ${msg || text.slice(0, 300)}`);
		}
		return envelope.result;
	}
	throw new Error(
		`${call.label}: giving up after ${call.retryDelaysMs.length + 1} attempts: ${lastError}`,
	);
}
