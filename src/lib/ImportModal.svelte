<script lang="ts">
  import { Progress } from "bits-ui";
  import type { ImportProgress } from "$lib/types/ImportProgress";
  import type { BatchImportResult } from "$lib/types/BatchImportResult";

  interface Props {
    isOpen: boolean;
    progress: ImportProgress | null;
    result: BatchImportResult | null;
    onClose: () => void;
    onImportComplete?: () => void;
  }

  let { isOpen = $bindable(), progress, result, onClose, onImportComplete }: Props = $props();

  let isImporting = $derived(result === null);
  let error: string | null = $state(null);

  const progressPercentage = $derived.by(() => {
    if (!progress) return 0;
    const p = progress as ImportProgress;
    return Math.round((p.current / p.total) * 100);
  });

  const formatTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const formatSpeed = (speed: number): string => {
    return speed.toFixed(1);
  };

  function handleClose() {
    if (!isImporting) {
      error = null;

      // If there were successful imports, reload the page to show them
      // Do this BEFORE calling onClose() so the page reloads with the modal still visible
      if (result && result.successful > 0 && onImportComplete) {
        onImportComplete();
      }

      onClose();
    }
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-blue-gray border-2 border-black p-6 rounded-lg shadow-lg max-w-2xl w-full mx-4">
      <h2 class="text-2xl font-bold text-tan mb-4 border-b-2 border-orange pb-2">
        Import Save Files
      </h2>

      {#if result}
        <!-- Complete state: Show results -->
        <div class="space-y-4">
          <div class="text-tan">
            <div class="text-lg font-semibold mb-3">Import Complete!</div>

            <div class="grid grid-cols-3 gap-4 mb-4">
              <div class="text-center p-3 bg-green-900 border border-black rounded">
                <div class="text-2xl font-bold">{result.successful}</div>
                <div class="text-sm text-gray-300">Imported</div>
              </div>
              <div class="text-center p-3 bg-yellow-900 border border-black rounded">
                <div class="text-2xl font-bold">{result.skipped}</div>
                <div class="text-sm text-gray-300">Skipped</div>
              </div>
              <div class="text-center p-3 bg-red-900 border border-black rounded">
                <div class="text-2xl font-bold">{result.failed}</div>
                <div class="text-sm text-gray-300">Failed</div>
              </div>
            </div>

            <div class="text-sm text-gray-400 mb-4">
              Total time: {formatTime(result.duration_ms)}
            </div>

            {#if result.errors.length > 0}
              <div class="mt-4">
                <div class="font-semibold mb-2">Errors:</div>
                <div class="bg-gray-800 border border-red-700 rounded p-3 max-h-40 overflow-y-auto">
                  {#each result.errors as error}
                    <div class="mb-2 text-sm">
                      <div class="text-red-400 font-semibold">{error.file_name}</div>
                      <div class="text-gray-400 ml-2">{error.error}</div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>

          <button
            class="w-full bg-brown hover:bg-brown-dark text-tan font-semibold py-2 px-4 border-2 border-black rounded transition-colors"
            type="button"
            onclick={handleClose}
          >
            Done
          </button>
        </div>
      {:else if progress}
        <!-- Importing state: Show progress -->
        <div class="space-y-4">
          <div class="text-tan">
            <div class="flex justify-between mb-2">
              <span class="font-semibold">Progress:</span>
              <span>{progress.current} of {progress.total} files</span>
            </div>

            <!-- Progress bar -->
            <div class="w-full mb-4">
              <Progress.Root
                value={progressPercentage}
                max={100}
                class="relative w-full bg-gray-700 border border-black rounded-full h-6 overflow-hidden"
              >
                <div
                  class="absolute inset-0 bg-orange flex items-center justify-center text-sm font-bold text-black transition-all duration-300"
                  style="width: {progressPercentage}%; max-width: 100%;"
                >
                  {progressPercentage}%
                </div>
              </Progress.Root>
            </div>

            <!-- Current file -->
            <div class="mb-3">
              <span class="font-semibold">Current file:</span>
              <div class="text-gray-300 text-sm mt-1 truncate" title={progress.current_file}>
                {progress.current_file}
              </div>
            </div>

            <!-- Current phase -->
            {#if progress.current_phase}
              <div class="mb-3">
                <span class="text-sm text-tan-dark italic">
                  {progress.current_phase}
                </span>
              </div>
            {/if}

            <!-- Stats -->
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span class="text-gray-400">Elapsed:</span>
                <span class="ml-2 text-tan">{formatTime(progress.elapsed_ms)}</span>
              </div>
              <div>
                <span class="text-gray-400">Remaining:</span>
                <span class="ml-2 text-tan">{formatTime(progress.estimated_remaining_ms)}</span>
              </div>
              <div>
                <span class="text-gray-400">Speed:</span>
                <span class="ml-2 text-tan">{formatSpeed(progress.speed)} files/sec</span>
              </div>
            </div>
          </div>
        </div>
      {:else}
        <!-- Importing state: Show generic loading message -->
        <div class="space-y-4">
          <div class="text-tan text-center py-8">
            <div class="text-xl font-semibold mb-4">Importing...</div>
            <div class="text-gray-400">Please wait while files are being imported.</div>
            <div class="text-gray-400 text-sm mt-2">This may take a minute or two.</div>
          </div>
        </div>
      {/if}

      {#if error}
        <div class="mt-4 p-3 bg-red-900 border border-red-700 rounded text-tan">
          <div class="font-semibold">Error:</div>
          <div class="text-sm mt-1">{error}</div>
        </div>
      {/if}
    </div>
  </div>
{/if}
