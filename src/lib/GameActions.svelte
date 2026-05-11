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
	//     surfacing a button that immediately bounces to /login is noise.
	//   - Delete: owner-only.

	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { cloudApi, ApiError, UnauthorizedError } from "$lib/api-cloud";

	interface Props {
		gameId: string;
		isOwner: boolean;
		isPublic: boolean;
	}

	let { gameId, isOwner, isPublic = $bindable() }: Props = $props();

	type Popover = "lock" | "download" | "delete";
	let openPopover = $state<Popover | null>(null);

	let toggling = $state(false);
	let downloading = $state(false);
	let deleting = $state(false);

	function togglePopover(name: Popover) {
		openPopover = openPopover === name ? null : name;
	}

	function closePopover() {
		openPopover = null;
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
				await goto(`/login?next=${next}`);
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
			await goto(resolve("/dashboard"), { replaceState: true });
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
				class="action-trigger rounded border border-tan p-1 text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
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
