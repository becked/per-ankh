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
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-blue-gray border-2 border-black p-6 rounded-lg shadow-lg max-w-md w-full mx-4">
      <h2 class="text-2xl font-bold text-tan mb-4 border-b-2 border-orange pb-2">
        Software Update
      </h2>

      <div class="mb-6 min-h-[100px]">
        {#if checking}
          <div class="text-tan py-4 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-orange mb-2"
            ></div>
            <p>Checking for updates...</p>
          </div>
        {:else if error}
          <div class="text-center py-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-12 w-12 text-red-500 mx-auto mb-2"
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
              class="mt-4 px-4 py-2 text-sm bg-brown hover:opacity-80 text-tan border border-black rounded transition-opacity"
              onclick={handleCheckForUpdates}
            >
              Try Again
            </button>
          </div>
        {:else if isUpToDate}
          <div class="text-center py-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-12 w-12 text-green-500 mx-auto mb-2"
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
            <p class="text-tan font-semibold">Per Ankh is up to date</p>
            {#if currentVersion}
              <p class="text-sm text-gray-400 mt-1">Version {currentVersion}</p>
            {/if}
          </div>
        {:else if update}
          {#if isDownloading}
            <div class="text-center py-4">
              <p class="text-tan font-semibold mb-2">Downloading update...</p>
              <div class="w-full bg-gray-700 rounded-full h-3 mb-2">
                <div
                  class="bg-orange h-3 rounded-full transition-all duration-300"
                  style="width: {downloadProgress}%"
                ></div>
              </div>
              <p class="text-sm text-gray-400">{downloadProgress}% complete</p>
              <p class="text-xs text-gray-500 mt-2">
                The app will restart automatically when complete.
              </p>
            </div>
          {:else}
            <div class="text-center py-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-12 w-12 text-orange mx-auto mb-2"
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
              <p class="text-tan font-semibold">Update Available</p>
              <p class="text-sm text-gray-400 mt-1">
                Version {update.version} is ready to install
              </p>
              <p class="text-xs text-gray-500 mt-1">
                Current version: {update.currentVersion}
              </p>
              <button
                type="button"
                class="mt-4 px-6 py-2 bg-brown hover:opacity-80 text-tan font-semibold border-2 border-black rounded transition-opacity"
                onclick={handleUpdate}
              >
                Download and Install
              </button>
            </div>
          {/if}
        {/if}
      </div>

      <button
        class="w-full bg-brown hover:opacity-80 text-tan font-semibold py-2 px-4 border-2 border-black rounded transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        type="button"
        onclick={handleClose}
        disabled={isDownloading}
      >
        {isDownloading ? "Installing..." : "Close"}
      </button>
    </div>
  </div>
{/if}
