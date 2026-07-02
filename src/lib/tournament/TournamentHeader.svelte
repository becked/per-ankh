<script lang="ts">
	import Breadcrumb, { type Crumb } from "$lib/Breadcrumb.svelte";
	import type {
		CombinedQualifier,
		TournamentDetail,
		UserMe,
	} from "$lib/api-cloud";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import Progress from "$lib/ui/Progress.svelte";
	import SettingsPopover from "./SettingsPopover.svelte";
	import SignedUpPopover from "./SignedUpPopover.svelte";
	import TournamentLinksMenu from "./TournamentLinksMenu.svelte";
	import SignupPopover from "./SignupPopover.svelte";
	import TransitionPopover from "./TransitionPopover.svelte";
	import type { HeaderHero, HeaderStatusMeta } from "./header-status";

	interface Props {
		crumbs: Crumb[];
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
		hasViewerSlot: boolean;
		busy: boolean;
		startReady: boolean;
		transitionReady: boolean;
		// Settings is disabled while a match popover is open (shallow-routing guard).
		settingsDisabled: boolean;
		onGuide: () => void;
		onStart: () => void;
		onWithdraw: () => void;
		// eslint-disable-next-line no-unused-vars -- callback signature
		onConfirmTransition: (overrideRanks?: string[]) => void;
	}

	let {
		crumbs,
		tournament,
		statusMeta,
		hero,
		playerCount,
		user,
		combined,
		isAdmin,
		canSignUp,
		hasViewerSlot,
		busy,
		startReady,
		transitionReady,
		settingsDisabled,
		onGuide,
		onStart,
		onWithdraw,
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

	const showSettings = $derived(isAdmin || tournament.status !== "setup");
</script>

<header class="mb-6">
	<!-- Nav trail with the status badge to its right; actions on the far right.
	     The tournament name already lives in the trail, so no separate title. -->
	<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
		<div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
			<Breadcrumb {crumbs} class="min-w-0" />
			<span
				class="whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide {statusMeta.chipClass}"
			>
				{statusMeta.label}
			</span>
		</div>

		<div class="flex flex-shrink-0 items-center gap-2">
			{#if hasViewerSlot}
				<SignedUpPopover {tournament} {busy} {onWithdraw} />
			{/if}
			<TournamentLinksMenu {tournament} {onGuide} />
			{#if showSettings}
				<SettingsPopover {tournament} disabled={settingsDisabled} />
			{/if}
		</div>
	</div>

	<!-- Meta panel: owner/admins, format, players, date — grouped. -->
	<div
		class="mt-3 rounded-lg p-3"
		style="background-color: rgb(var(--color-surface));"
	>
		<div
			class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-tan opacity-80"
		>
			{#if tournament.owner}
				<span class="flex items-center gap-1.5">
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
						<span class="font-bold">Round {hero.round}</span>
						<span class="opacity-70">of {hero.totalRounds}</span>
					</p>
				</div>
				<div class="min-w-[8rem] flex-1">
					<Progress value={hero.overall} max={1} indicatorClass="bg-orange" />
				</div>
				<div class="flex flex-shrink-0 items-center gap-3">
					<span class="whitespace-nowrap text-xs italic text-tan opacity-70">
						{hero.reported} of {hero.total} matches reported
					</span>
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
								<span class="font-bold text-orange">{hero.champion}</span>
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
								<span class="font-bold text-orange">{hero.finalist}</span>
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
