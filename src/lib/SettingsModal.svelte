<script lang="ts">
	import { api } from "$lib/api";
	import { refreshData } from "$lib/stores/refresh";
	import type { KnownOnlineId } from "$lib/types/KnownOnlineId";

	interface Props {
		isOpen: boolean;
		onClose: () => void;
	}

	let { isOpen = $bindable(), onClose }: Props = $props();

	let knownIds = $state<KnownOnlineId[]>([]);
	let currentOnlineId = $state<string | null>(null);
	let loading = $state(true);
	let saving = $state(false);
	let error = $state<string | null>(null);

	async function loadData() {
		loading = true;
		error = null;
		try {
			const [ids, primaryId] = await Promise.all([
				api.getKnownOnlineIds(),
				api.getPrimaryUserOnlineId(),
			]);
			knownIds = ids;
			currentOnlineId = primaryId;
		} catch (err) {
			error = String(err);
		} finally {
			loading = false;
		}
	}

	async function handleSelectUser(onlineId: string) {
		if (onlineId === currentOnlineId) return;

		saving = true;
		error = null;
		try {
			await api.setPrimaryUserOnlineId(onlineId);
			currentOnlineId = onlineId;
			// Refresh sidebar to update trophy icons with new save owner calculation
			refreshData.trigger();
		} catch (err) {
			error = String(err);
		} finally {
			saving = false;
		}
	}

	function handleClose() {
		onClose();
	}

	// Reload data when modal opens
	$effect(() => {
		if (isOpen) {
			loadData();
		}
	});
</script>

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
	>
		<div
			class="mx-4 w-full max-w-lg rounded-lg border-2 border-black bg-blue-gray p-6 shadow-lg"
		>
			<h2
				class="mb-4 border-b-2 border-orange pb-2 text-2xl font-bold text-tan"
			>
				Primary User
			</h2>

			<div class="mb-6">
				<h3 class="mb-2 text-lg font-semibold text-tan">
					View/Update Online ID
				</h3>
				<p class="mb-4 text-sm text-gray-400">
					Select your identity to track wins/losses in multiplayer games.
				</p>

				{#if loading}
					<div class="py-4 text-center text-tan">Loading...</div>
				{:else if knownIds.length === 0}
					<div class="py-4 text-center text-gray-400">
						No OnlineIDs found. Import save files to see available identities.
					</div>
				{:else}
					<div class="max-h-64 overflow-y-auto rounded border border-black">
						{#each knownIds as id (id.online_id)}
							<button
								type="button"
								class="w-full border-b border-gray-700 px-4 py-3 text-left transition-colors last:border-b-0
                  {id.online_id === currentOnlineId
									? 'bg-brown text-tan'
									: 'text-tan hover:bg-gray-700'}"
								disabled={saving}
								onclick={() => handleSelectUser(id.online_id)}
							>
								<div class="flex items-center justify-between gap-2">
									<div class="flex flex-wrap items-center gap-2">
										<span class="font-semibold"
											>{id.player_names.join(", ") || "(no name)"}</span
										>
										<span class="font-mono text-xs text-gray-400"
											>{id.online_id}</span
										>
										<span class="text-xs text-gray-400"
											>({id.save_count} saves)</span
										>
									</div>
									{#if id.online_id === currentOnlineId}
										<svg
											xmlns="http://www.w3.org/2000/svg"
											class="h-5 w-5 flex-shrink-0 text-orange"
											viewBox="0 0 20 20"
											fill="currentColor"
										>
											<path
												fill-rule="evenodd"
												d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
												clip-rule="evenodd"
											/>
										</svg>
									{/if}
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			{#if error}
				<div class="mb-4 rounded border border-red-700 bg-red-900 p-3 text-tan">
					<div class="font-semibold">Error:</div>
					<div class="mt-1 text-sm">{error}</div>
				</div>
			{/if}

			<button
				class="hover:bg-brown-dark w-full rounded border-2 border-black bg-brown px-4 py-2 font-semibold text-tan transition-colors"
				type="button"
				onclick={handleClose}
			>
				Close
			</button>
		</div>
	</div>
{/if}
