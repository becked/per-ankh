<script lang="ts">
	// Self-service tournament signup. Built for non-technical participants:
	// one decision (division), live counts so they can see the field, and a
	// reassurance line showing the exact Discord handle they'll appear under
	// in the slot list.

	import {
		cloudApi,
		type Division,
		type TournamentDetail,
		type UserMe,
	} from "$lib/api-cloud";
	import Popover from "$lib/ui/Popover.svelte";
	import RadioGroup from "$lib/ui/RadioGroup.svelte";
	import RadioItem from "$lib/ui/RadioItem.svelte";
	import { runAction } from "$lib/tournament/async-action";
	import FormFooter from "$lib/tournament/FormFooter.svelte";

	interface Props {
		tournament: TournamentDetail;
		user: UserMe;
		// Disables the trigger while a page-level admin action is in flight.
		busy?: boolean;
	}

	let { tournament, user, busy: pageBusy = false }: Props = $props();

	let open = $state(false);
	let selectedDivision = $state<Division | null>(null);
	let signupAnswer = $state("");
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
		// Capture the narrowed value: inside the closure, the $state widens
		// back to Division | null.
		const division = selectedDivision;
		// Refresh on success drives layout-level myTournaments (the header
		// dropdown) and the page-level tournament detail (viewer_slot, slots).
		const ok = await runAction(
			() =>
				cloudApi.signupForTournament(
					tournament.tournament_id,
					division,
					signupAnswer,
				),
			{
				setBusy: (b) => (busy = b),
				failMessage: "Sign up failed",
				// Friendly copy for the two expected 409s; anything else falls
				// through to the server's message.
				onError: (err) =>
					err.code === "SIGNUPS_CLOSED"
						? "Signups just closed — the tournament started."
						: err.code === "ALREADY_SIGNED_UP"
							? "You're already signed up for this tournament."
							: undefined,
			},
		);
		if (ok !== null) open = false;
	}
</script>

<Popover
	bind:open
	ariaLabel="Sign up"
	contentClass="w-[min(92vw,28rem)]"
	frameClass="border-2 border-surface bg-surface p-3 shadow-[0_24px_64px_-12px_rgb(var(--color-black)/0.85)]"
>
	{#snippet trigger({ props })}
		<button
			{...props}
			type="button"
			class="whitespace-nowrap rounded border border-tan px-3 py-1.5 text-xs text-tan disabled:opacity-50"
			disabled={pageBusy}
		>
			Sign up
		</button>
	{/snippet}

	<div class="flex flex-col gap-3">
		<div
			class="rounded-lg px-3 py-2"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<h2 class="text-sm font-bold text-tan">Sign up for {tournament.name}</h2>
		</div>

		<p class="text-xs text-tan opacity-80">
			Pick the division you want to play in. You can withdraw before the
			tournament starts.
		</p>

		<RadioGroup
			value={selectedDivision ?? ""}
			onChange={(v) => (selectedDivision = v as Division)}
			disabled={busy}
			ariaLabel="Division"
			class="flex flex-col gap-2 text-xs text-tan"
		>
			<label
				class="flex cursor-pointer items-center gap-2 rounded border border-black bg-surface-raised p-2"
			>
				<RadioItem value="A" disabled={busy} />
				<span>{divisionLabel("A")}</span>
			</label>
			<label
				class="flex cursor-pointer items-center gap-2 rounded border border-black bg-surface-raised p-2"
			>
				<RadioItem value="B" disabled={busy} />
				<span>{divisionLabel("B")}</span>
			</label>
		</RadioGroup>

		{#if tournament.signup_question}
			<label class="flex flex-col gap-1 text-xs text-tan">
				<span>{tournament.signup_question}</span>
				<textarea
					bind:value={signupAnswer}
					rows="2"
					maxlength="2000"
					disabled={busy}
					class="rounded border border-black bg-surface-raised p-2 focus:outline-none disabled:opacity-50"
				></textarea>
				<span class="text-[11px] opacity-60">Optional.</span>
			</label>
		{/if}

		<p class="text-[11px] text-tan opacity-60">
			Signed in as <span class="font-mono text-tan opacity-90"
				>@{user.discord_username}</span
			>
			— we'll use this Discord handle to identify you in pairings.
		</p>

		<FormFooter
			onCancel={() => (open = false)}
			onConfirm={submit}
			confirmLabel="Sign me up"
			busyLabel="Signing up…"
			{busy}
			confirmDisabled={!canSubmit}
		/>
	</div>
</Popover>
