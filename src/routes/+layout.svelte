<script lang="ts">
	import "../app.css";
	import type { Snippet } from "svelte";
	import { onMount } from "svelte";
	import Header from "$lib/Header.svelte";
	import GameSidebar from "$lib/GameSidebar.svelte";
	import UpdateModal from "$lib/UpdateModal.svelte";
	import { checkForUpdates } from "$lib/utils/updater";
	import { pendingUpdate } from "$lib/stores/update";

	let { children }: { children: Snippet } = $props();
	let isUpdateModalOpen = $state(false);

	onMount(async () => {
		try {
			const result = await checkForUpdates();
			if (result.available && result.update) {
				pendingUpdate.set(result.update);
				isUpdateModalOpen = true;
			}
		} catch (err) {
			console.warn("Startup update check failed:", err);
		}
	});
</script>

<div
	class="flex h-screen flex-col overflow-hidden border-8 border-border-gray bg-blue-gray"
>
	<Header
		onOpenUpdateModal={() => {
			isUpdateModalOpen = true;
		}}
	/>

	<div class="flex flex-1 overflow-hidden">
		<div class="flex min-w-0 flex-1 flex-col">
			{@render children()}
		</div>
		<GameSidebar />
	</div>
</div>

<UpdateModal
	bind:isOpen={isUpdateModalOpen}
	onClose={() => {
		isUpdateModalOpen = false;
	}}
/>
