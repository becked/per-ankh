<script lang="ts">
	import { Tabs } from "bits-ui";
	import { goto, invalidateAll } from "$app/navigation";
	import { page } from "$app/state";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import {
		cloudApi,
		type AdminGameFilterParams,
		type UserSearchResult,
	} from "$lib/api-cloud";
	import BulkReparseModal from "$lib/BulkReparseModal.svelte";
	import BulkReindexModal from "$lib/BulkReindexModal.svelte";
	import FeaturedVideosTable from "$lib/FeaturedVideosTable.svelte";
	import { syncFeatured } from "$lib/featured-videos.svelte";
	import Select from "$lib/ui/Select.svelte";
	import { toast } from "$lib/ui/toast";
	import UserAutocomplete from "$lib/ui/UserAutocomplete.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let reparseOpen = $state(false);
	let reindexOpen = $state(false);
	let rebuildingRatings = $state(false);

	// Client-side, like /account's — the two tabs are different jobs, not
	// different views of one thing, and neither is worth linking to. (The
	// reparse filters keep their own URL sync; they belong to the section
	// picker, not the tab.)
	let activeTab = $state("reparse");

	// Subtab triggers styled as chip-bar pills, matching /account and the
	// game-detail and aggregate-stats tab bars.
	const triggerClass =
		"cursor-pointer rounded px-3 py-1.5 text-sm font-bold text-tan transition-colors hover:bg-tan-hover data-[state=active]:bg-surface-raised data-[state=inactive]:bg-surface";

	// This page's own fetch of the featured set is fresher than the layout's
	// (which ran once, on the first load of the session), so re-seed the shared
	// set the stars and the table below both read.
	$effect(() => {
		syncFeatured(data.featuredVideos);
	});

	const ownerCount = $derived(
		new Set(data.outOfDateGames.map((g) => g.user_id)).size,
	);

	async function onReparseClose(didReparse: boolean) {
		reparseOpen = false;
		if (didReparse) await invalidateAll();
	}

	async function onReindexClose(didReindex: boolean) {
		reindexOpen = false;
		if (didReindex) await invalidateAll();
	}

	// No modal and no confirm: the rebuild replaces two caches that are wholly
	// derived from games and tournament results, so the worst a stray click
	// costs is the seconds it takes to run again.
	async function rebuildRatings() {
		if (rebuildingRatings) return;
		rebuildingRatings = true;
		try {
			const r = await cloudApi.rebuildRatings();
			toast.info(
				`Rated ${r.users} players from ${r.ratableDuels} duels; ${r.recommended} got a list.`,
			);
		} catch (err) {
			toast.error(
				`Rebuild failed: ${err instanceof Error ? err.message : err}`,
			);
		} finally {
			rebuildingRatings = false;
		}
	}

	// --- Section ------------------------------------------------------
	//
	// Both sweeps act on one section of the corpus at a time. The axis is a
	// single mutually-exclusive choice; the URL carries the value so a section
	// survives the reload a long sweep invites.

	type Section = "all" | "user" | "tournament" | "date";

	const SECTION_OPTIONS = [
		{ value: "all", label: "All games" },
		{ value: "user", label: "One user" },
		{ value: "tournament", label: "One tournament" },
		{ value: "date", label: "Upload date range" },
	];

	const FILTER_KEYS = ["user_id", "tournament_id", "from", "to"] as const;

	function sectionFromFilter(filter: AdminGameFilterParams): Section {
		if (filter.tournament_id) return "tournament";
		if (filter.user_id) return "user";
		if (filter.from || filter.to) return "date";
		return "all";
	}

	// The URL is what the lists are actually filtered by; `section` is the
	// picked axis, which is legitimately ahead of it while an admin has chosen
	// "Upload date range" but not yet entered a date. Seeded from the URL, and
	// re-seeded when navigation lands on a filter this picker didn't set (back
	// button, a pasted link) — never back to "all", which would fight the
	// admin's own selection.
	// svelte-ignore state_referenced_locally
	let section = $state<Section>(sectionFromFilter(data.filter));
	$effect(() => {
		const fromUrl = sectionFromFilter(data.filter);
		if (fromUrl !== "all") section = fromUrl;
	});

	// Text shown in the user autocomplete. Writable derived: typing overrides
	// it, and it snaps back whenever load() resolves a new owner — the display
	// name comes from the server, so a section restored from a bare ?user_id
	// names the user instead of echoing the id back.
	let userText = $derived(data.ownerName ?? "");

	const tournamentOptions = $derived(
		data.tournaments.map((t) => ({ value: t.tournament_id, label: t.name })),
	);

	// Writing every key on each change (rather than patching one) keeps the URL
	// to a single axis: switching sections drops the previous one's params.
	async function writeFilter(next: AdminGameFilterParams) {
		const url = new URL(page.url);
		for (const key of FILTER_KEYS) {
			const value = next[key];
			if (value) url.searchParams.set(key, value);
			else url.searchParams.delete(key);
		}
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- search-param-only update on the current route; URL objects are SvelteKit's documented dynamic-nav API
		await goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	async function selectSection(next: string | null) {
		section = (next ?? "all") as Section;
		await writeFilter({});
	}

	async function selectUser(user: UserSearchResult | null) {
		await writeFilter(user ? { user_id: user.user_id } : {});
	}

	async function selectTournament(tournamentId: string | null) {
		await writeFilter(tournamentId ? { tournament_id: tournamentId } : {});
	}

	async function selectDate(key: "from" | "to", value: string) {
		await writeFilter({ ...data.filter, [key]: value || undefined });
	}

	const isFiltered = $derived(sectionFromFilter(data.filter) !== "all");
</script>

<main class="cloud-scroll flex-1 overflow-y-auto px-4 py-8" use:autohideScroll>
	<div class="mx-auto max-w-xl">
		<Tabs.Root bind:value={activeTab}>
			<Tabs.List
				class="mx-auto mb-4 flex w-fit flex-wrap items-center gap-1 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg"
			>
				<Tabs.Trigger value="reparse" class={triggerClass}>Reparse</Tabs.Trigger
				>
				<Tabs.Trigger value="featured" class={triggerClass}
					>Featured</Tabs.Trigger
				>
				<Tabs.Trigger value="ratings" class={triggerClass}>Ratings</Tabs.Trigger
				>
			</Tabs.List>

			<Tabs.Content value="reparse">
				<div class="space-y-4">
					<div
						class="rounded-lg p-4"
						style="background-color: rgb(var(--color-surface));"
					>
						<h3 class="mb-3 text-base font-bold text-tan">Admin — Section</h3>
						<div
							class="space-y-3 rounded-lg p-3"
							style="background-color: rgb(var(--color-surface-raised));"
						>
							<p class="text-xs text-tan">
								Narrows both sweeps below to one slice of the corpus, so a full
								reindex or reparse can be run a section at a time.
							</p>
							<Select
								value={section}
								onChange={selectSection}
								options={SECTION_OPTIONS}
								ariaLabel="Section"
							/>

							{#if section === "user"}
								<UserAutocomplete
									value={userText}
									onValueChange={(next) => (userText = next)}
									onSelectUser={selectUser}
								/>
							{:else if section === "tournament"}
								<Select
									value={data.filter.tournament_id ?? ""}
									onChange={selectTournament}
									options={tournamentOptions}
									placeholder="Select a tournament"
									ariaLabel="Tournament"
								/>
								<p class="text-xs text-tan">
									The saves linked to the tournament's completed matches — the
									same set its stats page aggregates.
								</p>
							{:else if section === "date"}
								<div class="flex items-center gap-2">
									<label class="flex-1 text-xs text-tan">
										From
										<input
											type="date"
											value={data.filter.from ?? ""}
											onchange={(e) =>
												selectDate("from", e.currentTarget.value)}
											class="mt-1 block w-full rounded border border-black bg-surface-raised p-1.5 text-xs text-tan"
										/>
									</label>
									<label class="flex-1 text-xs text-tan">
										To
										<input
											type="date"
											value={data.filter.to ?? ""}
											onchange={(e) => selectDate("to", e.currentTarget.value)}
											class="mt-1 block w-full rounded border border-black bg-surface-raised p-1.5 text-xs text-tan"
										/>
									</label>
								</div>
								<p class="text-xs text-tan">
									Upload date (UTC), both bounds inclusive. Either may be left
									empty for an open-ended range.
								</p>
							{/if}
						</div>
					</div>

					<div
						class="rounded-lg p-4"
						style="background-color: rgb(var(--color-surface));"
					>
						<h3 class="mb-3 text-base font-bold text-tan">Admin — Reparse</h3>
						<div
							class="rounded-lg p-3"
							style="background-color: rgb(var(--color-surface-raised));"
						>
							<p class="mb-3 text-xs text-tan">
								Reparse each game in the section whose stored parser version is
								older than the current build. Downloads, parses, and re-uploads
								each game in this browser tab. Audited as <code
									class="text-orange">admin_reimport</code
								>.
							</p>
							<div class="mb-3 text-sm text-tan">
								{#if data.outOfDateGames.length === 0}
									{isFiltered
										? "Every game in this section is on the current parser version."
										: "All games are on the current parser version."}
								{:else}
									{data.outOfDateGames.length}
									{data.outOfDateGames.length === 1 ? "game" : "games"} across {ownerCount}
									{ownerCount === 1 ? "user" : "users"}.
								{/if}
							</div>
							<button
								type="button"
								onclick={() => (reparseOpen = true)}
								disabled={data.outOfDateGames.length === 0}
								class="rounded bg-orange px-3 py-1 text-xs font-bold text-white hover:bg-orange/80 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-orange"
							>
								{data.outOfDateGames.length === 0
									? "Nothing to reparse"
									: isFiltered
										? `Reparse ${data.outOfDateGames.length} in this section`
										: `Reparse all ${data.outOfDateGames.length}`}
							</button>
						</div>
					</div>

					<div
						class="rounded-lg p-4"
						style="background-color: rgb(var(--color-surface));"
					>
						<h3 class="mb-3 text-base font-bold text-tan">Admin — Reindex</h3>
						<div
							class="rounded-lg p-3"
							style="background-color: rgb(var(--color-surface-raised));"
						>
							<p class="mb-3 text-xs text-tan">
								Rebuild the section's derived D1 tables (summaries, per-turn
								series, tech/law/wonder events, wonder pools) from each stored
								blob. No re-parse — reads each game's existing cloud blob and
								re-runs the database pivot in the Worker. Use this to backfill
								columns added after upload (e.g. per-turn victory points).
								Audited as <code class="text-orange">admin_reindex</code>.
							</p>
							<div class="mb-3 text-sm text-tan">
								{#if data.allGames.length === 0}
									{isFiltered
										? "No games in this section."
										: "No games to reindex."}
								{:else}
									{data.allGames.length}
									{data.allGames.length === 1 ? "game" : "games"}.
								{/if}
							</div>
							<button
								type="button"
								onclick={() => (reindexOpen = true)}
								disabled={data.allGames.length === 0}
								class="rounded bg-orange px-3 py-1 text-xs font-bold text-white hover:bg-orange/80 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-orange"
							>
								{data.allGames.length === 0
									? "Nothing to reindex"
									: isFiltered
										? `Reindex ${data.allGames.length} in this section`
										: `Reindex all ${data.allGames.length}`}
							</button>
						</div>
					</div>
				</div>
			</Tabs.Content>

			<Tabs.Content value="featured">
				<FeaturedVideosTable videos={data.featuredVideos} />
			</Tabs.Content>

			<Tabs.Content value="ratings">
				<div
					class="rounded-lg p-4"
					style="background-color: rgb(var(--color-surface));"
				>
					<h3 class="mb-3 text-base font-bold text-tan">
						Admin — Recommended opponents
					</h3>
					<div
						class="rounded-lg p-3"
						style="background-color: rgb(var(--color-surface-raised));"
					>
						<p class="mb-3 text-xs text-tan">
							Re-fit the rating model over every duel D1 can reconstruct, and
							re-pick each player's ten suggested opponents. This runs on its
							own in the nightly cron; the button is for the first run after a
							deploy, and for after a reindex sweep has backfilled
							<code class="text-orange">player_summaries.online_id</code> — which
							is what lets a casual game's opponent be identified at all. Full replace,
							safe to repeat.
						</p>
						<button
							type="button"
							onclick={rebuildRatings}
							disabled={rebuildingRatings}
							class="rounded bg-orange px-3 py-1 text-xs font-bold text-white hover:bg-orange/80 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-orange"
						>
							{rebuildingRatings ? "Rebuilding…" : "Rebuild now"}
						</button>
					</div>
				</div>
			</Tabs.Content>
		</Tabs.Root>
	</div>
</main>

{#if reparseOpen}
	<BulkReparseModal
		games={data.outOfDateGames}
		onClose={onReparseClose}
		adminMode={true}
	/>
{/if}

{#if reindexOpen}
	<BulkReindexModal games={data.allGames} onClose={onReindexClose} />
{/if}
