<script lang="ts">
	import {
		cloudApi,
		type MapPoolEntry,
		type TournamentDetail,
	} from "$lib/api-cloud";
	import {
		allMapScriptsByDlc,
		DLC_GROUP_LABELS,
	} from "$lib/tournament/map-scripts";
	import MapScriptOptionsBlock from "$lib/tournament/MapScriptOptionsBlock.svelte";
	import {
		defaultsForScript,
		distinguishingOptions,
		mapPoolLabel,
		optionsForScript,
	} from "$lib/tournament/map-script-options";
	import Select from "$lib/ui/Select.svelte";
	import { runAction } from "$lib/tournament/async-action";

	interface Props {
		tournament: TournamentDetail;
	}

	let { tournament }: Props = $props();

	// A staged, not-yet-committed instance. Unlike the setup-time maps panel —
	// which commits on add and then lets you tweak options — a started
	// tournament's pool is append-only: once an instance lands it's frozen
	// (matches reference it by id with no options snapshot). So we configure the
	// whole instance locally and commit it in a single PATCH.
	let draft = $state<{
		script: string;
		options: Record<string, string | boolean>;
	} | null>(null);
	let saving = $state(false);

	const mapScriptGroups = allMapScriptsByDlc().map((g) => ({
		heading: DLC_GROUP_LABELS[g.dlc],
		options: g.entries.map((e) => ({ value: e.value, label: e.label })),
	}));

	const draftHasOptions = $derived(
		draft !== null && optionsForScript(draft.script).length > 0,
	);

	// Preview label for the staged instance, using the same canonical label as
	// the rest of the UI. The draft is included in the pool when computing which
	// options vary, so its variant shows when it differs from existing maps.
	const draftEntry = $derived<MapPoolEntry | null>(
		draft
			? { id: "draft", script: draft.script, options: draft.options }
			: null,
	);
	const draftLabel = $derived(
		draftEntry
			? mapPoolLabel(
					draftEntry,
					distinguishingOptions([...tournament.map_pool, draftEntry]),
					false,
				)
			: "",
	);

	// Client-side instance id (16 hex chars), regex-safe for the server schema;
	// the server keeps it rather than reassigning. Matches TournamentMapsPanel.
	function newInstanceId(): string {
		return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
			b.toString(16).padStart(2, "0"),
		).join("");
	}

	function startDraft(script: string) {
		if (!script) return;
		draft = { script, options: defaultsForScript(script) };
	}

	function cancelDraft() {
		draft = null;
	}

	async function addDraft() {
		if (!draft) return;
		const entry: MapPoolEntry = {
			id: newInstanceId(),
			script: draft.script,
			options: draft.options,
		};
		// Send the full pool: every existing instance unchanged + the new one.
		// The server's append-only check accepts this; any edit/removal of an
		// existing instance would be rejected.
		const next = [...tournament.map_pool, entry];
		const ok = await runAction(
			() =>
				cloudApi.patchTournament(tournament.tournament_id, { map_pool: next }),
			{
				setBusy: (b) => (saving = b),
				success: "Map added",
				failMessage: "Add failed",
			},
		);
		if (ok !== null) draft = null;
	}
</script>

<section
	class="mt-4 rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<h2 class="mb-1 text-sm font-bold text-tan">Add a map</h2>
	<p class="mb-3 text-xs text-tan opacity-60">
		New maps apply to future rounds. Existing maps can't be changed or removed
		once the tournament has started.
	</p>

	{#if draft === null}
		<Select
			value=""
			onChange={(v) => {
				if (v) startDraft(v);
			}}
			options={mapScriptGroups}
			resetAfterSelect
			placeholder="Add a map…"
			disabled={saving}
			ariaLabel="Add map script"
		/>
	{:else}
		<div class="rounded border border-black bg-surface-raised p-3">
			<p class="mb-2 text-xs font-bold text-tan">
				{draftLabel}
			</p>
			{#if draftHasOptions}
				<div class="mb-3 border-t border-black pt-2">
					<MapScriptOptionsBlock
						script={draft.script}
						options={draft.options}
						disabled={saving}
						onChange={(options) => {
							if (draft) draft = { ...draft, options };
						}}
					/>
				</div>
			{/if}
			<div class="flex items-center gap-2">
				<button
					type="button"
					class="rounded border border-orange px-2.5 py-1 text-xs text-orange transition-colors hover:bg-orange hover:text-black disabled:opacity-50"
					onclick={addDraft}
					disabled={saving}
				>
					Add to pool
				</button>
				<button
					type="button"
					class="rounded border border-tan px-2.5 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
					onclick={cancelDraft}
					disabled={saving}
				>
					Cancel
				</button>
			</div>
		</div>
	{/if}
</section>
