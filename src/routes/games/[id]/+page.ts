// The analyst view's own load. Everything shared with the map view is in
// +layout.ts, which runs once for the pair — so what belongs here is what only
// this view renders.
//
// The screenshot strip is that: the map view shares GameHeader but is a
// full-bleed map with no room for a panel, so loading the strip in the layout
// would spend a read budget slot on a surface that never shows it.
//
// Best-effort, like the two link reads in the layout. The strip has its own
// per-IP budget (SCREENSHOT_VIEW_PER_HOUR), above ANON_READS_PER_HOUR so it is
// never what a real visitor meets first — and when it does fire, or D1 hiccups,
// the game page renders without its strip rather than 429-ing a page whose
// subject is the save.
import { cloudApi } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch }) => ({
	screenshots: await cloudApi
		.getGameScreenshots(params.id, { fetch })
		.catch(() => []),
});
