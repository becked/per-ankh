<script lang="ts">
	// Inline autocomplete for the admin's "Add slot" form.
	//
	// Scratch-built rather than wired through bits-ui's Combobox primitive:
	// the project hasn't used Combobox yet, the existing slot form is a
	// plain <input>, and the keyboard nav needed here is ~30 lines. The
	// component matches the bare-input UX (Enter to submit, autofocus
	// behavior, the existing dark Tailwind classes) so dropping it into
	// the form is invisible until the admin starts typing.
	//
	// Behavior:
	//   * Below 2 chars: no fetch, no dropdown.
	//   * 2+ chars, debounced 200ms: fetch matches, show dropdown.
	//   * ↑/↓ navigates, Enter on a row picks it, Esc closes, Tab/blur closes.
	//   * Click selects.
	//   * Selecting a row fires onSelectUser(row) and sets value to its
	//     discord_username. Subsequently typing diverges → onSelectUser(null)
	//     so the parent forgets the linked user_id.
	//   * Enter with no row highlighted calls onEnter (free-text path).

	import { ApiError, cloudApi, type UserSearchResult } from "$lib/api-cloud";

	interface Props {
		value: string;
		// eslint-disable-next-line no-unused-vars -- param name is documentary
		onValueChange: (next: string) => void;
		// eslint-disable-next-line no-unused-vars -- param name is documentary
		onSelectUser: (user: UserSearchResult | null) => void;
		disabled?: boolean;
		// Optional submit affordance — wired to the same handler the "Add
		// slot" button uses, so Enter in free-text mode keeps working.
		onEnter?: () => void;
		// Forwarded to the rendered <input>. Lets the parent feed in the
		// autofocus-blocking attrs (data-1p-ignore, etc.) the existing
		// input had.
		inputAttrs?: Record<string, string>;
		placeholder?: string;
	}

	let {
		value,
		onValueChange,
		onSelectUser,
		disabled = false,
		onEnter,
		inputAttrs = {},
		placeholder,
	}: Props = $props();

	let suggestions = $state<UserSearchResult[]>([]);
	let highlight = $state(-1);
	let open = $state(false);
	// True when the input's current value came from picking a row. Lets us
	// suppress the next fetch (it would just return the picked user) and
	// reset cleanly when the admin starts editing.
	let pickedUsername = $state<string | null>(null);
	let fetchTimer: ReturnType<typeof setTimeout> | null = null;
	// Monotonic counter so an in-flight stale fetch can't clobber fresher
	// results.
	let requestSeq = 0;

	function clearTimer() {
		if (fetchTimer !== null) {
			clearTimeout(fetchTimer);
			fetchTimer = null;
		}
	}

	function close() {
		open = false;
		highlight = -1;
	}

	async function runSearch(q: string) {
		const mySeq = ++requestSeq;
		try {
			const res = await cloudApi.searchUsers(q, { limit: 8 });
			if (mySeq !== requestSeq) return; // stale; newer search already in flight
			suggestions = res.users;
			open = suggestions.length > 0;
			highlight = open ? 0 : -1;
		} catch (err) {
			if (mySeq !== requestSeq) return;
			suggestions = [];
			open = false;
			// 429 is the only expected throw; silently fall back to free-text.
			// Anything else also degrades to free-text so a flaky search
			// endpoint doesn't block slot creation. Logged for visibility.
			if (!(err instanceof ApiError)) {
				console.warn("[SlotUsernameAutocomplete] search failed", err);
			}
		}
	}

	function scheduleSearch(q: string) {
		clearTimer();
		const trimmed = q.trim();
		if (trimmed.length < 2) {
			suggestions = [];
			close();
			return;
		}
		fetchTimer = setTimeout(() => runSearch(trimmed), 200);
	}

	function handleInput(e: Event) {
		const next = (e.target as HTMLInputElement).value;
		onValueChange(next);
		// If the admin edits a previously-picked value, forget the link.
		if (pickedUsername !== null && next !== pickedUsername) {
			pickedUsername = null;
			onSelectUser(null);
		}
		scheduleSearch(next);
	}

	function pick(user: UserSearchResult) {
		pickedUsername = user.discord_username;
		onValueChange(user.discord_username);
		onSelectUser(user);
		close();
		clearTimer();
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === "Escape" && open) {
			e.preventDefault();
			close();
			return;
		}
		if (e.key === "ArrowDown" && open) {
			e.preventDefault();
			highlight = Math.min(highlight + 1, suggestions.length - 1);
			return;
		}
		if (e.key === "ArrowUp" && open) {
			e.preventDefault();
			highlight = Math.max(highlight - 1, 0);
			return;
		}
		if (e.key === "Enter") {
			if (open && highlight >= 0 && suggestions[highlight]) {
				e.preventDefault();
				pick(suggestions[highlight]);
				return;
			}
			// No suggestion selected → free-text submit.
			if (onEnter) {
				e.preventDefault();
				onEnter();
			}
		}
	}

	function handleBlur() {
		// Delay close so a click on a suggestion still registers.
		setTimeout(() => close(), 150);
	}
</script>

<div class="relative">
	<input
		type="text"
		{value}
		{disabled}
		{placeholder}
		oninput={handleInput}
		onkeydown={handleKey}
		onblur={handleBlur}
		onfocus={() => {
			if (suggestions.length > 0) open = true;
		}}
		class="block w-full rounded border border-black bg-[#35302b] p-1.5 text-xs text-tan"
		{...inputAttrs}
		autocomplete="off"
	/>

	{#if open && suggestions.length > 0}
		<ul
			class="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded border border-black shadow-lg"
			style="background-color: #2a2622;"
			role="listbox"
		>
			{#each suggestions as user, i (user.user_id)}
				<li
					class="flex cursor-pointer items-baseline justify-between gap-3 px-2 py-1.5 text-xs text-tan"
					class:text-orange={i === highlight}
					style:background-color={i === highlight ? "#35302b" : "transparent"}
					role="option"
					aria-selected={i === highlight}
					onmousedown={(e) => {
						// mousedown (not click) so it fires before the input's
						// blur handler closes the list.
						e.preventDefault();
						pick(user);
					}}
					onmouseenter={() => (highlight = i)}
				>
					<span class="font-mono">@{user.discord_username}</span>
					{#if user.display_name && user.display_name !== user.discord_username}
						<span class="truncate opacity-60">{user.display_name}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
