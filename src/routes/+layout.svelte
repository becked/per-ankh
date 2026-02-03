<script lang="ts">
	import "../app.css";
	import { onMount } from "svelte";
	import Header from "$lib/Header.svelte";
	import GameSidebar from "$lib/GameSidebar.svelte";
	import UpdateNotification from "$lib/UpdateNotification.svelte";
	import { checkForUpdates } from "$lib/utils/updater";
	import type { Update } from "@tauri-apps/plugin-updater";

	let pendingUpdate = $state<Update | null>(null);

	onMount(async () => {
		try {
			const result = await checkForUpdates();
			if (result.available && result.update) {
				pendingUpdate = result.update;
			}
		} catch (err) {
			// Silent failure on startup - user can manually check via menu
			console.warn("Startup update check failed:", err);
		}
	});

	function dismissUpdate() {
		pendingUpdate = null;
	}
</script>

<div
	class="flex h-screen flex-col overflow-hidden border-8 border-border-gray bg-blue-gray"
>
	<Header />

	{#if pendingUpdate}
		<UpdateNotification update={pendingUpdate} onDismiss={dismissUpdate} />
	{/if}

	<div class="flex flex-1 overflow-hidden">
		<div class="flex min-w-0 flex-1 flex-col">
			<slot />
		</div>
		<GameSidebar />
	</div>
</div>
