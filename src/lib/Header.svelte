<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount, onDestroy } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import ImportModal from "$lib/ImportModal.svelte";
  import SettingsModal from "$lib/SettingsModal.svelte";
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
      if (errorMsg.includes("No files selected") || errorMsg.includes("cancelled")) {
        isImportModalOpen = false;
      }
    }
  }

  async function handleResetDatabase() {
    isMenuOpen = false;

    const confirmed = await showConfirm(
      "Are you sure you want to reset the database? This will delete all imported game data and cannot be undone."
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
    progressUnlisten = await listen<ImportProgress>("import-progress", (event) => {
      importProgress = event.payload;
    });

    // Listen for completion event
    completeUnlisten = await listen<BatchImportResult>("import-complete", (event) => {
      importResult = event.payload;
    });
  });

  onDestroy(() => {
    if (progressUnlisten) progressUnlisten();
    if (completeUnlisten) completeUnlisten();
  });
</script>

<svelte:window onclick={handleClickOutside} />

<header
  data-tauri-drag-region
  class="w-full bg-blue-gray border-b-[3px] border-black px-4 pt-6 pb-2 flex items-center justify-between relative"
>
  <!-- Menu dropdown on the left -->
  <div class="menu-container flex-shrink-0">
    <button
      class="text-orange hover:text-tan transition-colors pr-2 py-2"
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
        class="absolute left-0 mt-2 w-48 bg-blue-gray border-2 border-black rounded shadow-lg z-50"
      >
        <button
          class="w-full text-left px-4 py-2 text-tan hover:bg-brown transition-colors"
          type="button"
          onclick={() => { isMenuOpen = false; goto("/"); }}
        >
          Overview
        </button>
        <button
          class="w-full text-left px-4 py-2 text-tan hover:bg-brown transition-colors border-t border-gray-600"
          type="button"
          onclick={handleImportFiles}
        >
          Import Save Files
        </button>
        <button
          class="w-full text-left px-4 py-2 text-tan hover:bg-brown transition-colors border-t border-gray-600"
          type="button"
          onclick={openSettingsModal}
        >
          Set Primary User
        </button>
        <button
          class="w-full text-left px-4 py-2 text-tan hover:bg-brown transition-colors border-t border-gray-600"
          type="button"
          onclick={handleResetDatabase}
        >
          Reset Database
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
    <div class="text-3xl font-bold text-gray-200 border-b-2 border-orange pb-1">𓉑 Per Ankh</div>
  </button>

  <!-- Search box on the right -->
  <SearchInput
    bind:value={$searchQuery}
    variant="dark"
    class="flex-shrink-0 w-[171px] -mr-4 pr-2 pl-1"
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
  onClose={() => { isSettingsModalOpen = false; }}
/>
