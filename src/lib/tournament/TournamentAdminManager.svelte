<script lang="ts">
	// Admin-only roster management: list current admins, add another Per-Ankh
	// user by autocomplete, remove co-admins. The creator is shown but can't be
	// removed. Any Per-Ankh user can be added as a co-admin — the tournament
	// feature is public, so a newly-granted admin can manage it immediately
	// (the create-allowlist gates only creating tournaments, not admin duties).

	import { runAction } from "$lib/tournament/async-action";
	import {
		ApiError,
		cloudApi,
		type TournamentAdmin,
		type TournamentDetail,
		type UserSearchResult,
	} from "$lib/api-cloud";
	import { toast } from "$lib/ui/toast";
	import UserAutocomplete from "./UserAutocomplete.svelte";

	interface Props {
		tournament: TournamentDetail;
	}

	let { tournament }: Props = $props();

	let admins = $state<TournamentAdmin[]>([]);
	let loading = $state(true);
	let busy = $state(false);
	// The user picked from the autocomplete. Granting requires a real user_id,
	// so free-text alone can't enable the Add button.
	let addValue = $state("");
	let pendingUser = $state<UserSearchResult | null>(null);

	async function reload() {
		try {
			const res = await cloudApi.listTournamentAdmins(tournament.tournament_id);
			admins = res.admins;
		} catch (err) {
			if (err instanceof ApiError) toast.error(err.message);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		// Load once on mount. tournament_id is stable for the component's life.
		void tournament.tournament_id;
		reload();
	});

	const canAdd = $derived(!busy && pendingUser !== null);

	async function add() {
		if (!canAdd || pendingUser === null) return;
		const target = pendingUser;
		// runAction's invalidateAll refreshes the header's owner/admins strip.
		const ok = await runAction(
			() =>
				cloudApi.grantTournamentAdmin(tournament.tournament_id, target.user_id),
			{
				setBusy: (b) => (busy = b),
				failMessage: "Couldn't add admin",
				success: `${target.display_name} is now an admin.`,
			},
		);
		if (ok !== null) {
			addValue = "";
			pendingUser = null;
			await reload();
		}
	}

	async function remove(admin: TournamentAdmin) {
		const ok = await runAction(
			() =>
				cloudApi.revokeTournamentAdmin(tournament.tournament_id, admin.user_id),
			{
				setBusy: (b) => (busy = b),
				success: `Removed ${admin.display_name} as admin.`,
				failMessage: "Couldn't remove admin",
			},
		);
		if (ok !== null) await reload();
	}
</script>

<div class="flex flex-col gap-3 text-xs text-tan">
	<h3 class="font-bold">Admins</h3>

	{#if loading}
		<p class="opacity-60">Loading…</p>
	{:else}
		<ul class="flex flex-col gap-1.5">
			{#each admins as admin (admin.user_id)}
				<li
					class="flex items-center justify-between gap-3 rounded border border-black bg-surface-raised p-2"
				>
					<span class="flex items-center gap-2">
						<img
							src={admin.avatar_url}
							alt=""
							class="h-5 w-5 rounded-full"
							loading="lazy"
						/>
						<span>{admin.display_name}</span>
						{#if admin.is_creator}
							<span class="opacity-60">(creator)</span>
						{/if}
					</span>
					{#if !admin.is_creator}
						<button
							type="button"
							class="rounded border border-tan px-2 py-0.5 text-tan transition-colors hover:border-red-400 hover:text-red-400 disabled:opacity-50"
							onclick={() => remove(admin)}
							disabled={busy}
						>
							Remove
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<div class="flex flex-col gap-1">
		<span class="opacity-70">Add an admin</span>
		<div class="flex items-start gap-2">
			<div class="flex-1">
				<UserAutocomplete
					value={addValue}
					onValueChange={(next) => (addValue = next)}
					onSelectUser={(user) => (pendingUser = user)}
					onEnter={add}
					disabled={busy}
					placeholder="Search Per-Ankh users…"
				/>
			</div>
			<button
				type="button"
				class="rounded border border-tan px-3 py-1.5 text-tan disabled:opacity-50"
				onclick={add}
				disabled={!canAdd}
			>
				Add
			</button>
		</div>
		<span class="opacity-60"
			>Pick an existing Per-Ankh user. Any admin can add or remove admins; the
			creator can't be removed.</span
		>
	</div>
</div>
