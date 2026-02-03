<script lang="ts">
	import type { Update } from "@tauri-apps/plugin-updater";
	import { checkForUpdates, downloadAndInstall } from "$lib/utils/updater";

	interface Props {
		isOpen: boolean;
		onClose: () => void;
	}

	let { isOpen = $bindable(), onClose }: Props = $props();

	let checking = $state(false);
	let update = $state<Update | null>(null);
	let currentVersion = $state<string | null>(null);
	let isUpToDate = $state(false);
	let isDownloading = $state(false);
	let downloadProgress = $state(0);
	let error = $state<string | null>(null);

	async function handleCheckForUpdates() {
		checking = true;
		error = null;
		isUpToDate = false;
		update = null;

		try {
			const result = await checkForUpdates();
			if (result.available && result.update) {
				update = result.update;
				currentVersion = result.currentVersion;
			} else {
				isUpToDate = true;
				currentVersion = result.currentVersion;
			}
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			checking = false;
		}
	}

	async function handleUpdate() {
		if (!update) return;

		isDownloading = true;
		error = null;
		downloadProgress = 0;

		try {
			await downloadAndInstall(update, (percent) => {
				downloadProgress = percent;
			});
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			isDownloading = false;
		}
	}

	function handleClose() {
		if (!isDownloading) {
			onClose();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Escape" && !isDownloading) {
			onClose();
		}
	}

	$effect(() => {
		if (isOpen) {
			update = null;
			isUpToDate = false;
			error = null;
			isDownloading = false;
			downloadProgress = 0;
			handleCheckForUpdates();
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
	>
		<div
			class="mx-4 w-full max-w-md rounded-lg border-2 border-black bg-blue-gray p-6 shadow-lg"
		>
			<h2
				class="mb-4 border-b-2 border-orange pb-2 text-2xl font-bold text-tan"
			>
				Software Update
			</h2>

			<div class="mb-6 min-h-[100px]">
				{#if checking}
					<div class="py-4 text-center text-tan">
						<div
							class="mb-2 inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-orange"
						></div>
						<p>Checking for updates...</p>
					</div>
				{:else if error}
					<div class="py-4 text-center">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="mx-auto mb-2 h-12 w-12 text-red-500"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
							/>
						</svg>
						<p class="text-red-400">{error}</p>
						<button
							type="button"
							class="mt-4 rounded border border-black bg-brown px-4 py-2 text-sm text-tan transition-opacity hover:opacity-80"
							onclick={handleCheckForUpdates}
						>
							Try Again
						</button>
					</div>
				{:else if isUpToDate}
					<div class="py-4 text-center">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="mx-auto mb-2 h-12 w-12 text-green-500"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<p class="font-semibold text-tan">Per Ankh is up to date</p>
						{#if currentVersion}
							<p class="mt-1 text-sm text-gray-400">Version {currentVersion}</p>
						{/if}
					</div>
				{:else if update}
					{#if isDownloading}
						<div class="py-4 text-center">
							<p class="mb-2 font-semibold text-tan">Downloading update...</p>
							<div class="mb-2 h-3 w-full rounded-full bg-gray-700">
								<div
									class="h-3 rounded-full bg-orange transition-all duration-300"
									style="width: {downloadProgress}%"
								></div>
							</div>
							<p class="text-sm text-gray-400">{downloadProgress}% complete</p>
							<p class="mt-2 text-xs text-gray-500">
								The app will restart automatically when complete.
							</p>
						</div>
					{:else}
						<div class="py-4 text-center">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="mx-auto mb-2 h-12 w-12 text-orange"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
								/>
							</svg>
							<p class="font-semibold text-tan">Update Available</p>
							<p class="mt-1 text-sm text-gray-400">
								Version {update.version} is ready to install
							</p>
							<p class="mt-1 text-xs text-gray-500">
								Current version: {update.currentVersion}
							</p>
							<button
								type="button"
								class="mt-4 rounded border-2 border-black bg-brown px-6 py-2 font-semibold text-tan transition-opacity hover:opacity-80"
								onclick={handleUpdate}
							>
								Download and Install
							</button>
						</div>
					{/if}
				{/if}
			</div>

			<button
				class="w-full rounded border-2 border-black bg-brown px-4 py-2 font-semibold text-tan transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
				type="button"
				onclick={handleClose}
				disabled={isDownloading}
			>
				{isDownloading ? "Installing..." : "Close"}
			</button>
		</div>
	</div>
{/if}
