<script lang="ts">
	import { Tabs } from "bits-ui";
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { cloudApi, type GameListItem } from "$lib/api-cloud";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import BulkReparseModal from "$lib/BulkReparseModal.svelte";
	import { PARSER_VERSION } from "$lib/parser/types";
	import { formatGameTitle } from "$lib/utils/formatting";
	import { isNewer } from "$lib/utils/semver";
	import { toast } from "$lib/ui/toast";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let activeTab = $state("account");
	let loggingOut = $state(false);
	// Games handed to the reparse modal. null = closed. The bulk button sets
	// the whole out-of-date set; a per-save Reparse button sets `[oneGame]`.
	// BulkReparseModal is generic over the list, so a single-element array
	// reuses the same download → parse → upload pipeline.
	let reparseGames = $state<GameListItem[] | null>(null);

	// Default upload visibility — optimistic toggle backed by the worker,
	// mirroring the lock toggle in GameActions: flip immediately, revert on
	// failure. Initialised at construction from the server value; nothing
	// re-fetches /me on this page, so no re-sync effect is needed.
	// svelte-ignore state_referenced_locally
	let defaultPublic = $state(data.user.default_game_public);
	let savingPref = $state(false);

	// Already filtered to out-of-date games server-side (see +page.ts), so the
	// count and modal list cover the user's entire library, not just a page.
	const outOfDateGames = $derived(data.outOfDateGames);
	// The full library (capped at 500) for the per-save reparse rows.
	const allGames = $derived(data.allGames);

	const gameTitle = (g: GameListItem): string =>
		formatGameTitle({
			display_name: g.display_name,
			game_name: g.game_name,
			save_owner_nation: g.user_nation,
			total_turns: g.total_turns,
			match_id: 0,
		});

	// A save is behind when the current parser is newer than the one it was
	// last parsed with — same check that drives the bulk set and the
	// detail-page reparse banner.
	const isOutdated = (g: GameListItem): boolean =>
		isNewer(PARSER_VERSION, g.parser_version);

	// Subtab triggers styled as chip-bar pills, matching the game-detail and
	// aggregate-stats tab bars.
	const triggerClass =
		"cursor-pointer rounded px-3 py-1.5 text-sm font-bold text-tan transition-colors hover:bg-tan-hover data-[state=active]:bg-surface-raised data-[state=inactive]:bg-surface";

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
		reparseGames = null;
		if (didReparse) await invalidateAll();
	}
</script>

<main class="cloud-scroll flex-1 overflow-y-auto px-4 py-8" use:autohideScroll>
	<div class="mx-auto max-w-xl">
		<Tabs.Root bind:value={activeTab}>
			<Tabs.List
				class="mb-4 flex w-fit flex-wrap items-center gap-1 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg"
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
				<div
					class="rounded-lg p-4"
					style="background-color: rgb(var(--color-surface));"
				>
					<div
						class="rounded-lg p-3"
						style="background-color: rgb(var(--color-surface-raised));"
					>
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
							<span class="font-mono font-medium text-bright"
								>{data.user.discord_id}</span
							>
						</div>
					</div>

					<div class="mt-3">
						<button
							type="button"
							onclick={handleLogout}
							disabled={loggingOut}
							class="cursor-pointer rounded bg-surface-raised px-3 py-1 text-sm text-tan transition-colors hover:bg-surface-raised-hover disabled:opacity-50"
						>
							{loggingOut ? "Logging out…" : "Log out"}
						</button>
					</div>
				</div>
			</Tabs.Content>

			<Tabs.Content value="preferences">
				<div
					class="rounded-lg p-4"
					style="background-color: rgb(var(--color-surface));"
				>
					<div
						class="rounded-lg p-3"
						style="background-color: rgb(var(--color-surface-raised));"
					>
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
									: 'bg-input'}"
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
				<div
					class="rounded-lg p-4"
					style="background-color: rgb(var(--color-surface));"
				>
					<div
						class="rounded-lg p-3"
						style="background-color: rgb(var(--color-surface-raised));"
					>
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
							onclick={() => (reparseGames = outOfDateGames)}
							disabled={outOfDateGames.length === 0}
							class="cursor-pointer rounded bg-[#ab9978] px-3 py-1 text-sm font-bold text-black transition-colors hover:bg-[#9a8a6c] disabled:cursor-not-allowed disabled:opacity-50"
						>
							{outOfDateGames.length === 0
								? "All games up to date"
								: `Reparse ${outOfDateGames.length} ${outOfDateGames.length === 1 ? "game" : "games"}`}
						</button>
					</div>

					<!-- Per-save reparse. Lists the whole library so a single save
					     can be force-reparsed even when it's already current (the
					     bulk button only touches out-of-date games). -->
					<div
						class="mt-3 rounded-lg p-3"
						style="background-color: rgb(var(--color-surface-raised));"
					>
						<div class="mb-2 text-sm font-bold text-tan">Reparse a single save</div>
						{#if allGames.length === 0}
							<div class="text-xs text-gray-400">No saves yet.</div>
						{:else}
							<ul class="max-h-96 space-y-1 overflow-y-auto pr-1">
								{#each allGames as game (game.game_id)}
									<li
										class="flex items-center gap-2 rounded bg-surface-sunken px-2 py-1.5 text-xs"
									>
										<span class="flex-1 truncate text-tan" title={gameTitle(game)}>
											{gameTitle(game)}
										</span>
										{#if isOutdated(game)}
											<span
												class="shrink-0 rounded bg-orange/20 px-1.5 py-0.5 text-[10px] font-bold text-orange"
											>
												outdated
											</span>
										{:else}
											<span class="shrink-0 text-[10px] text-gray-400">
												v{game.parser_version}
											</span>
										{/if}
										<button
											type="button"
											onclick={() => (reparseGames = [game])}
											class="shrink-0 cursor-pointer rounded bg-orange px-2 py-1 text-[11px] font-bold text-white transition-colors hover:bg-orange/80"
										>
											Reparse
										</button>
									</li>
								{/each}
							</ul>
							{#if data.totalGames > allGames.length}
								<div class="mt-2 text-[11px] text-gray-400">
									Showing the {allGames.length} most recent of {data.totalGames} saves.
								</div>
							{/if}
						{/if}
					</div>
				</div>
			</Tabs.Content>
		</Tabs.Root>
	</div>
</main>

{#if reparseGames}
	<BulkReparseModal games={reparseGames} onClose={onReparseClose} />
{/if}
