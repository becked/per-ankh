<script lang="ts">
	// Admin-only roster management: list current admins, add another Per-Ankh
	// user by autocomplete, remove co-admins. The creator is shown but can't be
	// removed. Adding a user who isn't on the tournament beta allowlist is
	// allowed but warned about — they can't reach the tournament until granted
	// beta separately.

	import { invalidateAll } from "$app/navigation";
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
		busy = true;
		try {
			const res = await cloudApi.grantTournamentAdmin(
				tournament.tournament_id,
				pendingUser.user_id,
			);
			if (!res.is_beta) {
				toast.info(
					`@${pendingUser.discord_username} was added, but isn't in the tournament beta yet — they can't open the tournament until granted beta access.`,
				);
			} else {
				toast.info(`@${pendingUser.discord_username} is now an admin.`);
			}
			addValue = "";
			pendingUser = null;
			await reload();
			// Refresh the header's owner/admins meta strip.
			await invalidateAll();
		} catch (err) {
			let message = "Couldn't add admin";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			toast.error(message);
		} finally {
			busy = false;
		}
	}

	async function remove(admin: TournamentAdmin) {
		busy = true;
		try {
			await cloudApi.revokeTournamentAdmin(
				tournament.tournament_id,
				admin.user_id,
			);
			toast.info(`Removed ${admin.display_name} as admin.`);
			await reload();
			await invalidateAll();
		} catch (err) {
			let message = "Couldn't remove admin";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			toast.error(message);
		} finally {
			busy = false;
		}
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
					class="flex items-center justify-between gap-3 rounded border border-black bg-[#35302b] p-2"
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
				class="bg-orange/20 hover:bg-orange/40 rounded border border-tan px-3 py-1.5 text-tan disabled:opacity-50"
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
