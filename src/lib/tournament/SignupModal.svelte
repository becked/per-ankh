<script lang="ts">
	// Self-service tournament signup. Built for non-technical participants:
	// one decision (division), live counts so they can see the field, and a
	// reassurance line showing the exact Discord handle they'll appear under
	// in the slot list. Mirrors TournamentCreateModal's scaffolding (modal
	// chrome, busy/disabled states, toast-on-error).

	import { invalidateAll } from "$app/navigation";
	import {
		ApiError,
		cloudApi,
		type Division,
		type TournamentDetail,
		type UserMe,
	} from "$lib/api-cloud";
	import RadioGroup from "$lib/ui/RadioGroup.svelte";
	import RadioItem from "$lib/ui/RadioItem.svelte";
	import { toast } from "$lib/ui/toast";

	interface Props {
		tournament: TournamentDetail;
		user: UserMe;
		onClose: () => void;
		// Fired after a successful signup so the parent can reload the page
		// (data.tournament.viewer_slot updates from null → slot info).
		onSignedUp?: () => void;
	}

	let { tournament, user, onClose, onSignedUp }: Props = $props();

	let selectedDivision = $state<Division | null>(null);
	let busy = $state(false);

	const counts = $derived(tournament.slot_counts.swiss_by_division);

	function divisionLabel(d: Division): string {
		const name =
			d === "A" ? tournament.division_a_name : tournament.division_b_name;
		const n = counts[d];
		const playersLabel = n === 1 ? "1 player" : `${n} players`;
		return `${name} (${playersLabel})`;
	}

	const canSubmit = $derived(!busy && selectedDivision !== null);

	async function submit() {
		if (!canSubmit || selectedDivision === null) return;
		busy = true;
		try {
			await cloudApi.signupForTournament(
				tournament.tournament_id,
				selectedDivision,
			);
			// Refresh layout-level myTournaments (drives the header dropdown)
			// and the page-level tournament detail (viewer_slot, slot list).
			await invalidateAll();
			onSignedUp?.();
			onClose();
		} catch (err) {
			let message = "Sign up failed";
			if (err instanceof ApiError) {
				// Friendly copy for the two expected 409s. Anything else falls
				// through with the server's message.
				if (err.code === "SIGNUPS_CLOSED") {
					message = "Signups just closed — the tournament started.";
				} else if (err.code === "ALREADY_SIGNED_UP") {
					message = "You're already signed up for this tournament.";
				} else {
					message = err.message + (err.code ? ` (${err.code})` : "");
				}
			}
			toast.error(message);
			busy = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape" && !busy) {
			e.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
	onclick={onClose}
	role="presentation"
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border-2 border-black bg-blue-gray p-5 shadow-lg"
		onclick={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="signup-modal-title"
		tabindex="-1"
	>
		<header class="mb-4 flex items-baseline justify-between gap-3">
			<h2
				id="signup-modal-title"
				class="border-b-2 border-orange pb-1 text-lg font-bold text-tan"
			>
				Sign up for {tournament.name}
			</h2>
			<button
				type="button"
				class="text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
				onclick={onClose}
				aria-label="Close"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M6 18L18 6M6 6l12 12"
					/>
				</svg>
			</button>
		</header>

		<p class="mb-4 text-xs text-tan opacity-80">
			Pick the division you want to play in. You can withdraw before the
			tournament starts.
		</p>

		<RadioGroup
			value={selectedDivision ?? ""}
			onChange={(v) => (selectedDivision = v as Division)}
			disabled={busy}
			ariaLabel="Division"
			class="mb-4 flex flex-col gap-2 text-xs text-tan"
		>
			<label
				class="flex cursor-pointer items-center gap-2 rounded border border-black bg-[#35302b] p-2 transition-colors hover:border-orange"
				class:border-orange={selectedDivision === "A"}
			>
				<RadioItem value="A" disabled={busy} />
				<span>{divisionLabel("A")}</span>
			</label>
			<label
				class="flex cursor-pointer items-center gap-2 rounded border border-black bg-[#35302b] p-2 transition-colors hover:border-orange"
				class:border-orange={selectedDivision === "B"}
			>
				<RadioItem value="B" disabled={busy} />
				<span>{divisionLabel("B")}</span>
			</label>
		</RadioGroup>

		<p class="mb-4 text-[11px] text-tan opacity-60">
			Signed in as <span class="font-mono text-tan opacity-90"
				>@{user.discord_username}</span
			>
			— we'll use this Discord handle to identify you in pairings.
		</p>

		<div class="flex justify-end gap-2">
			<button
				type="button"
				class="rounded border border-tan px-3 py-1.5 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
				onclick={onClose}
				disabled={busy}
			>
				Cancel
			</button>
			<button
				type="button"
				class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan disabled:opacity-50"
				onclick={submit}
				disabled={!canSubmit}
			>
				{busy ? "Signing up…" : "Sign me up"}
			</button>
		</div>
	</div>
</div>
