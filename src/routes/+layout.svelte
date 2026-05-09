<script lang="ts">
	import "../app.css";
	import type { Snippet } from "svelte";
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import Header from "$lib/Header.svelte";
	import CloudHeader from "$lib/CloudHeader.svelte";
	import GameSidebar from "$lib/GameSidebar.svelte";
	import UpdateModal from "$lib/UpdateModal.svelte";
	import { checkForUpdates } from "$lib/utils/updater";
	import { pendingUpdate } from "$lib/stores/update";
	import type { LayoutData } from "./$types";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
	let isUpdateModalOpen = $state(false);

	// Cloud rewrite routes render without the Tauri-bound shell (Header,
	// GameSidebar, UpdateModal all assume `window.__TAURI__`). SvelteKit
	// can't break out of the root layout, so we branch here instead.
	// Once Tauri is removed, this gate goes away — root becomes the cloud
	// layout outright.
	//
	// Root `/` is dual-purpose: cloud build serves the marketing landing,
	// Tauri build serves the desktop overview dashboard. Treat `/` as a
	// cloud route only when this is the cloud build.
	const isCloudRoute = $derived(
		(page.url.pathname === "/" && __BUILD_TARGET__ === "cloud") ||
			page.url.pathname === "/login" ||
			page.url.pathname.startsWith("/auth/") ||
			page.url.pathname === "/upload" ||
			page.url.pathname === "/dashboard" ||
			page.url.pathname === "/account" ||
			page.url.pathname.startsWith("/games/"),
	);

	// Cloud header is shown on every cloud route except the auth flow
	// (login + OAuth callback) and the marketing landing — none of those
	// have a user context that would make the nav meaningful.
	const showCloudHeader = $derived(
		isCloudRoute &&
			page.url.pathname !== "/" &&
			page.url.pathname !== "/login" &&
			!page.url.pathname.startsWith("/auth/"),
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
	{#if showCloudHeader}
		<!--
			Cloud chrome: fixed-viewport flex column. CloudHeader sits at top;
			children take remaining space via flex-1. Pages either fill the
			slot (flex-1 flex-col overflow-hidden, with their own internal
			scroll) or scroll the slot directly (flex-1 overflow-y-auto).
		-->
		<div class="flex h-screen flex-col overflow-hidden bg-blue-gray">
			<CloudHeader user={data.user} />
			{@render children()}
		</div>
	{:else}
		{@render children()}
	{/if}
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
