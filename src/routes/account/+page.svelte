<script lang="ts">
	import { Tabs } from "bits-ui";
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { ApiError, cloudApi, type GameListItem } from "$lib/api-cloud";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import BulkReparseModal from "$lib/BulkReparseModal.svelte";
	import ChannelSettings from "$lib/settings/ChannelSettings.svelte";
	import CopyButton from "$lib/tournament/CopyButton.svelte";
	import { PUBLIC_ORIGIN } from "$lib/page-meta";
	import { PARSER_VERSION } from "$lib/parser/types";
	import { formatGameTitle } from "$lib/utils/formatting";
	import { isNewer } from "$lib/utils/semver";
	import { ensureUrlScheme } from "$lib/utils/url";
	import { toast } from "$lib/ui/toast";
	import { profileHref } from "$lib/utils/profile-href";
	import type { Snippet } from "svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let activeTab = $state("account");
	let loggingOut = $state(false);
	// Games handed to the reparse modal. null = closed. The bulk button sets
	// the whole out-of-date set; a per-save Reparse button sets `[oneGame]`.
	// BulkReparseModal is generic over the list, so a single-element array
	// reuses the same download → parse → upload pipeline.
	let reparseGames = $state<GameListItem[] | null>(null);

	// The reader's own Opponents tab, so "their Opponents tab" below links to
	// the thing it names. profileHref decides slug-vs-permalink; the tab is a
	// search param on whichever it picks.
	const opponentsHref = $derived(
		`${profileHref({ user_id: data.user.user_id, slug: data.user.slug })}?tab=opponents`,
	);

	// The boolean preferences — optimistic toggles backed by the worker,
	// mirroring the lock toggle in GameActions: flip immediately, revert on
	// failure. Initialised at construction from the server value; nothing
	// re-fetches /me on this page, so no re-sync effect is needed.
	// svelte-ignore state_referenced_locally
	let defaultPublic = $state(data.user.default_game_public);
	// svelte-ignore state_referenced_locally
	let openToMatches = $state(data.user.open_to_matches);
	// Which write is in flight, so both switches disable together while one
	// saves — the endpoint is a single partial update over the same row.
	let savingPref = $state<"default_game_public" | "open_to_matches" | null>(
		null,
	);

	// Casting stream link — plain save-on-submit (not optimistic: the worker
	// validates the host allowlist, so the persisted value is what it echoes
	// back, not what was typed).
	// svelte-ignore state_referenced_locally
	let streamUrl = $state(data.user.stream_url ?? "");
	let savingStream = $state(false);

	// Profile URL. Same save-on-submit shape as the stream link. Most accounts
	// arrive here already holding one, derived from their display name at
	// signup, so the card's job is the correction — renaming a derived name, or
	// claiming one when derivation produced nothing — plus releasing it. The
	// worker trims + lowercases before validating and returns what it stored, so
	// we echo its value.
	// svelte-ignore state_referenced_locally
	let slug = $state(data.user.slug);
	let slugInput = $state("");
	let claiming = $state(false);
	let releasing = $state(false);
	// Whether the form is showing. Open by default only when there's no slug to
	// show — a user who has one sees the link, and asks for the form.
	// svelte-ignore state_referenced_locally
	let editing = $state(data.user.slug === null);

	// The static label beside the input, so what they type reads as the tail of
	// the URL it becomes.
	const SLUG_PREFIX = "per-ankh.app/u/";
	// What the user shares — absolute, since the point of the card is a link
	// that can be pasted into Discord.
	const profileUrl = $derived(slug ? `${PUBLIC_ORIGIN}/u/${slug}` : "");

	// Already filtered to out-of-date games server-side (see +page.ts), so the
	// count and modal list cover the user's entire library, not just a page.
	const outOfDateGames = $derived(data.outOfDateGames);
	// The full library (capped at 500) for the per-save reparse rows.
	const allGames = $derived(data.allGames);

	const gameTitle = (g: GameListItem): string =>
		formatGameTitle({
			display_name: g.display_name,
			game_name: g.game_name,
			save_owner_nation: g.user_nation,
			total_turns: g.total_turns,
			match_id: 0,
		});

	// A save is behind when the current parser is newer than the one it was
	// last parsed with — same check that drives the bulk set and the
	// detail-page reparse banner.
	const isOutdated = (g: GameListItem): boolean =>
		isNewer(PARSER_VERSION, g.parser_version);

	// Subtab triggers styled as chip-bar pills, matching the game-detail and
	// aggregate-stats tab bars.
	const triggerClass =
		"cursor-pointer rounded px-3 py-1.5 text-sm font-bold text-tan transition-colors hover:bg-tan-hover data-[state=active]:bg-surface-raised data-[state=inactive]:bg-surface";

	async function handleLogout() {
		loggingOut = true;
		try {
			await cloudApi.logout();
		} catch (err) {
			// Network failure shouldn't strand the user on /account.
			// Navigate away regardless — worst case the cookie is still
			// valid server-side and the next page load shows them signed in.
			console.warn("Logout request failed:", err);
		}
		await goto(resolve("/"), { replaceState: true });
	}

	// Both switches are the same write with a different field name, so they are
	// the same function — a second hand-rolled copy is where the revert and the
	// error toast drift apart.
	async function toggleBooleanPref(
		field: "default_game_public" | "open_to_matches",
		next: boolean,
		// eslint-disable-next-line no-unused-vars -- documentary param name
		set: (value: boolean) => void,
	) {
		if (savingPref) return;
		set(next);
		savingPref = field;
		try {
			await cloudApi.updateSettings({ [field]: next });
		} catch (err) {
			set(!next);
			toast.error(
				`Settings update failed: ${err instanceof Error ? err.message : err}`,
			);
		} finally {
			savingPref = null;
		}
	}

	async function saveStreamUrl() {
		if (savingStream) return;
		// A bare domain ("youtube.com/@you/live") is the natural thing to paste;
		// the worker requires a scheme, so add one instead of bouncing on a 400.
		// Empty → null, which clears the stored link.
		const next = ensureUrlScheme(streamUrl);
		savingStream = true;
		try {
			const saved = await cloudApi.updateSettings({ stream_url: next });
			streamUrl = saved.stream_url ?? "";
			toast.info(
				saved.stream_url ? "Stream link saved" : "Stream link cleared",
			);
		} catch (err) {
			toast.error(
				`Settings update failed: ${err instanceof Error ? err.message : err}`,
			);
		} finally {
			savingStream = false;
		}
	}

	async function saveSlug() {
		const wanted = slugInput.trim();
		if (claiming || !wanted) return;
		claiming = true;
		let changed = false;
		try {
			const saved = await cloudApi.setSlug(wanted);
			const renamed = slug !== null;
			slug = saved.slug;
			slugInput = "";
			editing = false;
			changed = true;
			toast.info(renamed ? "Profile URL updated" : "Profile URL claimed");
		} catch (err) {
			// The worker's rejections — bad format, reserved name, already taken,
			// still inside the cooldown — carry user-safe messages; show them
			// verbatim rather than restating the rule in a second place.
			toast.error(
				err instanceof ApiError
					? err.message
					: `Couldn't save that profile URL: ${err instanceof Error ? err.message : err}`,
			);
		} finally {
			claiming = false;
		}
		// The header avatar is the only way into your own profile, and it links
		// through the LAYOUT's copy of the user — which this write just made
		// wrong. A rename leaves it pointing at a /u/<slug> that now 404s, or at
		// whoever claims the freed name next; local `slug` state above fixes this
		// card only. Refreshing outside the try is deliberate: a failed reload is
		// not a failed save, and must not be reported as one.
		if (changed) await invalidateAll();
	}

	async function releaseSlug() {
		if (releasing) return;
		releasing = true;
		let changed = false;
		try {
			await cloudApi.releaseSlug();
			slug = null;
			slugInput = "";
			// Straight into the form: releasing is usually the long way round to
			// a different name, and the alternative is a card with one button.
			editing = true;
			changed = true;
			toast.info("Profile URL removed — your profile is at its permalink");
		} catch (err) {
			toast.error(
				err instanceof ApiError
					? err.message
					: `Couldn't remove that profile URL: ${err instanceof Error ? err.message : err}`,
			);
		} finally {
			releasing = false;
		}
		// Same reason as saveSlug: the header still holds the released name until
		// the layout reloads, and that name is claimable by someone else now.
		if (changed) await invalidateAll();
	}

	async function onReparseClose(didReparse: boolean) {
		reparseGames = null;
		if (didReparse) await invalidateAll();
	}
</script>

<!-- One preference row: title, explanation, switch. Both preferences render
     through it so the pair can't drift into two slightly different switches
     the way two copies of the markup would. -->
{#snippet preference(
	field: "default_game_public" | "open_to_matches",
	title: string,
	checked: boolean,
	// eslint-disable-next-line no-unused-vars -- documentary param name
	set: (value: boolean) => void,
	copy: Snippet,
)}
	<div
		class="rounded-lg p-3"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<div class="flex items-center justify-between gap-4">
			<div class="min-w-0">
				<div class="text-sm font-bold text-tan">{title}</div>
				<p class="mt-1 text-xs text-gray-400">{@render copy()}</p>
			</div>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				aria-label={title}
				onclick={() => toggleBooleanPref(field, !checked, set)}
				disabled={savingPref !== null}
				class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 {checked
					? 'bg-orange'
					: 'bg-input'}"
			>
				<span
					class="inline-block h-3.5 w-3.5 transform rounded-full bg-tan transition-transform {checked
						? 'translate-x-[18px]'
						: 'translate-x-1'}"
				></span>
			</button>
		</div>
	</div>
{/snippet}

{#snippet uploadVisibilityCopy()}
	Newly uploaded saves are visible to anyone with the link. Turn this off to
	keep new uploads private until you share them. You can change any game's
	visibility individually at any time.
{/snippet}

{#snippet openToMatchesCopy()}
	Other players looking for a game may see you suggested as an opponent on their
	<!-- profileHref returns a resolve() result, and the tab is a search param on
	     it; the rule can't see through the call. -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a href={opponentsHref} class="text-orange transition-colors hover:text-tan"
		>Opponents</a
	> tab. Turn this off to be left out of everyone's suggestions — you'll still get
	your own.
{/snippet}

<main class="cloud-scroll flex-1 overflow-y-auto px-4 py-8" use:autohideScroll>
	<div class="mx-auto max-w-xl">
		<Tabs.Root bind:value={activeTab}>
			<Tabs.List
				class="mx-auto mb-4 flex w-fit flex-wrap items-center gap-1 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg"
			>
				<Tabs.Trigger value="account" class={triggerClass}>Account</Tabs.Trigger
				>
				<Tabs.Trigger value="preferences" class={triggerClass}>
					Preferences
				</Tabs.Trigger>
				<Tabs.Trigger value="video" class={triggerClass}>Video</Tabs.Trigger>
				<Tabs.Trigger value="maintenance" class={triggerClass}>
					Maintenance
				</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="account">
				<div
					class="rounded-lg p-4"
					style="background-color: rgb(var(--color-surface));"
				>
					<div
						class="rounded-lg p-3"
						style="background-color: rgb(var(--color-surface-raised));"
					>
						<!-- Header: avatar + display name -->
						<div class="mb-3 flex items-center gap-3">
							<img
								src={data.user.avatar_url}
								alt=""
								class="h-6 w-6 rounded-full"
								width="24"
								height="24"
							/>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="text-lg font-bold text-tan">
										{data.user.display_name}
									</span>
									<span class="text-sm text-gray-400">(Discord)</span>
								</div>
							</div>
						</div>

						<!-- Stats grid -->
						<div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
							<span class="font-bold text-gray-400">Discord ID</span>
							<span class="font-mono font-medium text-bright"
								>{data.user.discord_id}</span
							>
						</div>
					</div>

					<!-- Profile URL: the link to share, derived from the display name
					     at signup and the user's to rename or remove. The link and
					     the form are independent — a slug-holder can open the form
					     and close it again — so the two blocks stack rather than
					     alternating on whether a slug exists. The rules (format,
					     cooldown, name reuse) aren't restated here; the worker's
					     rejections carry them. -->
					<div
						class="mt-3 rounded-lg p-3"
						style="background-color: rgb(var(--color-surface-raised));"
					>
						<div class="text-sm font-bold text-tan">Profile URL</div>
						{#if slug}
							<div class="mt-2 flex items-center gap-2">
								<span class="min-w-0 truncate font-mono text-sm text-bright"
									>{profileUrl}</span
								>
								<CopyButton
									text={profileUrl}
									label="Copy profile URL"
									title="Copy your profile URL"
									class="inline-flex shrink-0 items-center justify-center rounded border border-surface p-1 text-tan transition-colors hover:bg-surface-hover hover:text-orange"
								>
									{#snippet children(copied)}
										{#if copied}{@render iconCheck()}{:else}{@render iconCopy()}{/if}
									{/snippet}
								</CopyButton>
							</div>
							<!-- Actions sit on their own row so a long handle keeps the
							     full width of the line above. -->
							<div class="mt-2 flex items-center justify-end gap-2">
								<button
									type="button"
									onclick={() => (editing = !editing)}
									class="cursor-pointer rounded border border-input px-3 py-1.5 text-sm text-tan transition-colors hover:border-orange hover:text-orange"
								>
									{editing ? "Cancel" : "Change"}
								</button>
								<button
									type="button"
									onclick={releaseSlug}
									disabled={releasing}
									class="cursor-pointer rounded border border-input px-3 py-1.5 text-sm text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
								>
									{releasing ? "Removing…" : "Remove"}
								</button>
							</div>
						{/if}
						{#if editing}
							<form
								class="mt-2 flex items-center gap-2"
								onsubmit={(e) => {
									e.preventDefault();
									saveSlug();
								}}
							>
								<span class="shrink-0 font-mono text-sm text-gray-400"
									>{SLUG_PREFIX}</span
								>
								<input
									type="text"
									class="min-w-0 flex-1 rounded border border-input bg-surface-sunken px-2 py-1.5 text-sm text-tan focus:border-orange focus:outline-none"
									aria-label="Profile URL"
									bind:value={slugInput}
									disabled={claiming}
								/>
								<button
									type="submit"
									class="shrink-0 rounded border border-input px-3 py-1.5 text-sm text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
									disabled={claiming || slugInput.trim() === ""}
								>
									Save
								</button>
							</form>
						{/if}
					</div>

					<div class="mt-3">
						<button
							type="button"
							onclick={handleLogout}
							disabled={loggingOut}
							class="cursor-pointer rounded bg-surface-raised px-3 py-1 text-sm text-tan transition-colors hover:bg-surface-raised-hover disabled:opacity-50"
						>
							{loggingOut ? "Logging out…" : "Log out"}
						</button>
					</div>
				</div>
			</Tabs.Content>

			<Tabs.Content value="preferences">
				<div
					class="space-y-3 rounded-lg p-4"
					style="background-color: rgb(var(--color-surface));"
				>
					{@render preference(
						"default_game_public",
						"New uploads are public by default",
						defaultPublic,
						(v) => (defaultPublic = v),
						uploadVisibilityCopy,
					)}
					{@render preference(
						"open_to_matches",
						"Open to match suggestions",
						openToMatches,
						(v) => (openToMatches = v),
						openToMatchesCopy,
					)}
				</div>
			</Tabs.Content>

			<Tabs.Content value="video">
				<div class="space-y-3">
					<div
						class="rounded-lg p-4"
						style="background-color: rgb(var(--color-surface));"
					>
						<div
							class="rounded-lg p-3"
							style="background-color: rgb(var(--color-surface-raised));"
						>
							<div class="text-sm font-bold text-tan">Casting stream link</div>
							<p class="mt-1 text-xs text-gray-400">
								YouTube or Twitch stream link added to matches when you are a
								caster.
							</p>
							<form
								class="mt-2 flex items-center gap-2"
								onsubmit={(e) => {
									e.preventDefault();
									saveStreamUrl();
								}}
							>
								<input
									type="text"
									class="min-w-0 flex-1 rounded border border-input bg-surface-sunken px-2 py-1.5 text-sm text-tan focus:border-orange focus:outline-none"
									aria-label="Casting stream link"
									bind:value={streamUrl}
									disabled={savingStream}
								/>
								<button
									type="submit"
									class="rounded border border-input px-3 py-1.5 text-sm text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
									disabled={savingStream}
								>
									Save
								</button>
							</form>
						</div>
					</div>
					<ChannelSettings initialChannels={data.channels} />
				</div>
			</Tabs.Content>

			<Tabs.Content value="maintenance">
				<div
					class="rounded-lg p-4"
					style="background-color: rgb(var(--color-surface));"
				>
					<div
						class="rounded-lg p-3"
						style="background-color: rgb(var(--color-surface-raised));"
					>
						<!-- Reparse outdated games. Always rendered so the button is
						     discoverable; disabled when nothing is out of date. -->
						<div class="mb-2 text-xs text-tan">
							{#if outOfDateGames.length === 0}
								All games are on the current parser version.
							{:else}
								{outOfDateGames.length}
								{outOfDateGames.length === 1 ? "game" : "games"} on an older parser
								version.
							{/if}
						</div>
						<button
							type="button"
							onclick={() => (reparseGames = outOfDateGames)}
							disabled={outOfDateGames.length === 0}
							class="cursor-pointer rounded bg-[#ab9978] px-3 py-1 text-sm font-bold text-black transition-colors hover:bg-[#9a8a6c] disabled:cursor-not-allowed disabled:opacity-50"
						>
							{outOfDateGames.length === 0
								? "All games up to date"
								: `Reparse ${outOfDateGames.length} ${outOfDateGames.length === 1 ? "game" : "games"}`}
						</button>
					</div>

					<!-- Per-save reparse. Lists the whole library so a single save
					     can be force-reparsed even when it's already current (the
					     bulk button only touches out-of-date games). -->
					<div
						class="mt-3 rounded-lg p-3"
						style="background-color: rgb(var(--color-surface-raised));"
					>
						<div class="mb-2 text-sm font-bold text-tan">
							Reparse a single save
						</div>
						{#if allGames.length === 0}
							<div class="text-xs text-gray-400">No saves yet.</div>
						{:else}
							<ul class="max-h-96 space-y-1 overflow-y-auto pr-1">
								{#each allGames as game (game.game_id)}
									<li
										class="flex items-center gap-2 rounded bg-surface-sunken px-2 py-1.5 text-xs"
									>
										<span
											class="flex-1 truncate text-tan"
											title={gameTitle(game)}
										>
											{gameTitle(game)}
										</span>
										{#if isOutdated(game)}
											<span
												class="shrink-0 rounded bg-orange/20 px-1.5 py-0.5 text-[10px] font-bold text-orange"
											>
												outdated
											</span>
										{:else}
											<span class="shrink-0 text-[10px] text-gray-400">
												v{game.parser_version}
											</span>
										{/if}
										<button
											type="button"
											onclick={() => (reparseGames = [game])}
											class="shrink-0 cursor-pointer rounded bg-orange px-2 py-1 text-[11px] font-bold text-white transition-colors hover:bg-orange/80"
										>
											Reparse
										</button>
									</li>
								{/each}
							</ul>
							{#if data.totalGames > allGames.length}
								<div class="mt-2 text-[11px] text-gray-400">
									Showing the {allGames.length} most recent of {data.totalGames} saves.
								</div>
							{/if}
						{/if}
					</div>
				</div>
			</Tabs.Content>
		</Tabs.Root>
	</div>
</main>

{#if reparseGames}
	<BulkReparseModal games={reparseGames} onClose={onReparseClose} />
{/if}

<!-- Copy-button icons, same pair MatchPopover renders inside CopyButton. -->
{#snippet iconCopy()}
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
{#snippet iconCheck()}
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
