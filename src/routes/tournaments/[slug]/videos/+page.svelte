<script lang="ts">
	// Tournament Videos view. The tournament's recorded games, browsable at the
	// level people actually look for them: a MATCH is one game, played across one
	// or more PARTS, each of which may have been filmed from several ANGLES —
	// a caster's broadcast, or a player's own point of view. Opening a match lists
	// its parts and lets you pick a camera.
	//
	// Each side carries its nation's crest and colour, which is also the filter
	// axis: the nation select narrows to matches where either player fielded it.
	import { SvelteSet } from "svelte/reactivity";
	import SearchInput from "$lib/SearchInput.svelte";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import FeaturedStar from "$lib/FeaturedStar.svelte";
	import { getCivilizationColor } from "$lib/config";
	import { formatShortDate, nationName } from "$lib/utils/formatting";
	import { mapScriptLabel } from "$lib/tournament/map-scripts";
	import { padMatchNumber } from "$lib/tournament/match-numbers";
	import {
		formatRuntime,
		type ArchiveAngle,
		type ArchiveMatch,
	} from "$lib/tournament/video-archive";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let query = $state("");
	let nation = $state("");
	let round = $state("");
	const open = new SvelteSet<string>();

	const rounds = $derived(
		[...new Set(data.archive.matches.map((a) => a.round_number))].sort(
			(a, b) => a - b,
		),
	);

	// A pending match with footage has no nation yet; it must not put an
	// "Unknown" option in the select that, chosen, silently clears the filter.
	const nations = $derived(
		[
			...new Set(
				data.archive.matches.flatMap((a) => [a.slot_a_nation, a.slot_b_nation]),
			),
		]
			.filter((n): n is string => n != null)
			.sort((a, b) => nationName(a).localeCompare(nationName(b))),
	);

	// A runtime the Worker could not price: on the keyed read that is a
	// broadcast still running; on the keyless feed it is every video, and
	// saying "live" about all of them would be false.
	const runtimeLabel = (seconds: number | null): string =>
		seconds !== null
			? formatRuntime(seconds)
			: data.archive.source === "api"
				? "live"
				: "";

	function haystack(a: ArchiveMatch): string {
		return [
			a.slot_a_display_name,
			a.slot_b_display_name,
			`match ${a.match_number}`,
			a.map_script,
			...[a.slot_a_nation, a.slot_b_nation].filter(Boolean).map(nationName),
			...a.parts.flatMap((p) =>
				p.angles.map((g) => `${g.channel} ${g.video.title}`),
			),
		]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();
	}

	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return data.archive.matches.filter(
			(a) =>
				(!round || String(a.round_number) === round) &&
				(!nation || a.slot_a_nation === nation || a.slot_b_nation === nation) &&
				(!q || haystack(a).includes(q)),
		);
	});

	const totalSeconds = (a: ArchiveMatch) =>
		a.parts.reduce((t, p) => t + p.seconds, 0);

	const filtering = $derived(
		query.trim() !== "" || nation !== "" || round !== "",
	);

	const totals = $derived({
		matches: shown.length,
		parts: shown.reduce((t, a) => t + a.parts.length, 0),
		videos: shown.reduce(
			(t, a) => t + a.parts.reduce((n, p) => n + p.angles.length, 0),
			0,
		),
		hours: shown.reduce((t, a) => t + totalSeconds(a), 0) / 3600,
	});

	// Narrowing to a handful of matches is a request to see inside them, so a
	// filtered list opens itself — but only while it stays small. Opening 87
	// matches at once mounts every part and every tile synchronously, which is
	// what the old page's "Show more" existed to avoid.
	const AUTO_OPEN_LIMIT = 8;

	// `open` is the one source of truth and always means open. Auto-opening
	// ADDS to it rather than overriding it, so a match the filter opened can be
	// closed again, and its button's aria-expanded is never a lie. An earlier
	// version flipped the set's sense while a filter was active, which made
	// typing one character collapse the one match you had opened; the version
	// after that OR'd the filter in at render time, which made the collapse
	// button a no-op on every auto-opened match.
	$effect(() => {
		if (filtering && shown.length <= AUTO_OPEN_LIMIT)
			for (const a of shown) open.add(a.match_id);
	});

	function toggle(id: string) {
		if (open.has(id)) open.delete(id);
		else open.add(id);
	}
</script>

{#snippet tile(
	video: ArchiveAngle["video"],
	channel: string,
	runtime: string,
	badge: ArchiveAngle["angle"],
)}
	<!-- `group` is what reveals the admin star on hover, as on VideoCard. -->
	<div
		class="group relative flex w-64 gap-2 rounded-lg p-2 transition-colors hover:bg-surface-raised-hover"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<!-- An external watch URL, not an app route, so resolve() doesn't apply;
		     rel guards tabnabbing and referrer leakage. Scoped to this one
		     element, as VideoCard scopes the same rule. Named by the video's
		     title, as VideoCard names its link: the tile shows only channel and
		     runtime, and two angles from one channel are otherwise the same link
		     to a screen reader. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			href={video.url}
			target="_blank"
			rel="noopener noreferrer"
			class="absolute inset-0 z-10 rounded-lg"
			aria-label={[video.title, channel, runtime].filter(Boolean).join(" — ")}
		></a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{#if video.thumbnail_url}
			<img
				src={video.thumbnail_url}
				alt=""
				loading="lazy"
				width="80"
				height="45"
				class="h-11 w-20 flex-none rounded object-cover"
				style="background-color: rgb(var(--color-surface-deep));"
			/>
		{:else}
			<!-- A feed entry can omit its thumbnail, and an empty src resolves to
			     the document URL in some browsers and refetches the page. -->
			<div
				class="h-11 w-20 flex-none rounded"
				style="background-color: rgb(var(--color-surface-deep));"
			></div>
		{/if}
		<span class="min-w-0 flex-1">
			<span
				class="block truncate text-xs font-semibold"
				style="color: rgb(var(--color-bright));"
			>
				{channel || "Unknown channel"}
				<span
					class="ml-1 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wider"
					class:text-orange={badge === "pov"}
					class:text-tan={badge === "cast"}
					style="background-color: rgb(var({badge === 'pov'
						? '--color-orange'
						: '--color-tan'}) / 0.15);"
				>
					{badge === "pov" ? "POV" : "cast"}
				</span>
			</span>
			{#if runtime}
				<span class="mt-0.5 block text-[11px] text-muted">{runtime}</span>
			{/if}
		</span>
		<FeaturedStar {video} />
	</div>
{/snippet}

{#if data.archive.matches.length === 0}
	<div
		class="rounded-lg p-4"
		style="background-color: rgb(var(--color-surface-sunken));"
	>
		<div class="py-8 text-center text-sm text-gray-400">
			{data.archive.source === "none"
				? "This tournament has no video playlist."
				: "No videos yet."}
		</div>
	</div>
{:else}
	{#if data.archive.source === "feed"}
		<!-- The keyless read: recent playlist entries only, none with a runtime,
		     dated by when the VOD went up. Say so, or "0 h" and undated parts
		     read as a broken archive. -->
		<p class="mb-3 text-xs text-muted">
			Showing the playlist's most recent entries. Runtimes and the full history
			need the server's YouTube API key.
		</p>
	{/if}
	<div
		class="mb-3 flex flex-wrap items-center gap-3 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface-sunken));"
	>
		<SearchInput
			bind:value={query}
			variant="dark"
			placeholder="Player, caster or video"
			class="w-64"
		/>
		<select
			bind:value={nation}
			aria-label="Filter by nation"
			class="rounded-lg border-2 border-surface bg-surface-raised px-3 py-2 text-sm text-tan"
		>
			<option value="">All nations</option>
			{#each nations as n (n)}
				<option value={n}>{nationName(n)}</option>
			{/each}
		</select>
		<select
			bind:value={round}
			aria-label="Filter by round"
			class="rounded-lg border-2 border-surface bg-surface-raised px-3 py-2 text-sm text-tan"
		>
			<option value="">All rounds</option>
			{#each rounds as r (r)}
				<option value={String(r)}>Round {r}</option>
			{/each}
		</select>
		<span class="ml-auto text-xs text-muted">
			{totals.matches} matches · {totals.parts} parts · {totals.videos} videos · {Math.round(
				totals.hours,
			)} h
		</span>
	</div>

	<div
		class="flex flex-col gap-2 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface-sunken));"
	>
		{#if shown.length === 0}
			<div class="py-8 text-center text-sm text-gray-400">
				No match fits that filter.
			</div>
		{/if}

		{#each shown as a (a.match_id)}
			{@const wonA =
				a.winner_slot_id != null && a.winner_slot_id === a.slot_a_id}
			{@const wonB =
				a.winner_slot_id != null && a.winner_slot_id === a.slot_b_id}
			{@const natA = a.slot_a_nation}
			{@const natB = a.slot_b_nation}
			{@const colorA = getCivilizationColor(natA ?? "")}
			{@const colorB = getCivilizationColor(natB ?? "")}
			<div
				class="overflow-hidden rounded-lg"
				style="background-color: rgb(var(--color-surface));"
			>
				<!-- The two nation colours as a hairline down the left edge: the match's
				     identity at a glance when scanning a long list. -->
				<div class="flex">
					<div class="flex w-1 flex-none flex-col">
						<div
							class="flex-1"
							style="background-color: {colorA ?? 'transparent'};"
						></div>
						<div
							class="flex-1"
							style="background-color: {colorB ?? 'transparent'};"
						></div>
					</div>
					<button
						type="button"
						onclick={() => toggle(a.match_id)}
						aria-expanded={open.has(a.match_id)}
						class="grid flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-surface-hover lg:grid-cols-[5rem_minmax(0,1fr)_auto]"
					>
						<span
							class="w-20 flex-none text-[11px] font-bold tracking-wider text-muted"
						>
							{#if a.match_number != null}
								MATCH {padMatchNumber(a.match_number)}
							{/if}
						</span>
						<span class="flex min-w-0 flex-wrap items-center gap-2">
							<span class="flex items-center gap-1.5">
								{#if natA}
									<SpriteIcon
										category="crests"
										value={natA}
										size={18}
										alt={nationName(natA)}
									/>
								{/if}
								<span
									class="font-semibold"
									class:text-success={wonA}
									style={wonA ? "" : "color: rgb(var(--color-bright));"}
								>
									{a.slot_a_display_name ?? "—"}
								</span>
							</span>
							<span class="text-xs text-muted">v</span>
							<span class="flex items-center gap-1.5">
								{#if natB}
									<SpriteIcon
										category="crests"
										value={natB}
										size={18}
										alt={nationName(natB)}
									/>
								{/if}
								<span
									class="font-semibold"
									class:text-success={wonB}
									style={wonB ? "" : "color: rgb(var(--color-bright));"}
								>
									{a.slot_b_display_name ?? "—"}
								</span>
							</span>
						</span>
						<span
							class="col-span-2 flex flex-wrap gap-x-3 text-xs text-muted lg:col-span-1 lg:justify-end"
						>
							{#if a.map_script}<span>{mapScriptLabel(a.map_script)}</span>{/if}
							{#if a.total_turns}<span
									><b class="text-tan">{a.total_turns}</b> turns</span
								>{/if}
							{#if totalSeconds(a) > 0}<span
									><b class="text-tan">{formatRuntime(totalSeconds(a))}</b> filmed</span
								>{/if}
							<span
								><b class="text-tan">{a.parts.length}</b> part{a.parts
									.length === 1
									? ""
									: "s"}</span
							>
							<span
								><b class="text-tan"
									>{a.parts.reduce((n, p) => n + p.angles.length, 0)}</b
								>
								video{a.parts.reduce((n, p) => n + p.angles.length, 0) === 1
									? ""
									: "s"}</span
							>
						</span>
					</button>
				</div>

				{#if open.has(a.match_id)}
					<div class="flex flex-col gap-2 px-4 pb-3">
						{#if a.parts.length === 0}
							<div
								class="rounded-lg border border-dashed border-border-subtle px-3 py-2 text-xs text-muted"
							>
								No footage of this match has surfaced.
							</div>
						{/if}
						{#each a.parts as p (p.n)}
							<div
								class="flex flex-wrap gap-3 rounded-lg p-3"
								style="background-color: rgb(var(--color-surface-sunken));"
							>
								<div class="w-24 flex-none">
									<div class="text-[11px] font-bold tracking-wider text-muted">
										PART {p.n}{#if p.angles.length > 1}<span
												class="text-orange"
											>
												·{p.angles.length}</span
											>{/if}
									</div>
									<div class="mt-0.5 text-xs text-muted">
										{formatShortDate(p.aired)}{#if p.seconds > 0}
											· {formatRuntime(p.seconds)}{/if}
									</div>
								</div>
								<div class="flex flex-1 flex-wrap gap-2">
									{#each p.angles as g (g.video.id)}
										{@render tile(
											g.video,
											g.channel,
											runtimeLabel(g.seconds),
											g.angle,
										)}
									{/each}
								</div>
							</div>
						{/each}

						{#if a.gaps > 0}
							<div
								class="rounded-lg border border-dashed border-border-subtle px-3 py-2 text-xs text-muted"
							>
								{a.gaps} scheduled part{a.gaps === 1 ? "" : "s"} with no surviving
								footage — the time above is a floor for this match.
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}

		{#if data.archive.unattributed.length > 0}
			<!-- The point of the server returning these rather than dropping them: a
		     video the matcher could not place is a hole in the archive, and a
		     silent hole is indistinguishable from a video that does not exist. -->
			<details
				class="mt-3 rounded-lg p-4"
				style="background-color: rgb(var(--color-surface-sunken));"
			>
				<summary class="cursor-pointer text-sm text-muted">
					{data.archive.unattributed.length} video{data.archive.unattributed
						.length === 1
						? ""
						: "s"} on the playlist we could not match to a game
				</summary>
				<p class="mt-2 max-w-prose text-xs text-muted">
					Usually a title that names a player by something other than their
					handle. Attaching the video to its match under Schedule fixes it for
					good.
				</p>
				<ul class="mt-3 flex flex-col gap-1">
					{#each data.archive.unattributed as v (v.id)}
						<li class="truncate text-xs">
							<!-- eslint-disable svelte/no-navigation-without-resolve -->
							<a href={v.url} target="_blank" rel="noopener noreferrer"
								>{v.title}</a
							>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	</div>
{/if}
