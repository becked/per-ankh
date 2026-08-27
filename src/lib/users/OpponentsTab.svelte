<script lang="ts">
	// Ten players the profile's owner should get a close game against.
	//
	// Owner-only, and the only tab that is: the others are facts about the
	// profile (it has channels, it holds a tournament slot), this one is about
	// the viewer. The gate is not really the tab bar though — the endpoint
	// behind it is /users/me/opponents, which has no by-id form, so there is no
	// URL that serves anyone else's list.
	//
	// The model that picks them runs entirely in the Worker and this component
	// is deliberately incapable of showing a rating: the payload carries none,
	// so there is no number here to leak into a tooltip, a title attribute or a
	// sort. Everything rendered is either identity or a fact the viewer could
	// have established by opening the profile themselves. The order is the
	// shuffled order the rebuild stored, which is why nothing here is numbered.
	import { resolve } from "$app/paths";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import CopyButton from "$lib/tournament/CopyButton.svelte";
	import type {
		OpponentBadge,
		RecommendedOpponent,
		RecommendedOpponents,
	} from "$lib/api-cloud";

	let {
		suggestions,
		openToMatches,
	}: {
		suggestions: RecommendedOpponents;
		// The owner's own listing preference. Surfaced here, not only in
		// Settings, because this is where the exchange becomes visible: they are
		// reading a list they are not on.
		openToMatches: boolean;
	} = $props();

	const opponents = $derived(suggestions.opponents);

	// Badge copy. Each one is checkable by hand — how many rated games they
	// have, when they last played, whether the two of you share an opponent —
	// which is the test every badge here has to pass.
	const BADGE_LABELS: Record<OpponentBadge, string> = {
		active_this_week: "Active this week",
		new_here: "New here",
		bridges_circles: "No mutual opponents",
	};

	// The card's badge row: the pair's history first, then the opponent's own
	// badges.
	//
	// Every history label names the pair, never the player. "Never played" under
	// a stranger's name reads as a fact about them — that they have never played
	// at all — which is both wrong and the opposite of a recommendation.
	// "First meeting" can only be about the two of you.
	//
	// It steps aside entirely for "No mutual opponents", which already implies
	// the two have never met (the graph distance behind it is at least three),
	// rather than saying the weaker half of the same thing twice.
	// The message to send them, ready to paste. The point of the whole card is
	// to get from "here is someone to play" to a game being arranged, and the
	// step that actually stalls is composing the opening line — so it is written
	// here, map and all, and the viewer only has to paste it.
	//
	// The setting is trimmed to its first two parts ("Duel · wide"): the full
	// string carries point-symmetry and mirror flags that the atlas link answers
	// better than a chat message can.
	function dmFor(o: RecommendedOpponent): string {
		if (!o.map) return "Fancy a game?";
		const setting = o.map.setting.split(" · ").slice(0, 2).join(" · ");
		return `Fancy a game? Per-Ankh suggests ${o.map.name} (${setting}) — ${o.map.url}`;
	}

	function labelsFor(o: RecommendedOpponent): string[] {
		const bridges = o.badges.includes("bridges_circles");
		const history =
			o.meetings === 0
				? bridges
					? null
					: "First meeting"
				: o.meetings === 1
					? "Played once"
					: o.meetings === 2
						? "Played twice"
						: `Played ${o.meetings} times`;
		return [
			...(history ? [history] : []),
			...o.badges.map((b) => BADGE_LABELS[b]),
		];
	}
</script>

{#snippet discordMark()}
	<svg
		class="h-4 w-4"
		viewBox="0 0 127.14 96.36"
		fill="currentColor"
		aria-hidden="true"
	>
		<path
			d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"
		/>
	</svg>
{/snippet}

<!-- The copy/copied pair, drawn the way every other copy affordance in the app
     draws it — same path, same 3.5 — so a reader who has used the one in the
     account settings or a match popover recognises this one. The glyphs are
     inline here because that is this repo's idiom for chrome icons; they are
     now the third copy, which is worth extracting, but not from inside a
     change about suggesting maps. -->
{#snippet copyMark()}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		class="h-3.5 w-3.5"
		fill="none"
		viewBox="0 0 24 24"
		stroke="currentColor"
		stroke-width="2"
		aria-hidden="true"
	>
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
		/>
	</svg>
{/snippet}

{#snippet checkMark()}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		class="h-3.5 w-3.5"
		fill="none"
		viewBox="0 0 24 24"
		stroke="currentColor"
		stroke-width="2"
		aria-hidden="true"
	>
		<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
	</svg>
{/snippet}

{#snippet opponentCard(o: RecommendedOpponent)}
	<div
		class="flex items-center gap-2 rounded-lg bg-surface p-3 transition-colors hover:bg-surface-hover"
	>
		<!-- Identity is one link to the profile, the way a tournament row card is
		     — a card whose name alone is clickable makes the reader hunt for it.
		     The Discord link is its sibling rather than a child, because an
		     anchor inside an anchor is not markup. -->
		<ProfileLink
			userId={o.user_id}
			slug={o.slug}
			class="flex min-w-0 flex-1 items-center gap-3"
			title="{o.display_name}'s profile"
		>
			<img
				src={o.avatar_url}
				alt=""
				width="40"
				height="40"
				class="h-10 w-10 shrink-0 rounded-full border-2 border-black"
			/>

			<div class="min-w-0 flex-1">
				<div class="truncate text-base font-bold text-white">
					{o.display_name}
				</div>

				<div class="mt-1 flex flex-wrap items-center gap-1.5">
					{#each labelsFor(o) as label (label)}
						<span
							class="rounded bg-amber-700/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-tan"
						>
							{label}
						</span>
					{/each}
				</div>

				{#if o.map}
					<div class="mt-1 truncate text-xs text-tan opacity-70">
						{o.map.name}
						<span class="opacity-70"
							>· {o.map.setting.split(" · ").slice(0, 2).join(" · ")}</span
						>
					</div>
				{/if}
			</div>
		</ProfileLink>

		<!-- Copy the opening message, map and link included. -->
		<CopyButton
			text={() => dmFor(o)}
			label="Copy a message to {o.display_name}"
			title="Copy a message to {o.display_name}"
			class="inline-flex shrink-0 items-center rounded border border-tan p-1.5 text-tan transition-colors hover:border-orange hover:text-orange"
		>
			{#snippet children(copied)}
				{#if copied}{@render checkMark()}{:else}{@render copyMark()}{/if}
			{/snippet}
		</CopyButton>

		<!-- Their Discord profile. The mark alone, no label: it lands on the
		     profile rather than in a DM — Discord publishes no compose URL, and
		     whether a stranger may message them at all stays their privacy
		     setting to make — so a button reading "DM" would promise something it
		     does not do. The tooltip and the aria-label say where it goes.
		     discord.com, not an app route, so resolve() doesn't apply; rel guards
		     tabnabbing + referrer leakage (same shape as VideoCard's). -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			href={o.discord_url}
			target="_blank"
			rel="noopener noreferrer"
			class="inline-flex shrink-0 items-center rounded border border-tan p-1.5 text-tan transition-colors hover:border-orange hover:text-orange"
			title="{o.display_name} on Discord"
			aria-label="{o.display_name} on Discord"
		>
			{@render discordMark()}
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>
{/snippet}

{#if !openToMatches}
	<p class="mb-3 text-sm text-tan opacity-70">
		You're hidden from other players' lists —
		<a
			href={resolve("/account")}
			class="text-orange transition-colors hover:text-tan">Settings</a
		> to be listed too.
	</p>
{/if}

{#if opponents.length > 0}
	<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
		{#each opponents as o (o.user_id)}
			{@render opponentCard(o)}
		{/each}
	</div>
{:else if !suggestions.rated}
	<p class="p-8 text-center text-sm text-tan opacity-60">
		Suggestions come from your multiplayer games.
		<a
			href={resolve("/upload")}
			class="text-orange transition-colors hover:text-tan">Upload a save</a
		> of one you've played and you'll have a list.
	</p>
{:else}
	<p class="p-8 text-center text-sm text-tan opacity-60">
		Nothing to suggest right now — everyone close enough to give you a good game
		is either already busy or away.
	</p>
{/if}
