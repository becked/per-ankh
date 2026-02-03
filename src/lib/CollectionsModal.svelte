<script lang="ts">
	import { api } from "$lib/api";
	import { refreshData } from "$lib/stores/refresh";
	import { showConfirm } from "$lib/utils/dialogs";
	import type { Collection } from "$lib/types/Collection";

	interface Props {
		isOpen: boolean;
		onClose: () => void;
	}

	let { isOpen = $bindable(), onClose }: Props = $props();

	let collections = $state<Collection[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let newCollectionName = $state("");
	let creating = $state(false);
	let editingId = $state<number | null>(null);
	let editingName = $state("");

	async function loadCollections() {
		loading = true;
		error = null;
		try {
			collections = await api.getCollections();
		} catch (err) {
			error = String(err);
		} finally {
			loading = false;
		}
	}

	async function handleCreate() {
		if (!newCollectionName.trim()) return;

		creating = true;
		error = null;
		try {
			await api.createCollection(newCollectionName.trim());
			newCollectionName = "";
			await loadCollections();
			refreshData.trigger();
		} catch (err) {
			error = String(err);
		} finally {
			creating = false;
		}
	}

	function startEdit(collection: Collection) {
		editingId = collection.collection_id;
		editingName = collection.name;
	}

	function cancelEdit() {
		editingId = null;
		editingName = "";
	}

	async function saveEdit() {
		if (!editingId || !editingName.trim()) return;

		error = null;
		try {
			await api.renameCollection(editingId, editingName.trim());
			cancelEdit();
			await loadCollections();
			refreshData.trigger();
		} catch (err) {
			error = String(err);
		}
	}

	async function handleDelete(collection: Collection) {
		const confirmed = await showConfirm(
			`Delete "${collection.name}"? ${collection.match_count} games will be moved to the default collection.`,
		);

		if (!confirmed) return;

		error = null;
		try {
			await api.deleteCollection(collection.collection_id);
			await loadCollections();
			refreshData.trigger();
		} catch (err) {
			error = String(err);
		}
	}

	async function handleSetDefault(collection: Collection) {
		error = null;
		try {
			await api.setDefaultCollection(collection.collection_id);
			await loadCollections();
			refreshData.trigger();
		} catch (err) {
			error = String(err);
		}
	}

	function handleClose() {
		cancelEdit();
		onClose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			if (editingId) {
				cancelEdit();
			} else {
				handleClose();
			}
		}
	}

	// Reload data when modal opens
	$effect(() => {
		if (isOpen) {
			loadCollections();
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} />

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
				Manage Collections
			</h2>

			<p class="mb-4 text-sm text-gray-400">
				Organize games into collections. Only the default collection is used for
				Primary User detection.
			</p>

			{#if loading}
				<div class="py-4 text-center text-tan">Loading...</div>
			{:else}
				<!-- Create new collection -->
				<div class="mb-4 flex gap-2">
					<input
						type="text"
						bind:value={newCollectionName}
						placeholder="New collection name"
						class="flex-1 rounded border border-black bg-gray-700 px-3 py-2 text-tan focus:border-orange focus:outline-none"
						disabled={creating}
						onkeydown={(e) => e.key === "Enter" && handleCreate()}
					/>
					<button
						type="button"
						class="hover:bg-brown-dark rounded border border-black bg-brown px-4 py-2 text-tan transition-colors disabled:opacity-50"
						disabled={creating || !newCollectionName.trim()}
						onclick={handleCreate}
					>
						{creating ? "..." : "Create"}
					</button>
				</div>

				<!-- Collections list -->
				<div class="mb-4 max-h-64 overflow-y-auto rounded border border-black">
					{#each collections as collection (collection.collection_id)}
						<div
							class="flex items-center gap-2 border-b border-gray-700 px-3 py-2 last:border-b-0
                {collection.is_default ? 'bg-brown bg-opacity-30' : ''}"
						>
							{#if editingId === collection.collection_id}
								<!-- Edit mode -->
								<input
									type="text"
									bind:value={editingName}
									class="flex-1 rounded border border-orange bg-gray-700 px-2 py-1 text-tan focus:outline-none"
									onkeydown={(e) => {
										if (e.key === "Enter") saveEdit();
										if (e.key === "Escape") cancelEdit();
									}}
								/>
								<button
									type="button"
									class="p-1 text-green-400 hover:text-green-300"
									title="Save"
									onclick={saveEdit}
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-4 w-4"
										viewBox="0 0 20 20"
										fill="currentColor"
									>
										<path
											fill-rule="evenodd"
											d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
											clip-rule="evenodd"
										/>
									</svg>
								</button>
								<button
									type="button"
									class="p-1 text-gray-400 hover:text-gray-300"
									title="Cancel"
									onclick={cancelEdit}
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-4 w-4"
										viewBox="0 0 20 20"
										fill="currentColor"
									>
										<path
											fill-rule="evenodd"
											d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
											clip-rule="evenodd"
										/>
									</svg>
								</button>
							{:else}
								<!-- View mode -->
								<div class="flex-1">
									<span class="font-medium text-tan">{collection.name}</span>
									<span class="ml-2 text-sm text-gray-400"
										>({collection.match_count} games)</span
									>
									{#if collection.is_default}
										<span class="ml-2 text-xs text-orange">(default)</span>
									{/if}
								</div>

								<!-- Action buttons -->
								{#if !collection.is_default}
									<button
										type="button"
										class="p-1 text-gray-400 hover:text-orange"
										title="Set as default"
										onclick={() => handleSetDefault(collection)}
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											class="h-4 w-4"
											viewBox="0 0 20 20"
											fill="currentColor"
										>
											<path
												fill-rule="evenodd"
												d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
												clip-rule="evenodd"
											/>
										</svg>
									</button>
								{/if}
								<button
									type="button"
									class="p-1 text-gray-400 hover:text-tan"
									title="Rename"
									onclick={() => startEdit(collection)}
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-4 w-4"
										viewBox="0 0 20 20"
										fill="currentColor"
									>
										<path
											d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"
										/>
									</svg>
								</button>
								{#if !collection.is_default}
									<button
										type="button"
										class="p-1 text-gray-400 hover:text-red-400"
										title="Delete"
										onclick={() => handleDelete(collection)}
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											class="h-4 w-4"
											viewBox="0 0 20 20"
											fill="currentColor"
										>
											<path
												fill-rule="evenodd"
												d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
												clip-rule="evenodd"
											/>
										</svg>
									</button>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			{/if}

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
