<script lang="ts">
	// A featured set as an inventory — a table rather than the VideoCard grid the
	// public surfaces use, because this is the view for auditing what is in a set
	// and taking things out of it, not for discovering videos. It is also the only
	// surface that reaches a set on a touch device: the star and the pin on a card
	// are both hover-only.
	//
	// Shared by the two Featured tabs, /admin's site-wide set and /account's own,
	// which differ in their copy, in which rows they hand over, and in whether an
	// uploader column says anything — on your own set it is you, once per row.
	//
	// Rows arrive from the page load (newest video first, as the Worker ordered
	// them), narrowed by the caller to what is still featured in the shared set,
	// so a removal here — which flips that same set — drops the row without a
	// re-fetch, and puts it back if the write fails.
	import type { FeaturedVideo } from "$lib/api-cloud";
	import { videoKey } from "$lib/featured-videos.svelte";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import { formatDate, platformLabel } from "$lib/utils/formatting";

	let {
		rows,
		title,
		description,
		onRemove,
		showUploader = true,
	}: {
		rows: FeaturedVideo[];
		title: string;
		description: string;
		// Unfeature one row. Which set that is belongs to the caller — this
		// component never writes.
		// eslint-disable-next-line no-unused-vars -- documentary param name
		onRemove: (video: FeaturedVideo) => Promise<void>;
		showUploader?: boolean;
	} = $props();

	// Which video is mid-write, so its Remove button can't be pressed twice.
	let removing = $state<string | null>(null);

	async function remove(video: FeaturedVideo) {
		if (removing !== null) return;
		removing = videoKey(video);
		await onRemove(video);
		removing = null;
	}
</script>

<div
	class="rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<h3 class="mb-3 text-base font-bold text-tan">{title}</h3>
	<div
		class="rounded-lg p-3"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<p class="mb-3 text-xs text-tan">{description}</p>
		{#if rows.length === 0}
			<div class="py-6 text-center text-sm text-gray-400">
				No featured videos.
			</div>
		{:else}
			<table class="w-full text-left text-xs text-tan">
				<thead>
					<tr class="border-b border-black">
						<th class="py-1.5 pr-2 font-bold">Video</th>
						{#if showUploader}
							<th class="py-1.5 pr-2 font-bold">Uploader</th>
						{/if}
						<th class="py-1.5 pr-2 font-bold">Published</th>
						<th class="py-1.5 font-bold"
							><span class="sr-only">Actions</span></th
						>
					</tr>
				</thead>
				<tbody>
					{#each rows as video (videoKey(video))}
						<tr class="border-b border-black/50 last:border-0">
							<td class="min-w-0 py-1.5 pr-2">
								<!-- An external watch URL, not an app route, so resolve()
								     doesn't apply; rel guards tabnabbing + referrer leakage. -->
								<!-- eslint-disable svelte/no-navigation-without-resolve -->
								<a
									href={video.url}
									target="_blank"
									rel="noopener noreferrer"
									class="line-clamp-2 hover:underline"
									title={video.title}
								>
									{video.title}
								</a>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
								<div class="text-gray-400">{platformLabel(video.platform)}</div>
							</td>
							{#if showUploader}
								<td class="py-1.5 pr-2">
									{#if "user_id" in video}
										<ProfileLink
											userId={video.user_id}
											slug={video.slug}
											class="hover:underline"
										>
											{video.display_name}
										</ProfileLink>
									{:else if "uploader_name" in video}
										<!-- eslint-disable svelte/no-navigation-without-resolve -->
										<a
											href={video.uploader_url}
											target="_blank"
											rel="noopener noreferrer"
											class="hover:underline"
										>
											{video.uploader_name}
										</a>
										<!-- eslint-enable svelte/no-navigation-without-resolve -->
									{:else}
										<span class="text-gray-400">—</span>
									{/if}
								</td>
							{/if}
							<td class="whitespace-nowrap py-1.5 pr-2">
								{formatDate(video.published_at)}
							</td>
							<td class="py-1.5 text-right">
								<button
									type="button"
									onclick={() => remove(video)}
									disabled={removing !== null}
									class="rounded bg-orange px-2 py-0.5 text-xs font-bold text-white hover:bg-orange/80 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-orange"
								>
									Remove
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
