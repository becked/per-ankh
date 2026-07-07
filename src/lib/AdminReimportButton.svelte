<script lang="ts">
	// Admin single-game reparse, shown on the game detail page when a site
	// admin views a *public* game they don't own whose stored parser_version
	// is behind the current build. The owner-path sibling is ReimportButton;
	// this one reuses BulkReparseModal's admin path with a one-game target, so
	// the reparse recovers the uploader index from the stored user_nation and
	// posts through the admin endpoint — the game stays under its original
	// owner with the same nation, no re-prompt. Server re-checks site-admin on
	// the endpoint, so gating the button on is_admin is chrome, not security.

	import { invalidateAll } from "$app/navigation";
	import BulkReparseModal, {
		type ReparseTarget,
	} from "$lib/BulkReparseModal.svelte";

	let { target }: { target: ReparseTarget } = $props();

	let open = $state(false);

	async function onClose(didReparse: boolean) {
		open = false;
		// Re-run the route load so the banner re-evaluates against the
		// refreshed parser_version — same as the owner path's invalidateAll.
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
	<BulkReparseModal games={[target]} adminMode={true} {onClose} />
{/if}
