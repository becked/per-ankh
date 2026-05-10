// CSP violation reports. Browsers POST violations to this endpoint when
// the page's CSP `report-uri` or `report-to` directive points here. Each
// violation becomes one structured log line (event=csp_violation) so we
// can grep Logpush for actual production CSP issues — week-one violations
// would otherwise be silently lost.
//
// Two report formats coexist:
//   - Legacy (Content-Type: application/csp-report) — single object,
//     hyphenated keys. Wide browser support.
//   - Reporting API (Content-Type: application/reports+json) — array of
//     report envelopes, camelCase body keys. Newer; emitted alongside
//     legacy when `report-to` is set.
//
// We accept either format and normalize into a flat field set before
// logging. No auth, no rate limit (the abuse ceiling is bounded by
// Cloudflare's per-Worker request limits and the 64 KB body cap).

import { logEvent } from "./log";

const MAX_BODY_BYTES = 64 * 1024;

// Normalized violation shape — flat keys so Logpush queries don't have
// to know the source format.
interface NormalizedViolation {
	document_uri: string | null;
	blocked_uri: string | null;
	violated_directive: string | null;
	effective_directive: string | null;
	source_file: string | null;
	line_number: number | null;
	column_number: number | null;
	disposition: string | null;
	status_code: number | null;
}

function asString(v: unknown): string | null {
	return typeof v === "string" && v !== "" ? v : null;
}

function asNumber(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function normalizeLegacy(raw: unknown): NormalizedViolation | null {
	if (!raw || typeof raw !== "object") return null;
	const env = raw as Record<string, unknown>;
	const inner = env["csp-report"];
	if (!inner || typeof inner !== "object") return null;
	const r = inner as Record<string, unknown>;
	return {
		document_uri: asString(r["document-uri"]),
		blocked_uri: asString(r["blocked-uri"]),
		violated_directive: asString(r["violated-directive"]),
		effective_directive: asString(r["effective-directive"]),
		source_file: asString(r["source-file"]),
		line_number: asNumber(r["line-number"]),
		column_number: asNumber(r["column-number"]),
		disposition: asString(r["disposition"]),
		status_code: asNumber(r["status-code"]),
	};
}

function normalizeReportingApi(raw: unknown): NormalizedViolation[] {
	if (!Array.isArray(raw)) return [];
	const out: NormalizedViolation[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const e = entry as Record<string, unknown>;
		if (e.type !== "csp-violation") continue;
		const body = e.body;
		if (!body || typeof body !== "object") continue;
		const b = body as Record<string, unknown>;
		out.push({
			document_uri: asString(b.documentURL ?? e.url),
			blocked_uri: asString(b.blockedURL),
			violated_directive: asString(b.violatedDirective),
			effective_directive: asString(b.effectiveDirective),
			source_file: asString(b.sourceFile),
			line_number: asNumber(b.lineNumber),
			column_number: asNumber(b.columnNumber),
			disposition: asString(b.disposition),
			status_code: asNumber(b.statusCode),
		});
	}
	return out;
}

export async function handleCspReport(request: Request): Promise<Response> {
	// Defensive size check before reading the body. The body cap also
	// limits how much an attacker can spend our log budget per request.
	const declared = request.headers.get("content-length");
	if (declared) {
		const n = parseInt(declared, 10);
		if (!Number.isNaN(n) && n > MAX_BODY_BYTES) {
			return new Response(null, { status: 413 });
		}
	}

	let raw: string;
	try {
		raw = await request.text();
	} catch {
		return new Response(null, { status: 400 });
	}
	if (raw.length > MAX_BODY_BYTES) {
		return new Response(null, { status: 413 });
	}
	if (raw.length === 0) {
		return new Response(null, { status: 204 });
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return new Response(null, { status: 400 });
	}

	const violations: NormalizedViolation[] = [];
	// Legacy single-report envelope.
	const legacy = normalizeLegacy(parsed);
	if (legacy) violations.push(legacy);
	// Reporting-API array. The two formats are mutually exclusive in
	// practice — if both are present we emit both, which is harmless.
	violations.push(...normalizeReportingApi(parsed));

	if (violations.length === 0) {
		// Body parsed but didn't match either known shape. Log so we can
		// see which UA is sending odd payloads, but don't 400 — browsers
		// occasionally evolve the format.
		logEvent("warn", "csp_violation_unknown_format", {
			content_type: request.headers.get("content-type"),
		});
		return new Response(null, { status: 204 });
	}

	for (const v of violations) {
		logEvent("warn", "csp_violation", v as unknown as Record<string, unknown>);
	}
	return new Response(null, { status: 204 });
}
