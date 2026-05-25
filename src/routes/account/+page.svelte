<script lang="ts">
	import { Tabs } from "bits-ui";
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { cloudApi } from "$lib/api-cloud";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import BulkReparseModal from "$lib/BulkReparseModal.svelte";
	import { PARSER_VERSION } from "$lib/parser/types";
	import { toast } from "$lib/ui/toast";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let activeTab = $state("account");
	let loggingOut = $state(false);
	let reparseOpen = $state(false);

	// Default upload visibility — optimistic toggle backed by the worker,
	// mirroring the lock toggle in GameActions: flip immediately, revert on
	// failure. Initialised at construction from the server value; nothing
	// re-fetches /me on this page, so no re-sync effect is needed.
	// svelte-ignore state_referenced_locally
	let defaultPublic = $state(data.user.default_game_public);
	let savingPref = $state(false);

	const outOfDateGames = $derived(
		data.games.filter((g) => g.parser_version !== PARSER_VERSION),
	);

	// Subtab triggers styled as chip-bar pills, matching the game-detail and
	// aggregate-stats tab bars.
	const triggerClass =
		"cursor-pointer rounded px-3 py-1.5 text-sm font-bold text-tan transition-colors hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=inactive]:bg-[#2a2622]";

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

	async function toggleDefaultPublic() {
		if (savingPref) return;
		const next = !defaultPublic;
		const prev = defaultPublic;
		defaultPublic = next;
		savingPref = true;
		try {
			await cloudApi.updateSettings({ default_game_public: next });
		} catch (err) {
			defaultPublic = prev;
			toast.error(
				`Settings update failed: ${err instanceof Error ? err.message : err}`,
			);
		} finally {
			savingPref = false;
		}
	}

	async function onReparseClose(didReparse: boolean) {
		reparseOpen = false;
		if (didReparse) await invalidateAll();
	}
</script>

<svelte:head>
	<title>Settings — Per-Ankh</title>
</svelte:head>

<main class="cloud-scroll flex-1 overflow-y-auto px-4 py-8" use:autohideScroll>
	<div class="mx-auto max-w-xl">
		<Tabs.Root bind:value={activeTab}>
			<Tabs.List
				class="mb-4 flex w-fit flex-wrap items-center gap-1 rounded-lg border border-[#2a2622] bg-[#241f1b] p-2 shadow-lg"
			>
				<Tabs.Trigger value="account" class={triggerClass}>Account</Tabs.Trigger
				>
				<Tabs.Trigger value="preferences" class={triggerClass}>
					Preferences
				</Tabs.Trigger>
				<Tabs.Trigger value="maintenance" class={triggerClass}>
					Maintenance
				</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="account">
				<div class="rounded-lg p-4" style="background-color: #2a2622;">
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
					</div>

					<div class="mt-3">
						<button
							type="button"
							onclick={handleLogout}
							disabled={loggingOut}
							class="cursor-pointer rounded bg-[#35302b] px-3 py-1 text-sm text-tan transition-colors hover:bg-[#453e37] disabled:opacity-50"
						>
							{loggingOut ? "Logging out…" : "Log out"}
						</button>
					</div>
				</div>
			</Tabs.Content>

			<Tabs.Content value="preferences">
				<div class="rounded-lg p-4" style="background-color: #2a2622;">
					<div class="rounded-lg p-3" style="background-color: #35302B;">
						<div class="flex items-center justify-between gap-4">
							<div class="min-w-0">
								<div class="text-sm font-bold text-tan">
									New uploads are public by default
								</div>
								<p class="mt-1 text-xs text-gray-400">
									Newly uploaded saves are visible to anyone with the link. Turn
									this off to keep new uploads private until you share them. You
									can change any game's visibility individually at any time.
								</p>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={defaultPublic}
								aria-label="New uploads are public by default"
								onclick={toggleDefaultPublic}
								disabled={savingPref}
								class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 {defaultPublic
									? 'bg-orange'
									: 'bg-[#4a433b]'}"
							>
								<span
									class="inline-block h-3.5 w-3.5 transform rounded-full bg-tan transition-transform {defaultPublic
										? 'translate-x-[18px]'
										: 'translate-x-1'}"
								></span>
							</button>
						</div>
					</div>
				</div>
			</Tabs.Content>

			<Tabs.Content value="maintenance">
				<div class="rounded-lg p-4" style="background-color: #2a2622;">
					<div class="rounded-lg p-3" style="background-color: #35302B;">
						<!-- Reparse outdated games. Always rendered so the button is
						     discoverable; disabled when nothing is out of date. -->
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
							class="cursor-pointer rounded bg-[#ab9978] px-3 py-1 text-sm font-bold text-black transition-colors hover:bg-[#9a8a6c] disabled:cursor-not-allowed disabled:opacity-50"
						>
							{outOfDateGames.length === 0
								? "All games up to date"
								: `Reparse ${outOfDateGames.length} ${outOfDateGames.length === 1 ? "game" : "games"}`}
						</button>
					</div>
				</div>
			</Tabs.Content>
		</Tabs.Root>
	</div>
</main>

{#if reparseOpen}
	<BulkReparseModal games={outOfDateGames} onClose={onReparseClose} />
{/if}
