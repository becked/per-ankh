<script lang="ts">
  import { goto } from "$app/navigation";
  import ImportModal from "$lib/ImportModal.svelte";

  import { api } from "$lib/api";
  import type { ImportProgress } from "$lib/types/ImportProgress";
  import type { BatchImportResult } from "$lib/types/BatchImportResult";

  let isSettingsOpen = $state(false);
  let isImportModalOpen = $state(false);
  let importProgress: ImportProgress | null = $state(null);
  let importResult: BatchImportResult | null = $state(null);

  function navigateToSummary() {
    goto("/");
  }

  function toggleSettings() {
    isSettingsOpen = !isSettingsOpen;
  }

  async function handleImportFiles() {
    isSettingsOpen = false;

    // Reset state from previous import
    importProgress = null;
    importResult = null;

    // Show modal immediately with importing state
    isImportModalOpen = true;

    try {
      // Open file picker and start import
      // Note: Real-time progress events don't work in Tauri 2.x currently
      // See docs/tauri-progress-events-investigation.md for details
      const result = await api.importFiles();
      importResult = result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      // If user cancelled, close modal
      if (errorMsg.includes("No files selected") || errorMsg.includes("cancelled")) {
        isImportModalOpen = false;
      }
    }
  }

  function closeImportModal() {
    isImportModalOpen = false;
    importProgress = null;
    importResult = null;
  }

  function handleImportComplete() {
    // Reload the page to show newly imported games
    window.location.reload();
  }

  // Close settings dropdown when clicking outside
  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest(".settings-container")) {
      isSettingsOpen = false;
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<header
  data-tauri-drag-region
  class="w-full bg-blue-gray border-b-[3px] border-black px-4 pt-6 pb-2 flex items-center justify-between"
>
  <button
    class="cursor-pointer text-left transition-opacity hover:opacity-80"
    type="button"
    onclick={navigateToSummary}
  >
    <div class="text-3xl font-bold text-gray-200 border-b-2 border-orange pb-1">☥ Per Ankh</div>
  </button>

  <!-- Settings dropdown -->
  <div class="settings-container relative">
    <button
      class="text-orange hover:text-tan transition-colors p-2"
      type="button"
      onclick={toggleSettings}
      aria-label="Settings"
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

    {#if isSettingsOpen}
      <div
        class="absolute right-0 mt-2 w-48 bg-blue-gray border-2 border-black rounded shadow-lg z-50"
      >
        <button
          class="w-full text-left px-4 py-2 text-tan hover:bg-brown transition-colors"
          type="button"
          onclick={handleImportFiles}
        >
          Import Save Files
        </button>
      </div>
    {/if}
  </div>
</header>

<ImportModal
  bind:isOpen={isImportModalOpen}
  initialProgress={importProgress}
  initialResult={importResult}
  onClose={closeImportModal}
  onImportComplete={handleImportComplete}
/>
