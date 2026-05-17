<script lang="ts">
	import { autofocus } from "$lib/actions/autofocus";

	interface Props {
		slotId: string;
		username: string | null;
		disabled: boolean;
		// eslint-disable-next-line no-unused-vars -- type-signature param name is documentary
		onSubstitute: (newUsername: string) => void;
	}

	let { slotId, username, disabled, onSubstitute }: Props = $props();

	let editing = $state(false);
	let value = $state("");
	let error = $state<string | null>(null);

	function startEdit() {
		value = username ?? "";
		error = null;
		editing = true;
	}

	function save() {
		const trimmed = value.trim();
		if (!trimmed) {
			error = "Username cannot be empty";
			return;
		}
		if (trimmed === username) {
			editing = false;
			error = null;
			return;
		}
		onSubstitute(trimmed);
		editing = false;
		error = null;
	}

	function cancel() {
		editing = false;
		error = null;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			save();
		} else if (e.key === "Escape") {
			e.preventDefault();
			cancel();
		}
	}
</script>

{#if editing}
	<span class="inline-flex flex-col gap-0.5">
		<span class="inline-flex items-center gap-1">
			<input
				type="text"
				bind:value
				oninput={() => (error = null)}
				onkeydown={onKey}
				use:autofocus
				class="rounded border border-black bg-[#35302b] p-1 text-xs text-tan"
				{disabled}
			/>
			<button
				type="button"
				class="text-xs text-tan opacity-70 hover:text-orange hover:opacity-100"
				onclick={save}
				{disabled}
				aria-label="Save substitution"
			>
				✓
			</button>
			<button
				type="button"
				class="text-xs text-tan opacity-50 hover:opacity-100"
				onclick={cancel}
				{disabled}
				aria-label="Cancel"
			>
				×
			</button>
		</span>
		{#if error}
			<span class="text-[10px] text-red-400">{error}</span>
		{/if}
	</span>
{:else}
	<span class="inline-flex items-baseline gap-1">
		<span class:opacity-60={!username}>
			{username ?? `slot ${slotId.slice(0, 6)}`}
		</span>
		<button
			type="button"
			class="text-[10px] text-tan opacity-40 hover:text-orange hover:opacity-100"
			onclick={startEdit}
			{disabled}
			title="Edit / substitute"
		>
			edit
		</button>
	</span>
{/if}
