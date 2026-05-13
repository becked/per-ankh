<script lang="ts">
	import { resolve } from "$app/paths";
	import type { TournamentMatch, TournamentRound } from "$lib/api-cloud";
	import { formatEnum } from "$lib/utils/formatting";

	interface Props {
		matches: TournamentMatch[];
		round: TournamentRound;
		tournamentSlug: string;
		// eslint-disable-next-line no-unused-vars -- type-signature param names are documentary
		slotLabel: (slotId: string | null) => string;
		busy: boolean;

		// Pairing edit state
		pairingEditMatchId: string | null;
		pairingMapInput: string;
		// eslint-disable-next-line no-unused-vars
		onOpenPairingEdit: (m: TournamentMatch) => void;
		// eslint-disable-next-line no-unused-vars
		onSavePairing: (matchId: string) => void;
		onCancelPairingEdit: () => void;
		// eslint-disable-next-line no-unused-vars
		onMapInput: (v: string) => void;

		// Retro-edit state
		retroEditMatchId: string | null;
		retroWinnerSlotId: string | null;
		retroStatus: "reported" | "forfeit" | "pending";
		// eslint-disable-next-line no-unused-vars
		onOpenRetroEdit: (m: TournamentMatch) => void;
		// eslint-disable-next-line no-unused-vars
		onSaveRetroEdit: (matchId: string) => void;
		onCancelRetroEdit: () => void;
		// eslint-disable-next-line no-unused-vars
		onRetroWinner: (v: string | null) => void;
		// eslint-disable-next-line no-unused-vars
		onRetroStatus: (v: "reported" | "forfeit" | "pending") => void;
	}

	let {
		matches,
		round,
		tournamentSlug,
		slotLabel,
		busy,
		pairingEditMatchId,
		pairingMapInput,
		onOpenPairingEdit,
		onSavePairing,
		onCancelPairingEdit,
		onMapInput,
		retroEditMatchId,
		retroWinnerSlotId,
		retroStatus,
		onOpenRetroEdit,
		onSaveRetroEdit,
		onCancelRetroEdit,
		onRetroWinner,
		onRetroStatus,
	}: Props = $props();
</script>

<div class="flex flex-col gap-2">
	{#each matches as match (match.match_id)}
		<div
			class="rounded border border-black border-opacity-50 bg-blue-gray p-2 text-xs text-tan"
		>
			<div class="flex items-center justify-between gap-2">
				<div class="flex-1 truncate">
					<span class:font-bold={match.winner_slot_id === match.slot_a_id}>
						{slotLabel(match.slot_a_id)}
					</span>
					<span class="opacity-50">vs</span>
					<span class:font-bold={match.winner_slot_id === match.slot_b_id}>
						{slotLabel(match.slot_b_id)}
					</span>
					{#if match.map_script}
						<span class="ml-2 opacity-60">
							· {formatEnum(match.map_script, "MAPCLASS_")}
						</span>
					{/if}
				</div>
				<span class="whitespace-nowrap opacity-70">{match.status}</span>
				<div class="flex gap-1">
					<a
						href={resolve("/tournaments/[slug]/matches/[match_id]", {
							slug: tournamentSlug,
							match_id: match.match_id,
						})}
						class="rounded border border-black px-2 py-0.5 text-[10px] hover:bg-[#35302b]"
					>
						Open
					</a>
					{#if match.slot_b_id !== null}
						<a
							href="{resolve(
								'/upload',
							)}?tournament_match_id={match.match_id}&return_slug={tournamentSlug}&observer=1"
							class="rounded border border-black px-2 py-0.5 text-[10px] hover:bg-[#35302b]"
						>
							Upload
						</a>
					{/if}
					{#if round.status === "pending" && match.status === "pending"}
						<button
							type="button"
							class="rounded border border-black px-2 py-0.5 text-[10px] hover:bg-[#35302b] disabled:opacity-50"
							onclick={() => onOpenPairingEdit(match)}
							disabled={busy}
						>
							Pair
						</button>
					{/if}
					{#if match.status !== "pending" && match.status !== "bye"}
						<button
							type="button"
							class="rounded border border-black px-2 py-0.5 text-[10px] hover:bg-[#35302b] disabled:opacity-50"
							onclick={() => onOpenRetroEdit(match)}
							disabled={busy}
						>
							Edit result
						</button>
					{/if}
				</div>
			</div>

			{#if pairingEditMatchId === match.match_id}
				<div
					class="mt-2 flex flex-wrap items-end gap-2 border-t border-black border-opacity-30 pt-2"
				>
					<label class="text-[10px]">
						Map script
						<input
							type="text"
							value={pairingMapInput}
							oninput={(e) => onMapInput((e.target as HTMLInputElement).value)}
							class="mt-1 block rounded border border-black bg-[#35302b] p-1 text-xs text-tan"
						/>
					</label>
					<button
						type="button"
						class="hover:bg-orange/20 rounded border border-orange px-2 py-1 text-[10px] disabled:opacity-50"
						onclick={() => onSavePairing(match.match_id)}
						disabled={busy}
					>
						Save
					</button>
					<button
						type="button"
						class="rounded border border-brown px-2 py-1 text-[10px] hover:bg-brown disabled:opacity-50"
						onclick={onCancelPairingEdit}
						disabled={busy}
					>
						Cancel
					</button>
				</div>
			{/if}

			{#if retroEditMatchId === match.match_id}
				<div
					class="mt-2 flex flex-wrap items-end gap-2 border-t border-black border-opacity-30 pt-2"
				>
					<label class="text-[10px]">
						Winner
						<select
							value={retroWinnerSlotId}
							onchange={(e) =>
								onRetroWinner((e.target as HTMLSelectElement).value || null)}
							class="mt-1 block rounded border border-black bg-[#35302b] p-1 text-xs text-tan"
						>
							<option value={match.slot_a_id}
								>{slotLabel(match.slot_a_id)}</option
							>
							{#if match.slot_b_id}
								<option value={match.slot_b_id}>
									{slotLabel(match.slot_b_id)}
								</option>
							{/if}
						</select>
					</label>
					<label class="text-[10px]">
						Status
						<select
							value={retroStatus}
							onchange={(e) =>
								onRetroStatus(
									(e.target as HTMLSelectElement).value as Props["retroStatus"],
								)}
							class="mt-1 block rounded border border-black bg-[#35302b] p-1 text-xs text-tan"
						>
							<option value="reported">reported</option>
							<option value="forfeit">forfeit</option>
							<option value="pending">pending</option>
						</select>
					</label>
					<button
						type="button"
						class="hover:bg-orange/20 rounded border border-orange px-2 py-1 text-[10px] disabled:opacity-50"
						onclick={() => onSaveRetroEdit(match.match_id)}
						disabled={busy}
					>
						Save
					</button>
					<button
						type="button"
						class="rounded border border-brown px-2 py-1 text-[10px] hover:bg-brown disabled:opacity-50"
						onclick={onCancelRetroEdit}
						disabled={busy}
					>
						Cancel
					</button>
				</div>
			{/if}
		</div>
	{/each}
	{#if matches.length === 0}
		<p class="text-[10px] text-tan opacity-50">No matches in this round.</p>
	{/if}
</div>
