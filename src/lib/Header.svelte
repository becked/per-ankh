<script lang="ts">
	import { goto } from "$app/navigation";
	import { onMount, onDestroy } from "svelte";
	import { listen, type UnlistenFn } from "@tauri-apps/api/event";
	import ImportModal from "$lib/ImportModal.svelte";
	import SettingsModal from "$lib/SettingsModal.svelte";
	import CollectionsModal from "$lib/CollectionsModal.svelte";
	import UpdateModal from "$lib/UpdateModal.svelte";
	import SearchInput from "$lib/SearchInput.svelte";

	import { api } from "$lib/api";
	import type { ImportProgress } from "$lib/types/ImportProgress";
	import type { BatchImportResult } from "$lib/types/BatchImportResult";
	import { refreshData } from "$lib/stores/refresh";
	import { searchQuery } from "$lib/stores/search";
	import { showConfirm, showSuccess, showError } from "$lib/utils/dialogs";

	let isMenuOpen = $state(false);
	let isImportModalOpen = $state(false);
	let isSettingsModalOpen = $state(false);
	let isCollectionsModalOpen = $state(false);
	let isUpdateModalOpen = $state(false);
	let importProgress: ImportProgress | null = $state(null);
	let importResult: BatchImportResult | null = $state(null);

	function navigateToSummary() {
		goto("/");
	}

	function toggleMenu() {
		isMenuOpen = !isMenuOpen;
	}

	function openSettingsModal() {
		isMenuOpen = false;
		isSettingsModalOpen = true;
	}

	function openCollectionsModal() {
		isMenuOpen = false;
		isCollectionsModalOpen = true;
	}

	function openUpdateModal() {
		isMenuOpen = false;
		isUpdateModalOpen = true;
	}

	async function handleImportFiles() {
		isMenuOpen = false;

		// Reset state from previous import
		importProgress = null;
		importResult = null;

		// Show modal immediately with importing state
		isImportModalOpen = true;

		try {
			// This now returns immediately after spawning the import task
			await api.importFiles();
			// Modal stays open, listening for events
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			// If user cancelled, close modal
			if (
				errorMsg.includes("No files selected") ||
				errorMsg.includes("cancelled")
			) {
				isImportModalOpen = false;
			}
		}
	}

	async function handleResetDatabase() {
		isMenuOpen = false;

		const confirmed = await showConfirm(
			"Are you sure you want to reset the database? This will delete all imported game data and cannot be undone.",
		);

		if (!confirmed) {
			return;
		}

		try {
			await api.resetDatabase();
			await showSuccess("Database reset successfully.");
			refreshData.trigger();
			goto("/"); // Navigate to summary page after reset
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			await showError(`Failed to reset database: ${errorMsg}`);
		}
	}

	function closeImportModal() {
		isImportModalOpen = false;
		importProgress = null;
		importResult = null;
	}

	function handleImportComplete() {
		// Trigger data refresh to show newly imported games
		refreshData.trigger();
	}

	// Close menu dropdown when clicking outside
	function handleClickOutside(event: MouseEvent) {
		if (!isMenuOpen) {
			return;
		}

		const target = event.target as HTMLElement;
		const closestMenu = target.closest(".menu-container");

		if (!closestMenu) {
			isMenuOpen = false;
		}
	}

	let progressUnlisten: UnlistenFn | null = null;
	let completeUnlisten: UnlistenFn | null = null;

	onMount(async () => {
		// Listen for progress events
		progressUnlisten = await listen<ImportProgress>(
			"import-progress",
			(event) => {
				importProgress = event.payload;
			},
		);

		// Listen for completion event
		completeUnlisten = await listen<BatchImportResult>(
			"import-complete",
			(event) => {
				importResult = event.payload;
			},
		);
	});

	onDestroy(() => {
		if (progressUnlisten) progressUnlisten();
		if (completeUnlisten) completeUnlisten();
	});
</script>

<svelte:window onclick={handleClickOutside} />

<header
	data-tauri-drag-region
	class="relative flex w-full items-center justify-between border-b-[3px] border-black bg-blue-gray px-4 pb-2 pt-6"
>
	<!-- Menu dropdown on the left -->
	<div class="menu-container flex-shrink-0">
		<button
			class="py-2 pr-2 text-orange transition-colors hover:text-tan"
			type="button"
			onclick={toggleMenu}
			aria-label="Menu"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-6 w-6"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M4 6h16M4 12h16M4 18h16"
				/>
			</svg>
		</button>

		{#if isMenuOpen}
			<div
				class="absolute left-0 z-50 mt-2 w-48 rounded border-2 border-black bg-blue-gray shadow-lg"
			>
				<button
					class="w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
					type="button"
					onclick={() => {
						isMenuOpen = false;
						goto("/");
					}}
				>
					Overview
				</button>
				<div class="border-t border-black"></div>
				<button
					class="w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
					type="button"
					onclick={handleImportFiles}
				>
					Import Save Files
				</button>
				<button
					class="w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
					type="button"
					onclick={openSettingsModal}
				>
					Set Primary User
				</button>
				<button
					class="w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
					type="button"
					onclick={openCollectionsModal}
				>
					Manage Collections
				</button>
				<button
					class="w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
					type="button"
					onclick={handleResetDatabase}
				>
					Reset Database
				</button>
				<div class="border-t border-black"></div>
				<button
					class="w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
					type="button"
					onclick={openUpdateModal}
				>
					Check for Updates...
				</button>
			</div>
		{/if}
	</div>

	<!-- Title in the center -->
	<button
		class="absolute left-1/2 -translate-x-1/2 cursor-pointer text-left transition-opacity hover:opacity-80"
		type="button"
		onclick={navigateToSummary}
	>
		<div class="border-b-2 border-orange pb-1 text-3xl font-bold text-gray-200">
			𓉑 Per Ankh
		</div>
	</button>

	<!-- Search box on the right -->
	<SearchInput
		bind:value={$searchQuery}
		variant="dark"
		class="-mr-4 w-[171px] flex-shrink-0 pl-1 pr-2"
	/>
</header>

<ImportModal
	bind:isOpen={isImportModalOpen}
	progress={importProgress}
	result={importResult}
	onClose={closeImportModal}
	onImportComplete={handleImportComplete}
/>

<SettingsModal
	bind:isOpen={isSettingsModalOpen}
	onClose={() => {
		isSettingsModalOpen = false;
	}}
/>

<CollectionsModal
	bind:isOpen={isCollectionsModalOpen}
	onClose={() => {
		isCollectionsModalOpen = false;
	}}
/>

<UpdateModal
	bind:isOpen={isUpdateModalOpen}
	onClose={() => {
		isUpdateModalOpen = false;
	}}
/>
