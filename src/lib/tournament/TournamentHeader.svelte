<script lang="ts">
	// The overview-only body of the tournament header: the meta strip (owner /
	// format / players / dates) and the per-status hero (setup CTA, sign-ups,
	// in-progress bar, champion cards). The shared header row above it — trail,
	// status badge, view toggle, signup, action cluster — now lives in the [slug]
	// layout; the overview page renders this component as its first content block.
	import type {
		CombinedQualifier,
		TournamentDetail,
		UserMe,
	} from "$lib/api-cloud";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import Progress from "$lib/ui/Progress.svelte";
	import SignupPopover from "./SignupPopover.svelte";
	import TransitionPopover from "./TransitionPopover.svelte";
	import type { HeaderHero, HeaderStatusMeta } from "./header-status";

	interface Props {
		tournament: TournamentDetail;
		statusMeta: HeaderStatusMeta;
		hero: HeaderHero;
		// Roster size for the meta strip; only shown once the tournament is
		// running or complete (setup/sign-ups surface their own count in the hero).
		playerCount: number;
		// Signed-in user, threaded through for the signup popover's confirmation
		// line (null for anonymous viewers — signup isn't offered then anyway).
		user: UserMe | null;
		// Combined qualifier ranking for the championship-transition preview;
		// null until the swiss phase produces a ranking.
		combined: CombinedQualifier[] | null;
		isAdmin: boolean;
		canSignUp: boolean;
		busy: boolean;
		startReady: boolean;
		transitionReady: boolean;
		onStart: () => void;
		// eslint-disable-next-line no-unused-vars -- callback signature
		onConfirmTransition: (overrideRanks?: string[]) => void;
	}

	let {
		tournament,
		statusMeta,
		hero,
		playerCount,
		user,
		combined,
		isAdmin,
		canSignUp,
		busy,
		startReady,
		transitionReady,
		onStart,
		onConfirmTransition,
	}: Props = $props();

	// Date-only display ("May 30"); the stored value is a full instant.
	function shortDate(iso: string | null): string | null {
		if (!iso) return null;
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return null;
		return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
	}

	const startsLabel = $derived(shortDate(tournament.starts_at));
	const endedLabel = $derived(shortDate(tournament.completed_at));

	// Meta strip text segments after the owner/admins block. Built in order;
	// each renders with a leading divider so the strip reads "owner │ format │
	// players │ description │ date" with separators only between present items.
	const metaSegments = $derived.by(() => {
		const out: { text: string; italic?: boolean }[] = [
			{ text: "Swiss → Championship" },
		];
		if (
			(statusMeta.key === "in-progress" || statusMeta.key === "complete") &&
			playerCount > 0
		) {
			out.push({
				text: `${playerCount} ${playerCount === 1 ? "player" : "players"}`,
			});
		}
		if (tournament.description)
			out.push({ text: tournament.description, italic: true });
		if (statusMeta.key === "complete") {
			if (endedLabel) out.push({ text: `Ended ${endedLabel}` });
		} else if (startsLabel) {
			out.push({ text: `Starts ${startsLabel}` });
		}
		return out;
	});
</script>

<header class="mb-3">
	<!-- Meta panel: owner/admins, format, players, date — grouped. First block of
	     the overview body; the shared header row (trail/toggle/actions) sits above
	     it in the [slug] layout. -->
	<div
		class="rounded-lg p-3"
		style="background-color: rgb(var(--color-surface));"
	>
		<div
			class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-tan opacity-80"
		>
			{#if tournament.owner}
				<span class="flex items-center gap-1">
					<img
						src={tournament.owner.avatar_url}
						alt=""
						class="h-4 w-4 rounded-full"
					/>
					<span
						><span class="opacity-70">Owner:</span>
						{tournament.owner.display_name}</span
					>
				</span>
				{#if tournament.admins.length > 0}
					<span class="opacity-40">│</span>
					<span>
						<span class="opacity-70"
							>{tournament.admins.length === 1 ? "Admin:" : "Admins:"}</span
						>
						{tournament.admins.map((a) => a.display_name).join(", ")}
					</span>
				{/if}
			{/if}
			{#each metaSegments as seg, i (seg.text)}
				{#if i > 0 || tournament.owner}
					<span class="opacity-40">│</span>
				{/if}
				<span class:italic={seg.italic}>{seg.text}</span>
			{/each}
		</div>
	</div>

	<!-- Hero strip: per-status content + primary CTA. -->
	<div
		class="mt-3 rounded-lg py-3 pl-3 pr-4"
		style="background-color: rgb(var(--color-surface));"
	>
		{#if hero.kind === "setup"}
			<div class="flex flex-wrap items-center gap-4">
				<span
					class="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full border border-white"
					aria-hidden="true"
				>
					<SpriteIcon category="icons" value="TOOL_SETTINGS" size={22} />
				</span>
				<div class="min-w-0 flex-1">
					<p class="text-xs uppercase tracking-wide text-tan opacity-50">
						Getting started
					</p>
					<p class="text-sm text-tan opacity-90">
						Set a name, format, and rules — then open sign-ups.
					</p>
				</div>
				{#if isAdmin}
					<button
						type="button"
						class="whitespace-nowrap rounded border border-tan px-3 py-1.5 text-xs text-tan disabled:opacity-50"
						onclick={onStart}
						disabled={busy || !startReady}
						title={startReady
							? ""
							: "Add at least one player to each division to start"}
					>
						Start tournament
					</button>
				{/if}
			</div>
		{:else if hero.kind === "signups"}
			<div class="flex flex-wrap items-center gap-4">
				<span
					class="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full border border-white"
					aria-hidden="true"
				>
					<SpriteIcon category="icons" value="PENDING_CRITICAL" size={22} />
				</span>
				<div class="min-w-0 flex-1">
					<p class="text-xs uppercase tracking-wide text-tan opacity-50">
						Sign-ups
					</p>
					<p class="text-sm text-tan">
						<span class="text-base font-bold">{hero.signedUp}</span>
						signed up
						<span class="opacity-60">
							· {hero.divisionAName}
							{hero.divisionACount} · {hero.divisionBName}
							{hero.divisionBCount}
						</span>
					</p>
				</div>
				{#if isAdmin}
					<button
						type="button"
						class="whitespace-nowrap rounded border border-tan px-3 py-1.5 text-xs text-tan disabled:opacity-50"
						onclick={onStart}
						disabled={busy || !startReady}
						title={startReady
							? ""
							: "Add at least one player to each division to start"}
					>
						Start tournament
					</button>
				{/if}
				{#if canSignUp && user}
					<SignupPopover {tournament} {user} {busy} />
				{/if}
			</div>
		{:else if hero.kind === "in-progress"}
			<div class="flex flex-wrap items-center gap-4">
				<span
					class="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full border border-white"
					aria-hidden="true"
				>
					<SpriteIcon category="icons" value="PENDING_CRITICAL" size={22} />
				</span>
				<div class="min-w-0 flex-shrink-0">
					<p class="text-xs uppercase tracking-wide text-tan opacity-50">
						Progress
					</p>
					<p class="whitespace-nowrap text-sm text-tan">
						<span class="opacity-70">{hero.phaseLabel} ·</span>
						<span class="font-bold">{hero.roundLabel}</span>
						<span class="opacity-70">of {hero.totalRounds}</span>
					</p>
				</div>
				<!-- Two-row grid with a shared auto-sized label column, so both bars
				     span exactly the same width regardless of label length. -->
				<div
					class="grid min-w-[16rem] flex-1 grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2"
				>
					<!-- Shared Swiss round labels, lit while some division is playing
					     that round. Beside them, matches played so far against the
					     projected eventual total ("~" while results in flight can
					     still swing it — see projected-totals.ts). -->
					<div class="flex gap-1">
						{#each Array.from({ length: hero.divisions[0]?.rounds.length ?? 0 }, (_, i) => i) as i (i)}
							<span
								class="flex-1 text-center text-[10px] uppercase tracking-wide {hero.divisions.some(
									(d) => d.rounds[i].current,
								)
									? 'font-bold text-orange'
									: 'text-tan opacity-50'}">Swiss {i + 1}</span
							>
						{/each}
					</div>
					<span
						class="justify-self-end whitespace-nowrap text-xs italic text-tan opacity-70"
					>
						{hero.playedOverall} of {hero.projectedExact
							? ""
							: "~"}{hero.projectedTotal} matches
					</span>
					<!-- One Swiss lane per division: a cell per round, the division's
					     open round as per-match pills (filled as reports land), played
					     rounds as solid fills, future rounds empty. The lanes merge
					     into the single championship bar below. -->
					{#each hero.divisions as d (d.label)}
						<div class="flex flex-col gap-0.5">
							<div class="flex items-center gap-1">
								{#each d.rounds as r, i (i)}
									{#if r.current}
										<div
											class="flex flex-1 gap-0.5"
											role="progressbar"
											aria-valuemin={0}
											aria-valuemax={r.total}
											aria-valuenow={r.done}
											aria-label="Matches reported — {d.label}"
										>
											{#each Array.from({ length: r.total }, (_, p) => p < r.done) as reported, p (p)}
												<span
													class="h-1.5 flex-1 rounded-full {reported
														? 'bg-orange'
														: 'bg-input'}"
												></span>
											{/each}
										</div>
									{:else}
										<div class="flex-1">
											<Progress
												value={r.done}
												max={Math.max(r.total, 1)}
												indicatorClass="bg-orange"
											/>
										</div>
									{/if}
								{/each}
							</div>
							<span
								class="truncate text-center text-[10px] uppercase tracking-wide text-tan opacity-50"
							>
								{d.label}
							</span>
						</div>
						<span
							class="justify-self-end whitespace-nowrap text-xs italic text-tan opacity-70"
						>
							{#if d.total > 0}{d.reported} of {d.total} reported{/if}
						</span>
					{/each}
					<!-- The merged championship bar — the divisions reunite in one
					     bracket. Pills once it's live; sized by the projected bracket
					     until then. -->
					<div class="flex flex-col gap-0.5">
						{#if hero.championship.active}
							<div
								class="flex gap-0.5"
								role="progressbar"
								aria-valuemin={0}
								aria-valuemax={hero.championship.total}
								aria-valuenow={hero.championship.reported}
								aria-label="Matches reported — Championship"
							>
								{#each Array.from({ length: hero.championship.total }, (_, p) => p < hero.championship.reported) as reported, p (p)}
									<span
										class="h-1.5 flex-1 rounded-full {reported
											? 'bg-orange'
											: 'bg-input'}"
									></span>
								{/each}
							</div>
						{:else}
							<Progress
								value={hero.championship.reported}
								max={Math.max(hero.championship.total, 1)}
								indicatorClass="bg-orange"
							/>
						{/if}
						<span
							class="text-center text-[10px] uppercase tracking-wide {hero
								.championship.active
								? 'font-bold text-orange'
								: 'text-tan opacity-50'}">Championship</span
						>
					</div>
					<span
						class="justify-self-end whitespace-nowrap text-xs italic text-tan opacity-70"
					>
						{#if hero.championship.active}
							{hero.championship.reported} of {hero.championship.total} reported
						{:else if hero.championship.total > 0}
							{hero.championship.exact ? "" : "~"}{hero.championship.total}
							matches · awaiting Swiss
						{/if}
					</span>
				</div>
				<div class="flex flex-shrink-0 items-center gap-3">
					{#if isAdmin && transitionReady && combined}
						<TransitionPopover
							{tournament}
							{combined}
							{busy}
							onConfirm={onConfirmTransition}
						/>
					{/if}
				</div>
			</div>
		{:else if hero.kind === "complete"}
			<!-- Two side-by-side cards spanning the full width: a wider champion
			     card (gold ring + trophy) and a narrower runner-up card (neutral
			     ring + GOAL_STARTED). Ranked by width and ring tint; our sprites
			     and colors throughout. -->
			<div class="flex flex-wrap items-stretch gap-3">
				<div
					class="flex min-w-[15rem] flex-[1.6] items-center gap-4 rounded-lg p-3"
					style="background-color: rgb(var(--color-surface-raised));"
				>
					<span
						class="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full border border-white"
						aria-hidden="true"
					>
						<SpriteIcon category="icons" value="ACHIEVEMENT" size={24} />
					</span>
					<div class="min-w-0">
						<p class="text-xs uppercase tracking-wide text-tan">Champion</p>
						{#if hero.champion}
							<p class="text-sm">
								<ProfileLink
									userId={hero.championUserId}
									slug={hero.championSlug}
									class="hover:underline"
								>
									<span class="font-bold text-orange">{hero.champion}</span>
								</ProfileLink>
							</p>
							{#if hero.finalSummary}
								<p class="text-xs text-tan">{hero.finalSummary}</p>
							{/if}
						{:else}
							<p class="text-sm text-tan opacity-70">Not recorded yet</p>
						{/if}
					</div>
				</div>
				{#if hero.champion && hero.finalist}
					<div
						class="flex min-w-[12rem] flex-1 items-center gap-4 rounded-lg p-3"
						style="background-color: rgb(var(--color-surface-raised));"
					>
						<span
							class="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full border border-white"
							aria-hidden="true"
						>
							<SpriteIcon category="icons" value="GOAL_STARTED" size={22} />
						</span>
						<div class="min-w-0">
							<p class="text-xs uppercase tracking-wide text-tan">Runner-up</p>
							<p class="text-sm">
								<ProfileLink
									userId={hero.finalistUserId}
									slug={hero.finalistSlug}
									class="hover:underline"
								>
									<span class="font-bold text-orange">{hero.finalist}</span>
								</ProfileLink>
							</p>
							{#if hero.fieldSize > 0}
								<p class="text-xs text-tan">
									Finished 2nd of {hero.fieldSize}
								</p>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</header>
