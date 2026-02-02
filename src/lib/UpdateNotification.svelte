<script lang="ts">
  import type { Update } from "@tauri-apps/plugin-updater";
  import { downloadAndInstall } from "$lib/utils/updater";

  interface Props {
    update: Update;
    onDismiss: () => void;
  }

  let { update, onDismiss }: Props = $props();

  let isDownloading = $state(false);
  let downloadProgress = $state(0);
  let error = $state<string | null>(null);

  async function handleUpdate() {
    isDownloading = true;
    error = null;
    try {
      await downloadAndInstall(update, (percent) => {
        downloadProgress = percent;
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      isDownloading = false;
    }
  }
</script>

<div class="fixed top-20 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-4">
  <div class="bg-blue-gray border-2 border-orange rounded-lg shadow-lg p-4">
    <div class="flex items-start gap-3">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 text-orange flex-shrink-0 mt-0.5"
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

      <div class="flex-1">
        <h3 class="text-tan font-semibold">Update Available</h3>
        <p class="text-sm text-gray-400 mt-1">
          Version {update.version} is available. You are running {update.currentVersion}.
        </p>

        {#if error}
          <p class="text-sm text-red-400 mt-2">{error}</p>
        {/if}

        {#if isDownloading}
          <div class="mt-3">
            <div class="w-full bg-gray-700 rounded-full h-2">
              <div
                class="bg-orange h-2 rounded-full transition-all duration-300"
                style="width: {downloadProgress}%"
              ></div>
            </div>
            <p class="text-xs text-gray-400 mt-1">Downloading... {downloadProgress}%</p>
          </div>
        {:else}
          <div class="flex gap-2 mt-3">
            <button
              type="button"
              class="px-3 py-1.5 text-sm bg-brown hover:opacity-80 text-tan border border-black rounded transition-opacity"
              onclick={handleUpdate}
            >
              Update Now
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-sm text-gray-400 hover:text-tan transition-colors"
              onclick={onDismiss}
            >
              Later
            </button>
          </div>
        {/if}
      </div>

      {#if !isDownloading}
        <button
          type="button"
          class="text-gray-400 hover:text-tan transition-colors"
          onclick={onDismiss}
          aria-label="Dismiss"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      {/if}
    </div>
  </div>
</div>
