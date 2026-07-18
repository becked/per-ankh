<script lang="ts">
	// Self-service channel management for the account page. Add a channel by
	// pasting its URL / @handle (the Worker detects the platform and resolves
	// it); one channel per platform, removable. The add/remove endpoints return
	// the persisted row, so we reconcile against their responses rather than
	// re-fetching.
	import { ApiError, cloudApi, type VideoChannel } from "$lib/api-cloud";
	import { toast } from "$lib/ui/toast";
	import { platformLabel } from "$lib/utils/formatting";

	let { initialChannels }: { initialChannels: VideoChannel[] } = $props();

	// svelte-ignore state_referenced_locally
	let channels = $state<VideoChannel[]>([...initialChannels]);
	let url = $state("");
	let adding = $state(false);
	let removing = $state<string | null>(null);

	async function add(e: SubmitEvent) {
		e.preventDefault();
		const value = url.trim();
		if (!value || adding) return;
		adding = true;
		try {
			const { channel } = await cloudApi.addChannel(value);
			// Upsert by platform — one channel per platform, matching the server.
			const idx = channels.findIndex((c) => c.platform === channel.platform);
			if (idx >= 0) channels[idx] = channel;
			else channels.push(channel);
			url = "";
		} catch (err) {
			// The Worker's resolution errors carry user-safe messages (bad URL,
			// unresolvable handle, unsupported platform) — surface them verbatim.
			toast.error(
				err instanceof ApiError
					? err.message
					: `Couldn't add channel: ${err instanceof Error ? err.message : err}`,
			);
		} finally {
			adding = false;
		}
	}

	async function remove(platform: string) {
		if (removing) return;
		removing = platform;
		try {
			await cloudApi.removeChannel(platform);
			channels = channels.filter((c) => c.platform !== platform);
		} catch (err) {
			toast.error(
				`Couldn't remove channel: ${err instanceof Error ? err.message : err}`,
			);
		} finally {
			removing = null;
		}
	}
</script>

<div
	class="rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<div
		class="rounded-lg p-3"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<div class="text-sm font-bold text-tan">Video channels</div>
		<p class="mt-1 text-xs text-gray-400">
			YouTube channel to show recent videos on your profile.
		</p>

		<form onsubmit={add} class="mt-3 flex items-center gap-2">
			<input
				type="text"
				bind:value={url}
				disabled={adding}
				aria-label="Channel URL or @handle"
				class="min-w-0 flex-1 rounded border border-input bg-surface-sunken p-1.5 text-sm text-bright focus:border-input-focus focus:outline-none disabled:opacity-50"
			/>
			<button
				type="submit"
				disabled={adding || !url.trim()}
				class="shrink-0 cursor-pointer rounded bg-orange px-3 py-1.5 text-sm font-bold text-white transition-colors hover:bg-orange/80 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{adding ? "Adding…" : "Add"}
			</button>
		</form>

		{#if channels.length === 0}
			<div class="mt-3 text-xs text-gray-400">No channels linked yet.</div>
		{:else}
			<!-- href is the external channel URL (http(s)), not an app route, so
			     resolve() doesn't apply; rel="noopener noreferrer" guards against
			     tabnabbing + referrer leakage. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<ul class="mt-3 space-y-1">
				{#each channels as ch (ch.platform)}
					<li
						class="flex items-center gap-2 rounded bg-surface-sunken px-2 py-1.5 text-xs"
					>
						<span class="w-16 shrink-0 font-bold text-tan">
							{platformLabel(ch.platform)}
						</span>
						<a
							href={ch.channel_url}
							target="_blank"
							rel="noopener noreferrer"
							class="min-w-0 flex-1 truncate text-bright hover:underline"
							title={ch.channel_url}
						>
							{ch.channel_url}
						</a>
						<button
							type="button"
							onclick={() => remove(ch.platform)}
							disabled={removing === ch.platform}
							aria-label={`Remove ${platformLabel(ch.platform)} channel`}
							title="Remove channel"
							class="shrink-0 cursor-pointer rounded px-1.5 leading-none text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100 disabled:opacity-40"
						>
							✕
						</button>
					</li>
				{/each}
			</ul>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
	</div>
</div>
