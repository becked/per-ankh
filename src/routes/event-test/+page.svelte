<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { api } from "$lib/api";

  let logs: string[] = $state([]);
  let isRunning = $state(false);
  let unlisten: UnlistenFn | null = null;

  function addLog(message: string) {
    const timestamp = new Date().toLocaleTimeString();
    logs = [...logs, `[${timestamp}] ${message}`];
  }

  async function startTest() {
    isRunning = true;
    logs = [];
    addLog("Starting event test...");

    try {
      await api.runEventTest();
      addLog("Backend command completed");
    } catch (err) {
      addLog(`Error: ${err}`);
    } finally {
      isRunning = false;
    }
  }

  onMount(async () => {
    addLog("Mounted. Setting up event listener...");

    unlisten = await listen("test-event", (event) => {
      addLog(`Event received! Payload: ${JSON.stringify(event.payload)}`);
    });

    addLog("Event listener ready");
  });

  onDestroy(() => {
    if (unlisten) {
      unlisten();
    }
  });
</script>

<div class="flex flex-col h-full bg-blue-gray p-8">
  <h1 class="text-3xl font-bold text-tan mb-4">Event Test Page</h1>

  <p class="text-gray-200 mb-6">
    This page tests Tauri event emission from backend to frontend.
    Click the button to trigger a 60-second test that emits events every 5 seconds.
  </p>

  <button
    class="bg-orange hover:bg-tan text-black font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed mb-6 w-48"
    onclick={startTest}
    disabled={isRunning}
  >
    {isRunning ? "Test Running..." : "Start Test"}
  </button>

  <div class="flex-1 bg-black border-2 border-gray-400 rounded p-4 overflow-y-auto font-mono text-sm">
    {#each logs as log}
      <div class="text-green-400">{log}</div>
    {/each}
  </div>
</div>
