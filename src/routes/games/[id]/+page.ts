import { error, redirect } from "@sveltejs/kit";
import {
	cloudApi,
	ApiError,
	UnauthorizedError,
} from "$lib/api-cloud";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch, url }) => {
	try {
		const game = await cloudApi.getGame(params.id, { fetch });
		return { game };
	} catch (err) {
		if (err instanceof UnauthorizedError) {
			throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
		}
		if (err instanceof ApiError && err.status === 404) {
			throw error(404, "Game not found");
		}
		if (err instanceof ApiError && err.status === 403) {
			throw error(403, "You don't have access to this game");
		}
		throw err;
	}
};
