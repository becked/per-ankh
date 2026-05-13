<script lang="ts">
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

	function startEdit() {
		value = username ?? "";
		editing = true;
	}

	function save() {
		if (!value.trim() || value.trim() === username) {
			editing = false;
			return;
		}
		onSubstitute(value.trim());
		editing = false;
	}
</script>

{#if editing}
	<span class="inline-flex items-center gap-1">
		<input
			type="text"
			bind:value
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
			onclick={() => (editing = false)}
			{disabled}
			aria-label="Cancel"
		>
			×
		</button>
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
