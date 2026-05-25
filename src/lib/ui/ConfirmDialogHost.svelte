<script lang="ts">
	// Singleton confirm-dialog renderer. Mounted once in the root layout. Reads
	// the active request from the confirm store, drives a bits-ui AlertDialog,
	// and resolves the promise on confirm / cancel / dismiss. Modal chrome
	// mirrors AboutModal (blue-gray surface, orange heading divider).
	import { AlertDialog } from "bits-ui";
	import { confirmRequest } from "$lib/ui/confirm";

	const open = $derived($confirmRequest !== null);

	function settle(ok: boolean): void {
		const req = $confirmRequest;
		if (!req) return; // already settled (guards Action/Cancel double-fire)
		confirmRequest.set(null);
		req.resolve(ok);
	}
</script>

<AlertDialog.Root
	{open}
	onOpenChange={(o) => {
		if (!o) settle(false);
	}}
>
	<AlertDialog.Portal>
		<AlertDialog.Overlay class="bg-black/50 fixed inset-0 z-[90]" />
		<AlertDialog.Content
			class="fixed left-1/2 top-1/2 z-[91] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-black bg-blue-gray p-5 shadow-lg"
		>
			{#if $confirmRequest}
				<AlertDialog.Title
					class="mb-3 border-b-2 border-orange pb-2 text-lg font-bold text-tan"
				>
					{$confirmRequest.title}
				</AlertDialog.Title>
				<AlertDialog.Description class="mb-5 text-sm text-tan opacity-90">
					{$confirmRequest.message}
				</AlertDialog.Description>
				<div class="flex justify-end gap-2">
					<AlertDialog.Cancel
						onclick={() => settle(false)}
						class="rounded border border-tan px-3 py-1.5 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
					>
						{$confirmRequest.cancelLabel ?? "Cancel"}
					</AlertDialog.Cancel>
					<AlertDialog.Action
						onclick={() => settle(true)}
						class={$confirmRequest.destructive
							? "bg-brown/20 rounded border border-brown px-3 py-1.5 text-xs font-bold text-tan transition-colors hover:bg-brown"
							: "bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs font-bold text-tan transition-colors"}
					>
						{$confirmRequest.confirmLabel ?? "Confirm"}
					</AlertDialog.Action>
				</div>
			{/if}
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>
