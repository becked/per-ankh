<script lang="ts">
	import type { UserSearchResult } from "$lib/api-cloud";
	import UserAutocomplete from "./UserAutocomplete.svelte";

	interface Props {
		slotId: string;
		// Displayed label for the occupant (the account display name when claimed,
		// else the typed name). Shown verbatim when not editing — NOT used to seed
		// the editor.
		username: string | null;
		// The slot's raw stored Discord handle (admin-only). Seeds the edit input
		// and is what "unchanged" is compared against, so editing the answer never
		// rewrites the handle. Falls back to `username` when absent (unclaimed
		// slots, where the handle equals the typed name anyway).
		handle?: string | null;
		disabled: boolean;
		// The player's answer to the tournament's optional signup question.
		// Only displayed/edited when `editAnswer` is set (the setup-phase slots
		// panel); the live Swiss standings reuses this cell for username-only
		// edits and leaves both off.
		answer?: string | null;
		editAnswer?: boolean;
		// Picks up the substitute username and, when the admin chose a real
		// user from the autocomplete, that user's id so the worker can pre-link
		// the slot. userId is null for a free-text substitution. newUsername is
		// undefined when the handle was left unchanged (answer-only edits), so the
		// worker leaves the occupant columns untouched. answer is the edited
		// signup answer (null clears it) when editAnswer is on, and undefined
		// otherwise so the worker leaves the column untouched.
		onSubstitute: (
			// eslint-disable-next-line no-unused-vars -- documentary
			newUsername: string | undefined,
			// eslint-disable-next-line no-unused-vars -- documentary
			userId: string | null,
			// eslint-disable-next-line no-unused-vars -- documentary
			answer?: string | null,
		) => void;
	}

	let {
		slotId,
		username,
		handle = null,
		disabled,
		answer = null,
		editAnswer = false,
		onSubstitute,
	}: Props = $props();

	let editing = $state(false);
	let value = $state("");
	let answerValue = $state("");
	// Set when the admin picks a user from the autocomplete; cleared when they
	// edit the value away from the picked handle (the autocomplete fires
	// onSelectUser(null) in that case).
	let pickedUserId = $state<string | null>(null);
	let error = $state<string | null>(null);

	// The editor operates on the real handle, not the display label, so the
	// "unchanged" comparison and any genuine edit are about the occupant identity.
	const baseHandle = $derived((handle ?? username) ?? "");

	function startEdit() {
		value = baseHandle;
		answerValue = answer ?? "";
		pickedUserId = null;
		error = null;
		editing = true;
	}

	function save() {
		const trimmed = value.trim();
		if (!trimmed) {
			error = "Username cannot be empty";
			return;
		}
		// undefined when not editing answers, so the worker leaves the column
		// alone; otherwise the trimmed answer (empty → null clears it).
		const nextAnswer = editAnswer ? answerValue.trim() || null : undefined;
		const usernameUnchanged = trimmed === baseHandle && pickedUserId === null;
		const answerUnchanged = !editAnswer || nextAnswer === (answer ?? null);
		// No-op when nothing changed and the admin didn't pick a user to link.
		if (usernameUnchanged && answerUnchanged) {
			editing = false;
			error = null;
			return;
		}
		// Send the handle only when it actually changed (or a user was picked) —
		// an answer-only edit passes undefined so the occupant link is untouched.
		const usernameArg = usernameUnchanged ? undefined : trimmed;
		onSubstitute(usernameArg, pickedUserId, nextAnswer);
		editing = false;
		error = null;
	}

	function cancel() {
		editing = false;
		error = null;
	}

	function onSelectUser(user: UserSearchResult | null) {
		pickedUserId = user?.user_id ?? null;
	}
</script>

{#if editing}
	<span class="inline-flex flex-col gap-1" class:w-56={editAnswer}>
		<span class="inline-flex items-center gap-1">
			<UserAutocomplete
				{value}
				onValueChange={(next) => {
					value = next;
					error = null;
				}}
				{onSelectUser}
				onEnter={save}
				{disabled}
				autofocusOnMount
				inputClass="bg-surface focus:outline-none"
			/>
			<button
				type="button"
				class="text-xs text-tan opacity-70 hover:text-orange hover:opacity-100"
				onclick={save}
				{disabled}
				aria-label="Save"
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
		{#if editAnswer}
			<textarea
				bind:value={answerValue}
				rows="2"
				maxlength="2000"
				{disabled}
				class="w-full rounded bg-surface p-1.5 text-[11px] text-tan focus:outline-none disabled:opacity-50"
			></textarea>
		{/if}
		{#if error}
			<span class="text-[10px] text-red-400">{error}</span>
		{/if}
	</span>
{:else}
	<span class="inline-flex flex-col gap-0.5">
		<span class="inline-flex items-center gap-1">
			<span class:opacity-60={!username}>
				{username ?? `slot ${slotId.slice(0, 6)}`}
			</span>
			<button
				type="button"
				class="text-tan opacity-40 transition-colors hover:text-orange hover:opacity-100"
				onclick={startEdit}
				{disabled}
				aria-label="Edit / substitute"
				title="Edit / substitute"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-3 w-3"
					viewBox="0 0 20 20"
					fill="currentColor"
					aria-hidden="true"
				>
					<path
						d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.886L17.5 5.501a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z"
					/>
				</svg>
			</button>
		</span>
		{#if editAnswer && answer}
			<span class="whitespace-pre-wrap text-[11px] text-tan opacity-60">
				{answer}
			</span>
		{/if}
	</span>
{/if}
