<script lang="ts">
  import { api } from "$lib/api";
  import type { KnownOnlineId } from "$lib/types/KnownOnlineId";

  interface Props {
    isOpen: boolean;
    onClose: () => void;
  }

  let { isOpen = $bindable(), onClose }: Props = $props();

  let knownIds = $state<KnownOnlineId[]>([]);
  let currentOnlineId = $state<string | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);

  async function loadData() {
    loading = true;
    error = null;
    try {
      const [ids, primaryId] = await Promise.all([
        api.getKnownOnlineIds(),
        api.getPrimaryUserOnlineId(),
      ]);
      knownIds = ids;
      currentOnlineId = primaryId;
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  }

  async function handleSelectUser(onlineId: string) {
    if (onlineId === currentOnlineId) return;

    saving = true;
    error = null;
    try {
      await api.setPrimaryUserOnlineId(onlineId);
      currentOnlineId = onlineId;
    } catch (err) {
      error = String(err);
    } finally {
      saving = false;
    }
  }

  function handleClose() {
    onClose();
  }

  // Reload data when modal opens
  $effect(() => {
    if (isOpen) {
      loadData();
    }
  });
</script>

{#if isOpen}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-blue-gray border-2 border-black p-6 rounded-lg shadow-lg max-w-lg w-full mx-4">
      <h2 class="text-2xl font-bold text-tan mb-4 border-b-2 border-orange pb-2">
        Primary User
      </h2>

      <div class="mb-6">
        <h3 class="text-lg font-semibold text-tan mb-2">View/Update Online ID</h3>
        <p class="text-sm text-gray-400 mb-4">
          Select your identity to track wins/losses in multiplayer games.
        </p>

        {#if loading}
          <div class="text-tan py-4 text-center">Loading...</div>
        {:else if knownIds.length === 0}
          <div class="text-gray-400 py-4 text-center">
            No OnlineIDs found. Import save files to see available identities.
          </div>
        {:else}
          <div class="max-h-64 overflow-y-auto border border-black rounded">
            {#each knownIds as id}
              <button
                type="button"
                class="w-full text-left px-4 py-3 transition-colors border-b border-gray-700 last:border-b-0
                  {id.online_id === currentOnlineId
                    ? 'bg-brown text-tan'
                    : 'text-tan hover:bg-gray-700'}"
                disabled={saving}
                onclick={() => handleSelectUser(id.online_id)}
              >
                <div class="flex justify-between items-center gap-2">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-semibold">{id.player_names.join(", ") || "(no name)"}</span>
                    <span class="text-xs text-gray-400 font-mono">{id.online_id}</span>
                    <span class="text-xs text-gray-400">({id.save_count} saves)</span>
                  </div>
                  {#if id.online_id === currentOnlineId}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-5 w-5 text-orange flex-shrink-0"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      {#if error}
        <div class="mb-4 p-3 bg-red-900 border border-red-700 rounded text-tan">
          <div class="font-semibold">Error:</div>
          <div class="text-sm mt-1">{error}</div>
        </div>
      {/if}

      <button
        class="w-full bg-brown hover:bg-brown-dark text-tan font-semibold py-2 px-4 border-2 border-black rounded transition-colors"
        type="button"
        onclick={handleClose}
      >
        Close
      </button>
    </div>
  </div>
{/if}
