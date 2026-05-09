<script lang="ts">
	import "../app.css";
	import type { Snippet } from "svelte";
	import { page } from "$app/state";
	import CloudHeader from "$lib/CloudHeader.svelte";
	import type { LayoutData } from "./$types";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// Cloud header is shown on every route except the auth flow (login +
	// OAuth callback) and the marketing landing — none of those have a
	// user context that would make the nav meaningful.
	const showCloudHeader = $derived(
		page.url.pathname !== "/" &&
			page.url.pathname !== "/login" &&
			!page.url.pathname.startsWith("/auth/"),
	);
</script>

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
