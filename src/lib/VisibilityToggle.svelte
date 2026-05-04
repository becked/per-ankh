<script lang="ts">
	import { cloudApi } from "$lib/api-cloud";

	interface Props {
		gameId: string;
		isPublic: boolean;
	}

	let { gameId, isPublic = $bindable() }: Props = $props();

	let saving = $state(false);
	let error = $state<string | null>(null);
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	const publicUrl = $derived(
		typeof window === "undefined"
			? ""
			: `${window.location.origin}/games/${gameId}`,
	);

	async function toggle() {
		const next = !isPublic;
		// Confirm only when going private → public. Going back to private is
		// a safe revocation, no confirmation needed.
		if (next) {
			const ok = window.confirm(
				"Make this game public?\n\nAnyone with the link will be able to view it. Steam/GOG/Epic IDs are stripped from public views; player names are preserved.",
			);
			if (!ok) return;
		}

		// Optimistic flip — revert on error.
		const prev = isPublic;
		isPublic = next;
		saving = true;
		error = null;
		try {
			await cloudApi.toggleVisibility(gameId, next);
		} catch (err) {
			isPublic = prev;
			error = err instanceof Error ? err.message : "Toggle failed";
		} finally {
			saving = false;
		}
	}

	async function copyLink() {
		if (!publicUrl) return;
		try {
			await navigator.clipboard.writeText(publicUrl);
			copied = true;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => (copied = false), 1500);
		} catch {
			// Fall back to legacy execCommand if clipboard API is unavailable.
			error = "Could not copy. Select and copy manually.";
		}
	}
</script>

<div class="flex items-center gap-3">
	<button
		type="button"
		role="switch"
		aria-checked={isPublic}
		disabled={saving}
		onclick={toggle}
		class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50"
		class:bg-orange={isPublic}
		class:bg-brown={!isPublic}
		title={isPublic ? "Public — click to make private" : "Private — click to make public"}
	>
		<span
			class="inline-block h-4 w-4 transform rounded-full bg-tan transition-transform"
			class:translate-x-4={isPublic}
			class:translate-x-1={!isPublic}
		></span>
	</button>
	<span class="text-xs text-tan">
		{isPublic ? "Public" : "Private"}
	</span>

	{#if isPublic}
		<button
			type="button"
			onclick={copyLink}
			class="rounded bg-brown px-2 py-1 text-xs text-tan hover:bg-orange"
		>
			{copied ? "Copied!" : "Copy link"}
		</button>
	{/if}

	{#if error}
		<span class="text-xs text-red-400">{error}</span>
	{/if}
</div>
