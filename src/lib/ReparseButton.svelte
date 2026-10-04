<script lang="ts">
	// Single-game reparse button for the game detail page's stale-parser
	// banner. Two callers, one path: the owner reparses their own game, and a
	// site admin reparses a *public* game they don't own (adminMode → the
	// admin endpoint, so the game stays under its original owner). Both drive
	// BulkReparseModal with a one-game target, which recovers the uploader
	// index from the stored uploader_nation instead of re-asking — the same
	// no-prompt path the account page's per-save Reparse row already uses.
	// Server re-checks site-admin on the admin endpoint, so gating the button
	// on is_admin is chrome, not security.

	import { invalidateAll } from "$app/navigation";
	import BulkReparseModal, {
		type ReparseTarget,
	} from "$lib/BulkReparseModal.svelte";

	let {
		target,
		adminMode = false,
	}: { target: ReparseTarget; adminMode?: boolean } = $props();

	let open = $state(false);

	async function onClose(didReparse: boolean) {
		open = false;
		// Re-run the route load so the banner re-evaluates against the
		// refreshed parser_version. invalidateAll() keeps the URL stable.
		if (didReparse) await invalidateAll();
	}
</script>

<button
	type="button"
	onclick={() => (open = true)}
	class="rounded bg-orange px-3 py-1 text-xs font-bold text-white hover:bg-orange/80"
>
	Reparse
</button>

{#if open}
	<BulkReparseModal games={[target]} {adminMode} {onClose} />
{/if}
