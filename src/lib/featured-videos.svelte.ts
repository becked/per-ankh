// Which videos are featured, as client state — in two scopes.
//
// The site-admin set is one app-wide fact, and the star that toggles it rides
// on VideoCard — a component three unrelated surfaces render (the home strip, a
// profile's Videos tab, a tournament's Videos page). Holding the set per-card
// would leave the same video starred on one surface and not another after a
// toggle, and `page.data` can't hold it because an optimistic flip has to be
// writable and survive until the next load. So it lives here: one reactive set
// of "<platform>:<video_id>" keys that every star reads.
//
// The owner-featured set below is the same thing for the viewer's own videos —
// their pick of their uploads, pinned to the front of their profile's Videos
// tab. Same shape, same optimistic flip, different endpoints and a different
// control (FeaturedPin, not FeaturedStar). What is NOT here is anyone else's
// featured set: the public order is what the profile read answers (it leads
// with the owner's picks), so a visitor needs no client state to see it.
//
// Seeded from the loads that fetch each set — the root layout for the admin set
// (see +layout.ts), the profile and account pages for the owner's — via
// syncFeatured/syncMyFeatured, which run in an effect so the server never
// populates module state; that would be shared across requests.

import { SvelteSet } from "svelte/reactivity";
import {
	cloudApi,
	type CreatorVideo,
	type FeaturedVideo,
	type FeatureVideoRequest,
	type TournamentVideo,
} from "$lib/api-cloud";
import { toast } from "$lib/ui/toast";

// The identity of a video everywhere it's rendered — the same key the card
// grids use for their `{#each}` and the Worker's composite primary keys.
export function videoKey(video: { platform: string; id: string }): string {
	return `${video.platform}:${video.id}`;
}

const adminKeys = new SvelteSet<string>();
const myKeys = new SvelteSet<string>();

// Flip one key optimistically: the set moves first so the control (and the
// Featured tables, which filter on it) responds immediately, and reverts on
// failure. The set is the only thing a caller has to revert — every surface
// derives what it renders from it — so a failure is reported by the toast here
// rather than handed back. Shared by both scopes; only the write differs.
async function toggleKey(
	keys: SvelteSet<string>,
	key: string,
	next: boolean,
	write: () => Promise<void>,
): Promise<void> {
	const was = keys.has(key);
	if (next) keys.add(key);
	else keys.delete(key);
	try {
		await write();
	} catch (err) {
		if (was) keys.add(key);
		else keys.delete(key);
		toast.error(
			`${next ? "Feature" : "Unfeature"} failed: ${err instanceof Error ? err.message : err}`,
		);
	}
}

// Replace the admin set with what the server says is featured. Called from the
// root layout (app-wide) and from the admin page, whose own load is fresher; a
// re-run of either is server truth, so it wins over any optimistic flip still
// standing.
export function syncFeatured(videos: FeaturedVideo[]): void {
	adminKeys.clear();
	for (const video of videos) adminKeys.add(videoKey(video));
}

// Reading this inside a component template or $derived subscribes to the set.
export function isFeatured(video: { platform: string; id: string }): boolean {
	return adminKeys.has(videoKey(video));
}

// The snapshot POST /v1/admin/featured-videos stores. A featured video outlives
// the feed it came from, so the fields the platform owns travel with it; the
// uploader's name and avatar don't (the read joins those live), which is why
// only the discriminating fields — user_id, or the raw channel pair — are read
// off the card's video.
//
// The owner write has no equivalent: it sends two fields naming the video and
// the Worker snapshots it from the user's own channel feeds, because that row
// renders on a public profile under their name.
function snapshot(video: TournamentVideo): FeatureVideoRequest {
	return {
		platform: video.platform,
		video_id: video.id,
		url: video.url,
		title: video.title,
		thumbnail_url: video.thumbnail_url,
		published_at: video.published_at,
		user_id: "user_id" in video ? video.user_id : null,
		uploader_name: "uploader_name" in video ? video.uploader_name : null,
		uploader_url: "uploader_name" in video ? video.uploader_url : null,
	};
}

// Feature or unfeature site-wide (admin), optimistically.
export async function setFeatured(
	video: TournamentVideo,
	next: boolean,
): Promise<void> {
	await toggleKey(adminKeys, videoKey(video), next, () =>
		next
			? cloudApi.featureVideo(snapshot(video))
			: cloudApi.unfeatureVideo(video.platform, video.id),
	);
}

// Replace the viewer's own featured set with what the server says it is.
// Called from the profile page (the owner's Videos tab) and the account page's
// Featured tab — the two loads that fetch it.
export function syncMyFeatured(videos: CreatorVideo[]): void {
	myKeys.clear();
	for (const video of videos) myKeys.add(videoKey(video));
}

export function isMyFeatured(video: { platform: string; id: string }): boolean {
	return myKeys.has(videoKey(video));
}

// Feature or unfeature one of the viewer's own videos, optimistically. Takes
// the key fields rather than a whole CreatorVideo — the write names the video
// and the Worker snapshots it — so the Featured table can hand over the row it
// is holding without narrowing it first.
export async function setMyFeatured(
	video: { platform: string; id: string },
	next: boolean,
): Promise<void> {
	await toggleKey(myKeys, videoKey(video), next, () =>
		next
			? cloudApi.featureMyVideo(video.platform, video.id)
			: cloudApi.unfeatureMyVideo(video.platform, video.id),
	);
}
