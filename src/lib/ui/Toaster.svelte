<script lang="ts">
	// Renders the active toast stack. Mounted once in the root layout; reads
	// the shared store. Fixed bottom-right, above app chrome. Error toasts use
	// a red/brown left accent (red is allowed here — a toast is a critical /
	// error state, not a non-destructive affordance); info uses orange.
	import { fly } from "svelte/transition";
	import { toasts, toast } from "$lib/ui/toast";
</script>

<div
	class="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
>
	{#each $toasts as t (t.id)}
		<div
			role="status"
			transition:fly={{ y: 12, duration: 150 }}
			class="pointer-events-auto flex items-start gap-2 rounded-lg border-2 border-l-4 border-black bg-blue-gray px-3 py-2 text-sm shadow-lg {t.kind ===
			'error'
				? 'border-l-brown text-red-400'
				: 'border-l-orange text-tan'}"
		>
			<span class="min-w-0 flex-1 break-words">{t.message}</span>
			<button
				type="button"
				class="shrink-0 leading-none text-tan opacity-60 hover:opacity-100"
				aria-label="Dismiss"
				onclick={() => toast.dismiss(t.id)}
			>
				×
			</button>
		</div>
	{/each}
</div>
