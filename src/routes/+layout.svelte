<script lang="ts">
	import "../app.css";
	import type { Snippet } from "svelte";
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import Header from "$lib/Header.svelte";
	import GameSidebar from "$lib/GameSidebar.svelte";
	import UpdateModal from "$lib/UpdateModal.svelte";
	import { checkForUpdates } from "$lib/utils/updater";
	import { pendingUpdate } from "$lib/stores/update";

	let { children }: { children: Snippet } = $props();
	let isUpdateModalOpen = $state(false);

	// Cloud rewrite routes render without the Tauri-bound shell (Header,
	// GameSidebar, UpdateModal all assume `window.__TAURI__`). SvelteKit
	// can't break out of the root layout, so we branch here instead.
	// Once Tauri is removed, this gate goes away — root becomes the cloud
	// layout outright.
	const isCloudRoute = $derived(
		page.url.pathname === "/login" ||
			page.url.pathname.startsWith("/auth/") ||
			page.url.pathname === "/upload" ||
			page.url.pathname === "/games" ||
			page.url.pathname.startsWith("/games/"),
	);

	onMount(async () => {
		if (isCloudRoute) return;
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

{#if isCloudRoute}
	{@render children()}
{:else}
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
{/if}
