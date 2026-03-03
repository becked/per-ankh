<script lang="ts">
	import { api } from "$lib/api";
	import { showConfirm } from "$lib/utils/dialogs";
	import { refreshData } from "$lib/stores/refresh";
	import type { ShareInfo } from "$lib/types/ShareInfo";

	interface Props {
		matchId: number;
	}

	let { matchId }: Props = $props();

	type ShareStatus = "loading" | "not_shared" | "sharing" | "shared" | "deleting" | "error";

	// State as separate variables to match codebase patterns
	let shareInfo = $state<ShareInfo | null>(null);
	let status = $state<ShareStatus>("loading");
	let errorMessage = $state<string | null>(null);
	let popoverOpen = $state(false);
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;
	let urlInput = $state<HTMLInputElement | null>(null);

	function formatSharedDate(timestamp: string): string {
		// DuckDB CURRENT_TIMESTAMP is UTC but the cast-to-string has no timezone indicator;
		// append "Z" so JavaScript parses it as UTC
		const date = new Date(timestamp.replace(" ", "T") + "Z");
		const month = date.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
		const day = date.getUTCDate();
		const year = date.getUTCFullYear();
		const ordinal =
			day % 10 === 1 && day !== 11
				? "st"
				: day % 10 === 2 && day !== 12
					? "nd"
					: day % 10 === 3 && day !== 13
						? "rd"
						: "th";
		return `${month} ${day}${ordinal}, ${year}`;
	}

	// Load share status on mount / matchId change
	$effect(() => {
		const id = matchId; // track dependency
		loadShareInfo(id);
	});

	async function loadShareInfo(id: number) {
		status = "loading";
		errorMessage = null;
		try {
			const info = await api.getShareInfo(id);
			if (info) {
				shareInfo = info;
				status = "shared";
			} else {
				shareInfo = null;
				status = "not_shared";
			}
		} catch (err) {
			errorMessage = String(err);
			status = "error";
		}
	}

	async function handleShare() {
		status = "sharing";
		errorMessage = null;
		try {
			const info = await api.shareGame(matchId);
			shareInfo = info;
			status = "shared";
			popoverOpen = true;
			refreshData.trigger();
		} catch (err) {
			errorMessage = String(err);
			status = "error";
		}
	}

	async function handleDelete() {
		if (status !== "shared" || !shareInfo) return;

		const confirmed = await showConfirm(
			"Delete this shared link? Anyone with the URL will no longer be able to view it.",
			"Delete Share",
		);
		if (!confirmed) return;

		status = "deleting";
		try {
			await api.deleteShare(matchId);
			shareInfo = null;
			status = "not_shared";
			popoverOpen = false;
			refreshData.trigger();
		} catch (err) {
			errorMessage = String(err);
			status = "error";
		}
	}

	async function handleCopy() {
		if (!shareInfo) return;
		try {
			await navigator.clipboard.writeText(shareInfo.share_url);
			copied = true;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => {
				copied = false;
				copyTimer = null;
			}, 2000);
		} catch {
			// Fallback: select text so user can Ctrl+C
			urlInput?.select();
		}
	}

	async function handleNativeShare() {
		if (!shareInfo) return;
		try {
			if (navigator.share) {
				await navigator.share({
					title: "Per Ankh — Game Analytics",
					url: shareInfo.share_url,
				});
			} else {
				await handleCopy();
			}
		} catch {
			// User cancelled native share dialog
		}
	}

	function handleRetry() {
		if (shareInfo) {
			// Was shared before error (e.g., delete failed) — restore
			status = "shared";
			errorMessage = null;
		} else {
			loadShareInfo(matchId);
		}
	}

	function handleClickOutside(event: MouseEvent) {
		if (!popoverOpen) return;
		const target = event.target as HTMLElement;
		if (!target.closest(".share-control")) {
			popoverOpen = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Escape" && popoverOpen) {
			popoverOpen = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

<div class="share-control relative">
	{#if status === "loading"}
		<div class="flex h-8 w-8 items-center justify-center">
			<svg
				class="h-4 w-4 animate-spin text-brown"
				xmlns="http://www.w3.org/2000/svg"
				fill="none"
				viewBox="0 0 24 24"
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
		</div>
	{:else if status === "not_shared"}
		<button
			type="button"
			class="flex items-center gap-1.5 rounded border border-brown/30 px-2.5 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
			onclick={handleShare}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-3.5 w-3.5"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
				/>
			</svg>
			Share
		</button>
	{:else if status === "sharing"}
		<button
			type="button"
			class="flex items-center gap-1.5 rounded border border-brown/30 px-2.5 py-1 text-xs text-brown"
			disabled
		>
			<svg
				class="h-3.5 w-3.5 animate-spin"
				xmlns="http://www.w3.org/2000/svg"
				fill="none"
				viewBox="0 0 24 24"
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
			Sharing...
		</button>
	{:else if status === "shared" && shareInfo}
		<button
			type="button"
			class="flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs transition-colors {popoverOpen
				? 'border-orange text-orange'
				: 'border-brown/30 text-tan hover:border-orange hover:text-orange'}"
			onclick={() => (popoverOpen = !popoverOpen)}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-3.5 w-3.5"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
				/>
			</svg>
			Shared
		</button>

		{#if popoverOpen}
			<div
				class="absolute right-0 top-full z-50 mt-2 w-72 rounded border-2 border-black bg-blue-gray p-3 shadow-lg"
			>
				<div class="mb-1 text-xs font-bold uppercase tracking-wide text-brown">
					Share Link
				</div>
				<div class="mb-2 text-[10px] text-brown">
					Shared {formatSharedDate(shareInfo.shared_at)}
				</div>

				<div class="mb-3 flex items-center gap-1.5">
					<input
						bind:this={urlInput}
						type="text"
						readonly
						value={shareInfo.share_url}
						class="flex-1 rounded border border-brown/30 bg-[#1a1714] px-2 py-1 text-xs text-tan"
						onclick={(e) => (e.target as HTMLInputElement).select()}
					/>
					<button
						type="button"
						class="rounded border border-brown/30 px-2 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
						onclick={handleCopy}
					>
						{copied ? "Copied!" : "Copy"}
					</button>
				</div>

				<div class="flex items-center justify-between">
					<button
						type="button"
						class="text-xs text-brown transition-colors hover:text-orange"
						onclick={handleNativeShare}
					>
						Share via...
					</button>
					<button
						type="button"
						class="text-xs text-red-400 transition-colors hover:text-red-300"
						onclick={handleDelete}
					>
						Delete share
					</button>
				</div>
			</div>
		{/if}
	{:else if status === "deleting"}
		<button
			type="button"
			class="flex items-center gap-1.5 rounded border border-brown/30 px-2.5 py-1 text-xs text-brown"
			disabled
		>
			<svg
				class="h-3.5 w-3.5 animate-spin"
				xmlns="http://www.w3.org/2000/svg"
				fill="none"
				viewBox="0 0 24 24"
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
			Deleting...
		</button>
	{:else if status === "error"}
		<div class="flex items-center gap-2">
			<span class="max-w-48 truncate text-xs text-red-400" title={errorMessage}>{errorMessage}</span>
			<button
				type="button"
				class="text-xs text-tan underline transition-colors hover:text-orange"
				onclick={handleRetry}
			>
				Retry
			</button>
		</div>
	{/if}
</div>
