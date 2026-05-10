<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { cloudApi } from "$lib/api-cloud";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import BulkUploadModal from "$lib/BulkUploadModal.svelte";

	let ready = $state(false);

	onMount(async () => {
		const me = await cloudApi.getMe();
		if (!me) {
			await goto(resolve("/login?next=/upload"), { replaceState: true });
			return;
		}
		ready = true;
	});
</script>

<svelte:head>
	<title>Upload — Per-Ankh</title>
</svelte:head>

<main class="cloud-scroll flex-1 overflow-y-auto px-4 py-8" use:autohideScroll>
	<div class="mx-auto max-w-xl">
		<h1 class="mb-8 text-3xl font-bold text-gray-200">Upload</h1>
		{#if ready}
			<BulkUploadModal />
		{:else}
			<p class="text-sm text-gray-400">Loading…</p>
		{/if}
	</div>
</main>
