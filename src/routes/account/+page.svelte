<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { cloudApi } from "$lib/api-cloud";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// OnlineID list state — derived from the loader so it re-syncs whenever
	// the route reloads with fresh data, but writable so Remove can mutate
	// optimistically. Server-side delete is idempotent so we don't need to
	// handle 404 specially. On rejection we restore the previous value.
	let onlineIds = $derived<string[]>([...data.onlineIds]);
	let removeError = $state<string | null>(null);
	let loggingOut = $state(false);

	async function removeId(id: string) {
		removeError = null;
		const before = onlineIds;
		onlineIds = onlineIds.filter((x) => x !== id);
		try {
			await cloudApi.removeOnlineId(id);
		} catch (err) {
			// Restore the row and surface the error inline.
			onlineIds = before;
			removeError = err instanceof Error ? err.message : String(err);
		}
	}

	async function handleLogout() {
		loggingOut = true;
		try {
			await cloudApi.logout();
		} catch (err) {
			// Network failure shouldn't strand the user on /account.
			// Navigate away regardless — worst case the cookie is still
			// valid server-side and the next page load shows them signed in.
			console.warn("Logout request failed:", err);
		}
		await goto(resolve("/"), { replaceState: true });
	}
</script>

<svelte:head>
	<title>Account — Per-Ankh</title>
</svelte:head>

<main class="cloud-scroll flex-1 overflow-y-auto px-4 py-8" use:autohideScroll>
	<div class="mx-auto max-w-xl space-y-6">
		<h1 class="font-serif text-2xl text-tan">Account</h1>

		<section class="rounded border-2 border-brown bg-[#2a2622] p-6">
			<h2 class="mb-4 text-sm font-bold uppercase tracking-wide text-brown">
				Discord
			</h2>
			<div class="mb-4 flex items-center gap-3">
				<img
					src={data.user.avatar_url}
					alt=""
					class="h-12 w-12 rounded-full"
					width="48"
					height="48"
				/>
				<div>
					<div class="font-bold text-tan">{data.user.display_name}</div>
					<div class="font-mono text-xs text-brown">
						{data.user.discord_id}
					</div>
				</div>
			</div>
			<p class="mb-4 text-xs text-brown">
				Display name and avatar come from Discord and refresh on each
				sign-in. Edit them in Discord directly.
			</p>
			<button
				type="button"
				onclick={handleLogout}
				disabled={loggingOut}
				class="rounded bg-brown px-3 py-1 text-xs text-tan hover:bg-orange disabled:opacity-50"
			>
				{loggingOut ? "Signing out…" : "Sign out"}
			</button>
		</section>

		<section class="rounded border-2 border-brown bg-[#2a2622] p-6">
			<h2 class="mb-2 text-sm font-bold uppercase tracking-wide text-brown">
				Linked OnlineIDs
			</h2>
			<p class="mb-4 text-xs text-brown">
				Steam/GOG/Epic IDs you've played as. Captured automatically when
				you upload a save and pick yourself in the player list. Used to
				pre-select you in the upload picker. Removing one re-links it on
				the next matching upload.
			</p>
			{#if onlineIds.length === 0}
				<p class="text-xs text-brown">
					No linked OnlineIDs yet — they get captured automatically when
					you upload a save you played in.
				</p>
			{:else}
				<ul class="space-y-2">
					{#each onlineIds as id (id)}
						<li class="flex items-center justify-between gap-3 rounded border border-brown p-2">
							<code class="truncate font-mono text-xs text-tan">{id}</code>
							<button
								type="button"
								onclick={() => removeId(id)}
								class="shrink-0 rounded bg-brown px-2 py-1 text-xs text-tan hover:bg-orange"
							>
								Remove
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			{#if removeError}
				<p class="mt-3 text-xs text-orange">Remove failed: {removeError}</p>
			{/if}
		</section>
	</div>
</main>
