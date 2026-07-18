// URL helpers shared across the app.

// Prepend "https://" when a user-entered URL omits a scheme, so a bare domain
// like "youtube.com/@you/live" is accepted — the Worker's stream-link
// validation requires a scheme and would otherwise 400 the paste. A value that
// already starts with http(s):// is left untouched for the server to vet;
// empty/whitespace-only input returns null (nothing to submit).
export function ensureUrlScheme(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
