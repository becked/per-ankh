<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { cloudApi } from "$lib/api-cloud";
	import UploadModal from "$lib/UploadModal.svelte";

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

<main class="flex-1 overflow-y-auto px-4 py-8">
	<div class="mx-auto max-w-xl">
		<h1 class="mb-4 font-serif text-2xl text-tan">Upload a save</h1>
		{#if ready}
			<UploadModal />
		{:else}
			<p class="text-sm text-brown">Loading…</p>
		{/if}
	</div>
</main>
