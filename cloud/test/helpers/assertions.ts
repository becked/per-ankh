// Assertion helpers. Failure messages include the response body so a flaky
// test points at the cause without needing a re-run.

import { expect } from "vitest";

export interface ErrorBody {
	error?: string;
	code?: string;
}

export async function expectErrorCode(
	response: Response,
	expected: { status: number; code: string },
): Promise<void> {
	if (response.status !== expected.status) {
		const text = await response.text();
		throw new Error(
			`Expected ${expected.status} ${expected.code}, got ${response.status}: ${text}`,
		);
	}
	const body = (await response.json()) as ErrorBody;
	expect(body.code).toBe(expected.code);
}

export async function expectOk<T = unknown>(response: Response): Promise<T> {
	if (response.status >= 400) {
		const text = await response.text();
		throw new Error(`Expected 2xx, got ${response.status}: ${text}`);
	}
	return (await response.json()) as T;
}

export async function expectStatus(
	response: Response,
	status: number,
): Promise<void> {
	if (response.status !== status) {
		const text = await response.text();
		throw new Error(`Expected ${status}, got ${response.status}: ${text}`);
	}
}
