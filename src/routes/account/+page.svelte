<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { cloudApi } from "$lib/api-cloud";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import BulkReparseModal from "$lib/BulkReparseModal.svelte";
	import { PARSER_VERSION } from "$lib/parser/types";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let loggingOut = $state(false);
	let reparseOpen = $state(false);

	const outOfDateGames = $derived(
		data.games.filter((g) => g.parser_version !== PARSER_VERSION),
	);

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

	async function onReparseClose(didReparse: boolean) {
		reparseOpen = false;
		if (didReparse) await invalidateAll();
	}
</script>

<svelte:head>
	<title>Account — Per-Ankh</title>
</svelte:head>

<main class="cloud-scroll flex-1 overflow-y-auto px-4 py-8" use:autohideScroll>
	<div class="mx-auto max-w-xl">
		<div class="rounded-lg p-4" style="background-color: #2a2622;">
			<h3 class="mb-3 text-base font-bold text-tan">Account</h3>
			<div class="rounded-lg p-3" style="background-color: #35302B;">
				<!-- Header: avatar + display name -->
				<div class="mb-3 flex items-center gap-3">
					<img
						src={data.user.avatar_url}
						alt=""
						class="h-6 w-6 rounded-full"
						width="24"
						height="24"
					/>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="text-lg font-bold text-tan">
								{data.user.display_name}
							</span>
							<span class="text-sm text-gray-400">(Discord)</span>
						</div>
					</div>
				</div>

				<!-- Stats grid -->
				<div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
					<span class="font-bold text-gray-400">Discord ID</span>
					<span class="font-mono font-medium text-[#DBDEE3]"
						>{data.user.discord_id}</span
					>
				</div>

				<!-- Maintenance: reparse outdated games. Always rendered so the
				     button is discoverable; disabled when nothing is out of date. -->
				<div class="mt-4 border-t border-brown/40 pt-3">
					<div class="mb-2 text-xs font-bold text-gray-400">Maintenance</div>
					<div class="mb-2 text-xs text-tan">
						{#if outOfDateGames.length === 0}
							All games are on the current parser version.
						{:else}
							{outOfDateGames.length}
							{outOfDateGames.length === 1 ? "game" : "games"} on an older parser
							version.
						{/if}
					</div>
					<button
						type="button"
						onclick={() => (reparseOpen = true)}
						disabled={outOfDateGames.length === 0}
						class="rounded bg-brown px-3 py-1 text-xs text-tan hover:bg-orange disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-brown"
					>
						{outOfDateGames.length === 0
							? "All games up to date"
							: `Reparse ${outOfDateGames.length} ${outOfDateGames.length === 1 ? "game" : "games"}`}
					</button>
				</div>

				<div class="mt-3">
					<button
						type="button"
						onclick={handleLogout}
						disabled={loggingOut}
						class="rounded bg-brown px-3 py-1 text-xs text-tan hover:bg-orange disabled:opacity-50"
					>
						{loggingOut ? "Logging out…" : "Log out"}
					</button>
				</div>
			</div>
		</div>
	</div>
</main>

{#if reparseOpen}
	<BulkReparseModal games={outOfDateGames} onClose={onReparseClose} />
{/if}
