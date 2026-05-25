<script lang="ts">
	// Inline action buttons rendered into GameDetailView's headerActions
	// slot, next to the date in the main heading row. Mirrors the deleted
	// desktop ShareControl pattern (f97c09a^:src/lib/ShareControl.svelte).
	//
	// All three buttons are icon-only; click opens a small popover with
	// an explanation + confirm/cancel pair. Click-outside and Escape
	// dismiss. Only one popover is open at a time — opening a second
	// closes the first.
	//
	//   - Public/Private lock: owner-only.
	//   - Download: any signed-in user (owner or not). Hidden for anonymous
	//     viewers — the API rejects unauthenticated downloads anyway, and
	//     surfacing a button that immediately bounces to / is noise.
	//   - Delete: owner-only.

	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import {
		cloudApi,
		ApiError,
		UnauthorizedError,
		type CollectionInfo,
	} from "$lib/api-cloud";

	interface Props {
		gameId: string;
		isOwner: boolean;
		isPublic: boolean;
		collections?: CollectionInfo[];
		currentCollectionId?: number | null;
		// Owner-set title (null = falls back to the save's original name) and
		// the save's original game_name. Both feed the rename control's
		// prefill + Reset affordance; the breadcrumb leaf shows the result.
		displayName?: string | null;
		gameName?: string | null;
	}

	let {
		gameId,
		isOwner,
		isPublic = $bindable(),
		collections = [],
		currentCollectionId = null,
		displayName = null,
		gameName = null,
	}: Props = $props();

	type Popover = "lock" | "rename" | "collection" | "download" | "delete";
	let openPopover = $state<Popover | null>(null);

	let toggling = $state(false);
	let renaming = $state(false);
	let moving = $state(false);
	let downloading = $state(false);
	let deleting = $state(false);

	let renameValue = $state("");
	let renameError = $state<string | null>(null);

	let showNewCollectionInput = $state(false);
	let newCollectionName = $state("");
	let createError = $state<string | null>(null);

	function togglePopover(name: Popover) {
		openPopover = openPopover === name ? null : name;
		if (openPopover !== "collection") {
			showNewCollectionInput = false;
			newCollectionName = "";
			createError = null;
		}
		if (openPopover === "rename") {
			// Prefill with the current effective title; empty Save clears the
			// rename (null → original game_name / nation+turns derivation).
			renameValue = displayName ?? gameName ?? "";
			renameError = null;
		}
	}

	function closePopover() {
		openPopover = null;
		showNewCollectionInput = false;
		newCollectionName = "";
		createError = null;
		renameError = null;
	}

	async function moveToCollection(collectionId: number) {
		if (moving || collectionId === currentCollectionId) {
			closePopover();
			return;
		}
		moving = true;
		try {
			await cloudApi.moveGameToCollection(gameId, collectionId);
			await invalidateAll();
			closePopover();
		} catch (err) {
			alert(`Move failed: ${err instanceof Error ? err.message : err}`);
		} finally {
			moving = false;
		}
	}

	async function createAndMoveToCollection() {
		const name = newCollectionName.trim();
		if (!name || moving) return;
		moving = true;
		createError = null;
		try {
			const created = await cloudApi.createCollection(name);
			await cloudApi.moveGameToCollection(gameId, created.collection_id);
			await invalidateAll();
			closePopover();
		} catch (err) {
			if (err instanceof ApiError && err.code === "DUPLICATE_NAME") {
				createError = "A collection with that name already exists";
				return;
			}
			createError = "Failed to create collection";
		} finally {
			moving = false;
		}
	}

	async function confirmToggleVisibility() {
		closePopover();
		if (toggling) return;
		const next = !isPublic;
		const prev = isPublic;
		isPublic = next;
		toggling = true;
		try {
			await cloudApi.toggleVisibility(gameId, next);
		} catch (err) {
			isPublic = prev;
			alert(
				`Visibility update failed: ${err instanceof Error ? err.message : err}`,
			);
		} finally {
			toggling = false;
		}
	}

	async function confirmRename(value: string | null) {
		if (renaming) return;
		renaming = true;
		renameError = null;
		try {
			await cloudApi.renameGame(gameId, value);
			await invalidateAll();
			closePopover();
		} catch (err) {
			if (err instanceof ApiError && err.status === 400) {
				renameError = err.message || "Invalid name";
				return;
			}
			renameError = err instanceof Error ? err.message : "Failed to rename";
		} finally {
			renaming = false;
		}
	}

	function submitRename() {
		const trimmed = renameValue.trim();
		confirmRename(trimmed === "" ? null : trimmed);
	}

	async function confirmDownload() {
		closePopover();
		if (downloading) return;
		downloading = true;
		try {
			const { blob, filename } = await cloudApi.downloadGame(gameId);
			// Synthetic anchor click — the standard pattern for
			// authenticated downloads. A plain `<a href>` can't carry
			// cookie auth and the response needs to land with the right
			// filename.
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		} catch (err) {
			if (err instanceof UnauthorizedError) {
				const next = encodeURIComponent(page.url.pathname);
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic next-query construction; resolve()'s branded types don't admit dynamic search strings
				await goto(`/?next=${next}`);
				return;
			}
			if (err instanceof ApiError && err.status === 429) {
				alert("Too many downloads. Try again in an hour.");
				return;
			}
			alert(`Download failed: ${err instanceof Error ? err.message : err}`);
		} finally {
			downloading = false;
		}
	}

	async function confirmDelete() {
		if (deleting) return;
		deleting = true;
		try {
			await cloudApi.deleteGame(gameId);
			// Owner-only action — page.data.user is set here. Redirect
			// to their profile (the previous /dashboard equivalent).
			const userId = page.data.user?.user_id;
			if (userId) {
				await goto(resolve(`/users/${userId}`), { replaceState: true });
			} else {
				await goto(resolve("/"), { replaceState: true });
			}
		} catch (err) {
			deleting = false;
			closePopover();
			alert(`Delete failed: ${err instanceof Error ? err.message : err}`);
		}
	}

	function handleClickOutside(event: MouseEvent) {
		if (!openPopover) return;
		const target = event.target as HTMLElement;
		if (!target.closest(".action-popover, .action-trigger")) {
			closePopover();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Escape" && openPopover) closePopover();
	}
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

<div class="flex items-center gap-2">
	{#if isOwner}
		<div class="relative">
			<button
				type="button"
				onclick={() => togglePopover("lock")}
				disabled={toggling}
				aria-pressed={isPublic}
				aria-haspopup="dialog"
				aria-expanded={openPopover === "lock"}
				title={isPublic ? "Currently Public" : "Currently Private"}
				class="action-trigger flex items-center gap-1.5 rounded border border-tan px-2 py-1 text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
			>
				{#if isPublic}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-3.5 w-3.5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
						/>
					</svg>
					<span class="text-xs">Public</span>
				{:else}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-3.5 w-3.5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
						/>
					</svg>
					<span class="text-xs">Private</span>
				{/if}
			</button>

			{#if openPopover === "lock"}
				<div
					class="action-popover absolute right-0 top-full z-50 mt-2 w-64 rounded border-2 border-black bg-blue-gray p-3 shadow-lg"
					role="dialog"
				>
					{#if isPublic}
						<p class="mb-3 text-xs text-tan">
							Make this game private? The shared link will stop working until
							you make it public again.
						</p>
					{:else}
						<p class="mb-3 text-xs text-tan">
							Make this game public? Anyone with the link will be able to view
							it.
						</p>
					{/if}
					<div class="flex justify-end gap-2">
						<button
							type="button"
							onclick={closePopover}
							class="rounded border border-tan px-2 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
						>
							Cancel
						</button>
						<button
							type="button"
							onclick={confirmToggleVisibility}
							class="hover:bg-orange/10 rounded border border-orange px-2 py-1 text-xs text-orange transition-colors"
						>
							{isPublic ? "Make private" : "Make public"}
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#if isOwner}
		<div class="relative">
			<button
				type="button"
				onclick={() => togglePopover("rename")}
				disabled={renaming}
				aria-haspopup="dialog"
				aria-expanded={openPopover === "rename"}
				title="Rename"
				class="action-trigger rounded border border-tan p-1 text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
			>
				<!-- Inline SVG pencil; no external sprite dep. -->
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 20 20"
					fill="currentColor"
					class="h-3.5 w-3.5"
					aria-hidden="true"
				>
					<path
						d="M13.586 3.586a2 2 0 1 1 2.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793 4 13.172V16h2.828l7.379-7.379-2.828-2.828z"
					/>
				</svg>
			</button>

			{#if openPopover === "rename"}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="action-popover absolute right-0 top-full z-50 mt-2 w-64 rounded border-2 border-black bg-blue-gray p-3 shadow-lg"
					role="dialog"
					tabindex="-1"
					onclick={(e) => e.stopPropagation()}
				>
					<p class="mb-2 text-xs font-semibold text-tan">Rename save</p>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						type="text"
						bind:value={renameValue}
						maxlength={120}
						placeholder={gameName ?? "Save title"}
						autofocus
						disabled={renaming}
						class="w-full rounded border border-[#4a433b] bg-[#35302b] px-2 py-1 text-sm text-tan placeholder:text-[#c5c3c2] focus:border-[#5a524a] focus:outline-none"
						onkeydown={(e) => {
							if (e.key === "Enter") submitRename();
							if (e.key === "Escape") closePopover();
						}}
					/>
					{#if renameError}
						<p class="mt-1 text-[10px] text-orange">{renameError}</p>
					{/if}
					<div class="mt-2 flex justify-end gap-2">
						{#if displayName != null && displayName.trim() !== ""}
							<button
								type="button"
								onclick={() => confirmRename(null)}
								disabled={renaming}
								title="Clear the rename and fall back to the save's original title"
								class="mr-auto rounded border border-tan px-2 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
							>
								Reset
							</button>
						{/if}
						<button
							type="button"
							onclick={closePopover}
							class="rounded border border-tan px-2 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
						>
							Cancel
						</button>
						<button
							type="button"
							onclick={submitRename}
							disabled={renaming}
							class="hover:bg-orange/10 rounded border border-orange px-2 py-1 text-xs text-orange transition-colors disabled:opacity-50"
						>
							Save
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#if isOwner}
		<div class="relative">
			<button
				type="button"
				onclick={() => togglePopover("collection")}
				disabled={moving}
				aria-haspopup="dialog"
				aria-expanded={openPopover === "collection"}
				title="Add to collection"
				class="action-trigger rounded border border-tan p-1 text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-3.5 w-3.5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
					aria-hidden="true"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
					/>
				</svg>
			</button>

			{#if openPopover === "collection"}
				<!--
					stopPropagation here because clicks on inline-toggle controls
					inside this popover (e.g. "+ New collection…", Cancel) swap
					the clicked element out of the DOM via {#if}; by the time the
					click bubbles to the window-level handleClickOutside,
					target.closest() can no longer find the popover and it gets
					closed unintentionally.
				-->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="action-popover absolute right-0 top-full z-50 mt-2 w-56 rounded border-2 border-black bg-blue-gray p-2 shadow-lg"
					role="dialog"
					tabindex="-1"
					onclick={(e) => e.stopPropagation()}
				>
					<p class="mb-2 px-1 text-xs font-semibold text-tan">
						Move to collection
					</p>
					<div class="max-h-56 overflow-y-auto">
						{#each collections as c (c.collection_id)}
							{@const isCurrent = c.collection_id === currentCollectionId}
							<button
								type="button"
								onclick={() => moveToCollection(c.collection_id)}
								disabled={moving}
								class="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs text-tan transition-colors hover:bg-[#35302b] disabled:opacity-50 {isCurrent
									? 'bg-[#35302b]'
									: ''}"
							>
								<span class="truncate">{c.name}</span>
								{#if isCurrent}
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-3.5 w-3.5 shrink-0 text-orange"
										viewBox="0 0 20 20"
										fill="currentColor"
										aria-hidden="true"
									>
										<path
											fill-rule="evenodd"
											d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
											clip-rule="evenodd"
										/>
									</svg>
								{/if}
							</button>
						{/each}
					</div>

					<div class="mt-1 border-t border-black pt-1">
						{#if showNewCollectionInput}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								type="text"
								bind:value={newCollectionName}
								placeholder="Collection name"
								autofocus
								class="w-full rounded border border-[#4a433b] bg-[#35302b] px-2 py-1 text-xs text-tan placeholder:text-[#c5c3c2] focus:border-[#5a524a] focus:outline-none"
								onkeydown={(e) => {
									if (e.key === "Enter") createAndMoveToCollection();
									if (e.key === "Escape") {
										showNewCollectionInput = false;
										newCollectionName = "";
										createError = null;
									}
								}}
							/>
							{#if createError}
								<p class="mt-1 px-1 text-[10px] text-orange">{createError}</p>
							{/if}
							<div class="mt-1 flex justify-end gap-2">
								<button
									type="button"
									onclick={() => {
										showNewCollectionInput = false;
										newCollectionName = "";
										createError = null;
									}}
									class="rounded border border-tan px-2 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
								>
									Cancel
								</button>
								<button
									type="button"
									onclick={createAndMoveToCollection}
									disabled={!newCollectionName.trim() || moving}
									class="hover:bg-orange/10 rounded border border-orange px-2 py-1 text-xs text-orange transition-colors disabled:opacity-50"
								>
									Create
								</button>
							</div>
						{:else}
							<button
								type="button"
								onclick={() => {
									showNewCollectionInput = true;
								}}
								class="w-full rounded px-2 py-1 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
							>
								+ New collection…
							</button>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#if page.data.user}
		<div class="relative">
			<button
				type="button"
				onclick={() => togglePopover("download")}
				disabled={downloading}
				aria-haspopup="dialog"
				aria-expanded={openPopover === "download"}
				title="Download"
				class="action-trigger rounded border border-tan p-1 text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
			>
				{#if downloading}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-3.5 w-3.5 animate-spin"
						fill="none"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<circle
							class="opacity-25"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							stroke-width="4"
						></circle>
						<path
							class="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
						></path>
					</svg>
				{:else}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-3.5 w-3.5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
						/>
					</svg>
				{/if}
			</button>

			{#if openPopover === "download"}
				<div
					class="action-popover absolute right-0 top-full z-50 mt-2 w-56 rounded border-2 border-black bg-blue-gray p-3 shadow-lg"
					role="dialog"
				>
					<p class="mb-3 text-xs text-tan">Download the original save file?</p>
					<div class="flex justify-end gap-2">
						<button
							type="button"
							onclick={closePopover}
							class="rounded border border-tan px-2 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
						>
							Cancel
						</button>
						<button
							type="button"
							onclick={confirmDownload}
							class="hover:bg-orange/10 rounded border border-orange px-2 py-1 text-xs text-orange transition-colors"
						>
							Download
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#if isOwner}
		<div class="relative">
			<button
				type="button"
				onclick={() => togglePopover("delete")}
				disabled={deleting}
				aria-haspopup="dialog"
				aria-expanded={openPopover === "delete"}
				title="Delete"
				class="action-trigger rounded border p-1 transition-colors disabled:opacity-50 {openPopover ===
				'delete'
					? 'border-red-400 text-red-400'
					: 'border-tan text-tan hover:border-red-400 hover:text-red-400'}"
			>
				{#if deleting}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-3.5 w-3.5 animate-spin"
						fill="none"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<circle
							class="opacity-25"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							stroke-width="4"
						></circle>
						<path
							class="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
						></path>
					</svg>
				{:else}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-3.5 w-3.5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.16-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.04-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
						/>
					</svg>
				{/if}
			</button>

			{#if openPopover === "delete"}
				<div
					class="action-popover absolute right-0 top-full z-50 mt-2 w-56 rounded border-2 border-black bg-blue-gray p-3 shadow-lg"
					role="dialog"
				>
					<p class="mb-3 text-xs text-tan">Delete this game permanently?</p>
					<div class="flex justify-end gap-2">
						<button
							type="button"
							onclick={closePopover}
							class="rounded border border-tan px-2 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
						>
							Cancel
						</button>
						<button
							type="button"
							onclick={confirmDelete}
							disabled={deleting}
							class="rounded border border-red-400 px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-400/10 disabled:opacity-50"
						>
							Delete
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
