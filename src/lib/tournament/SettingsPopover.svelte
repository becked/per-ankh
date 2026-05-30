<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import {
		ApiError,
		cloudApi,
		type TournamentDetail,
		type UserMe,
	} from "$lib/api-cloud";
	import { confirmDialog } from "$lib/ui/confirm";
	import Popover from "$lib/ui/Popover.svelte";
	import { toast } from "$lib/ui/toast";
	import TournamentAdminManager from "./TournamentAdminManager.svelte";
	import TournamentMapPoolAdder from "./TournamentMapPoolAdder.svelte";
	import TournamentMapPoolSummary from "./TournamentMapPoolSummary.svelte";
	import TournamentSettingsForm from "./TournamentSettingsForm.svelte";

	interface Props {
		tournament: TournamentDetail;
		// Disabled while a match popover is open (shallow-routing guard).
		disabled?: boolean;
	}

	let { tournament, disabled = false }: Props = $props();

	let open = $state(false);
	let deleting = $state(false);
	let exporting = $state(false);

	const isAdmin = $derived(tournament.is_viewer_admin === true);
	const user = $derived(page.data.user as UserMe | null);
	// Delete is the creator's or the global site admin's power, and only while
	// the tournament hasn't completed (completed tournaments are CLI-only).
	const canDelete = $derived(
		(tournament.is_viewer_creator || user?.is_admin === true) &&
			tournament.status !== "complete",
	);

	async function handleExport() {
		exporting = true;
		try {
			const blob = await cloudApi.exportTournament(tournament.tournament_id);
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${tournament.slug}-export.zip`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		} catch (err) {
			let message = "Couldn't export tournament";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			toast.error(message);
		} finally {
			exporting = false;
		}
	}

	async function handleDelete() {
		const ok = await confirmDialog({
			title: "Delete tournament",
			message: `Delete "${tournament.name}"? This permanently removes the tournament and all its slots, rounds, and matches. Uploaded game saves are kept. This can't be undone.`,
			confirmLabel: "Delete tournament",
			destructive: true,
		});
		if (!ok) return;
		deleting = true;
		try {
			await cloudApi.deleteTournament(tournament.tournament_id);
			toast.info("Tournament deleted.");
			open = false;
			await goto(resolve("/tournaments"));
			await invalidateAll();
		} catch (err) {
			let message = "Couldn't delete tournament";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			toast.error(message);
			deleting = false;
		}
	}
</script>

<Popover
	bind:open
	ariaLabel="Tournament settings"
	contentClass="w-[min(95vw,56rem)]"
>
	{#snippet trigger({ props })}
		<button
			{...props}
			type="button"
			class="whitespace-nowrap rounded border border-tan px-2.5 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
			{disabled}
			aria-label="Tournament settings"
		>
			Settings
		</button>
	{/snippet}

	<header class="mb-4 flex items-baseline justify-between gap-3">
		<h2 class="border-b-2 border-orange pb-1 text-lg font-bold text-tan">
			Tournament settings
		</h2>
		<button
			type="button"
			class="text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
			onclick={() => (open = false)}
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

	<!-- During setup, the overview/config/maps panels render on the tournament
	page itself, so the modal would only duplicate them. Show the settings form
	and map pool here only once the tournament has started (when those page
	panels are gone); in setup the modal is just Admins + Delete below. -->
	{#if tournament.status !== "setup"}
		<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
			<div class="rounded-lg p-4" style="background-color: #2a2622;">
				<TournamentSettingsForm {tournament} canEdit={isAdmin} />
			</div>
			<div>
				<TournamentMapPoolSummary mapPool={tournament.map_pool} />
				{#if isAdmin && (tournament.status === "swiss" || tournament.status === "championship")}
					<TournamentMapPoolAdder {tournament} />
				{/if}
			</div>
		</div>
	{/if}

	{#if isAdmin}
		<div class="mt-4 rounded-lg p-4" style="background-color: #2a2622;">
			<TournamentAdminManager {tournament} />
		</div>
	{/if}

	{#if isAdmin}
		<div
			class="mt-4 flex items-center justify-between gap-3 rounded-lg p-4"
			style="background-color: #2a2622;"
		>
			<div class="text-xs text-tan">
				<p class="font-bold">Export CSV</p>
				<p class="opacity-60">
					Download the standings and full match schedule as a zip of CSV files.
				</p>
			</div>
			<button
				type="button"
				class="whitespace-nowrap rounded border border-tan px-3 py-1.5 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
				onclick={handleExport}
				disabled={exporting}
			>
				{exporting ? "Exporting…" : "Export CSV"}
			</button>
		</div>
	{/if}

	{#if canDelete}
		<div
			class="mt-4 flex items-center justify-between gap-3 rounded-lg p-4"
			style="background-color: #2a2622;"
		>
			<div class="text-xs text-tan">
				<p class="font-bold">Delete tournament</p>
				<p class="opacity-60">
					Permanently removes this tournament and all its slots, rounds, and
					matches. Uploaded game saves are kept.
				</p>
			</div>
			<button
				type="button"
				class="whitespace-nowrap rounded border border-red-400 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-400 hover:text-black disabled:opacity-50"
				onclick={handleDelete}
				disabled={deleting}
			>
				{deleting ? "Deleting…" : "Delete tournament"}
			</button>
		</div>
	{/if}
</Popover>
