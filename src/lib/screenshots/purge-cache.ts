// The purge-by-URL call itself (issue #289).
//
// The sibling of public-urls.ts, and here for the same reason: two things
// outside the Worker have to make this exact request. The Worker purges when a
// screenshot is hidden or deleted; `./per-ankh admin delete-game` / `nuke-user`
// delete a game's objects from a Node script with no Worker bindings and have
// to purge the same addresses. Those URL shapes were shared on the argument
// that a second copy of them "would fail the way all such copies fail" — the
// endpoint, the body and the API's chunk ceiling are the same argument.
//
// Why the purge matters at all: no Worker sits in the image path. Every object
// is public and served from an R2 custom domain with a 30-day Edge TTL, so
// there is no per-request gate to re-evaluate after a row is hidden or deleted
// — the edge keeps serving the copy it holds. Purge-by-URL is the only
// invalidation there is.
//
// DEPENDENCY-FREE, and that is what lets both callers have it: it takes a zone
// id, a token and URLs, and REPORTS rather than logs or throws. Where the
// credentials come from and what a failure reads like are each caller's own
// business — the Worker logs in the `orphaned_blob` style against vars and a
// wrangler secret, the CLI warns on a terminal against the operator's
// environment — and a failure here is never fatal either way, because the
// removal it follows has already happened and is not undoable.

// The API's own ceiling on a purge-by-URL call. A game delete clears two URLs
// per screenshot against a 5-per-game cap, so a single game is well inside it
// — the chunking is for the list-by-prefix case, which can turn up objects no
// row names.
export const MAX_URLS_PER_PURGE = 30;

// How much of a refusal body travels back. Cloudflare's own error array is the
// difference between a scope problem and a bad URL, so it is worth carrying;
// bounded because an error body is not a size we control.
const MAX_DETAIL_CHARS = 500;

// What became of one chunk. Three outcomes rather than a boolean, because the
// two failures have different fixes and both callers say which they met:
// `refused` is the API answering (a token without Cache Purge on the zone, or
// a URL outside it), `unreachable` is the call never landing.
export type PurgeChunkResult =
	| { kind: "purged"; files: string[] }
	| { kind: "refused"; files: string[]; status: number; detail: string }
	| { kind: "unreachable"; files: string[]; error: unknown };

export interface PurgeCacheRequest {
	// The zone both image hosts live in. Purge permissions are zone-scoped, so
	// one zone and one token cover both hostnames.
	zoneId: string;
	// A Cloudflare API token with Zone → Cache Purge → Purge.
	token: string;
	urls: string[];
}

// Purge a set of URLs, chunked at the API's ceiling, one result per chunk in
// the order they were sent.
//
// A refused chunk does not stop the ones behind it: each chunk is an
// independent set of URLs, and a token that cannot purge one of them is no
// reason to leave the rest being served.
export async function purgeCachedUrls({
	zoneId,
	token,
	urls,
}: PurgeCacheRequest): Promise<PurgeChunkResult[]> {
	const results: PurgeChunkResult[] = [];
	for (let i = 0; i < urls.length; i += MAX_URLS_PER_PURGE) {
		const files = urls.slice(i, i + MAX_URLS_PER_PURGE);
		try {
			const res = await fetch(
				`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ files }),
				},
			);
			if (res.ok) {
				results.push({ kind: "purged", files });
			} else {
				results.push({
					kind: "refused",
					files,
					status: res.status,
					detail: (await res.text()).slice(0, MAX_DETAIL_CHARS),
				});
			}
		} catch (error) {
			results.push({ kind: "unreachable", files, error });
		}
	}
	return results;
}
