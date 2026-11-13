// The ad-hoc query surface (issue #272): compose a question from the Worker's
// catalog and run it over the public corpus.
//
// Signed-in only, like /stats and for the same reason: `GET /v1/query` 401s
// without a session, because the session gates who may spend an ad-hoc
// aggregation rather than what they get to see. Bouncing here means an
// anonymous visitor lands on login rather than on this page's error state.
//
// The selection lives entirely in the URL, so a question is linkable and the
// back button walks the questions — and `?next=` carries the whole selection
// through OAuth, so a shared link survives the login round trip.

import { redirect } from "@sveltejs/kit";
import { ApiError, cloudApi } from "$lib/api-cloud";
import { draftFromParams, emptyDraft } from "$lib/query/selection";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import { loginBounce } from "$lib/utils/safe-next";
import type { QueryResult } from "$lib/query/types";
import type { PageLoad } from "./$types";

// The params the Worker reads. A URL may carry others (a tracking tag on a
// pasted link); sending them on would change the edge-cache key without
// changing the answer, so the question is rebuilt from these alone.
const QUERY_PARAMS = ["source", "dim", "measure", "f", "sort", "limit"];

function selectionFrom(url: URL): string {
	const params = new URLSearchParams();
	for (const name of QUERY_PARAMS) {
		for (const value of url.searchParams.getAll(name))
			params.append(name, value);
	}
	return params.toString().replace(/%3A/g, ":").replace(/%2C/g, ",");
}

export const load: PageLoad = async ({ fetch, url }) => {
	// `cloudApi.getMe` returns null on 401 (it swallows UnauthorizedError), so
	// we check the result rather than catch — the same shape /stats uses.
	//
	// Serial, and deliberately: the question below is gated on this answer, and
	// starting it concurrently would spend an `ad_hoc_query_view` slot for a
	// visitor who is about to be redirected to sign in.
	const user = await cloudApi.getMe({ fetch });
	if (!user) {
		throw redirect(303, loginBounce(url));
	}

	const catalog = await cloudApi.getQueryCatalog({ fetch });

	// No `source` is no question: the builder opens on a default draft and
	// nothing is asked until somebody asks it. Which also means landing on
	// this page costs no read budget.
	if (url.searchParams.get("source") === null) {
		return {
			catalog,
			draft: emptyDraft(catalog),
			result: null as QueryResult | null,
			error: null as string | null,
			meta: {
				title: "Ask the corpus - Per-Ankh",
				description:
					"Ask Per-Ankh's Old World save corpus a question no chart was built for — compose it from a catalog of dimensions and measures.",
			},
		};
	}

	let result: QueryResult | null = null;
	let error: string | null = null;
	try {
		result = await cloudApi.runQuery(selectionFrom(url), { fetch });
	} catch (err) {
		// /query spends its own per-IP budget (not anon_read, not the stats
		// bundles'), so a 429 here means this surface alone was hammered.
		rethrowRateLimit(err);
		// A refused selection is this page's own state rather than an error
		// page: the builder is still on screen and the message names the key
		// the Worker would not take. Anything else is a real failure.
		if (err instanceof ApiError && err.code === "INVALID_QUERY") {
			error = err.message;
		} else {
			throw err;
		}
	}

	return {
		catalog,
		draft: draftFromParams(catalog, url.searchParams),
		result,
		error,
		meta: {
			// The selection is in the URL rather than in the title: this page's
			// subject is the corpus, and what varies is which question you are
			// asking of it — which the builder and the heading already say.
			title: "Ask the corpus - Per-Ankh",
			description:
				"Ask Per-Ankh's Old World save corpus a question no chart was built for — compose it from a catalog of dimensions and measures.",
		},
	};
};
