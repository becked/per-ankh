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

<div class="flex h-full flex-col bg-blue-gray p-8">
	<h1 class="mb-4 text-3xl font-bold text-tan">Event Test Page</h1>

	<p class="mb-6 text-gray-200">
		This page tests Tauri event emission from backend to frontend. Click the
		button to trigger a 60-second test that emits events every 5 seconds.
	</p>

	<button
		class="mb-6 w-48 rounded bg-orange px-4 py-2 font-bold text-black hover:bg-tan disabled:cursor-not-allowed disabled:opacity-50"
		onclick={startTest}
		disabled={isRunning}
	>
		{isRunning ? "Test Running..." : "Start Test"}
	</button>

	<div
		class="flex-1 overflow-y-auto rounded border-2 border-gray-400 bg-black p-4 font-mono text-sm"
	>
		{#each logs as log}
			<div class="text-green-400">{log}</div>
		{/each}
	</div>
</div>
