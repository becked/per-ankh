<script lang="ts">
	// One challenge: the map's setup, the rules, the leaderboard, and the two
	// things a runner does here — download the map, submit a run. The creator
	// (or a site admin) also edits and deletes from here.
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import {
		ApiError,
		cloudApi,
		UnauthorizedError,
		type PatchChallengeBody,
	} from "$lib/api-cloud";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import Breadcrumb from "$lib/Breadcrumb.svelte";
	import { describeSetup } from "$lib/challenges/describe";
	import RulesEditor from "$lib/challenges/RulesEditor.svelte";
	import RulesList from "$lib/challenges/RulesList.svelte";
	import type { Criterion, Objective } from "$lib/challenges/types";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import StatTile from "$lib/StatTile.svelte";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import { confirmDialog } from "$lib/ui/confirm";
	import { INPUT_CLASS, PRIMARY_BTN, SECONDARY_BTN } from "$lib/ui/classes";
	import Panel from "$lib/ui/Panel.svelte";
	import { toast } from "$lib/ui/toast";
	import { saveBlobAs } from "$lib/utils/download";
	import { formatRelativeToNow } from "$lib/utils/formatting";
	import { loginBounce } from "$lib/utils/safe-next";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const challenge = $derived(data.challenge);
	const isOpen = $derived(challenge.status === "open");
	const canManage = $derived(data.viewer?.can_manage ?? false);
	// The Worker refuses a creator's delete once runs are on the board
	// (CHALLENGE_HAS_RUNS); only an admin can remove those.
	const canDelete = $derived(
		canManage &&
			(challenge.submission_count === 0 || (data.user?.is_admin ?? false)),
	);
	const setupLine = $derived(describeSetup(challenge.setup).join(" · "));

	const crumbs = $derived([
		{ label: "Home", href: resolve("/") },
		{ label: "Challenges", href: resolve("/challenges") },
		{ label: `#${challenge.number} ${challenge.title}` },
	]);

	const submitHref = $derived(
		`${resolve("/upload")}?challenge_id=${encodeURIComponent(challenge.challenge_id)}&return_number=${challenge.number}`,
	);

	const loginHref = $derived(loginBounce(page.url));

	let downloading = $state(false);
	async function download() {
		downloading = true;
		try {
			const { blob, filename } = await cloudApi.downloadChallengeMap(
				challenge.number,
			);
			saveBlobAs(blob, filename);
		} catch (err) {
			if (err instanceof UnauthorizedError) {
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic next-query construction; resolve()'s branded types don't admit dynamic search strings
				await goto(loginHref);
			} else if (err instanceof ApiError && err.status === 429) {
				toast.error("Download limit reached — try again in a few minutes.");
			} else {
				toast.error(err instanceof Error ? err.message : "Download failed");
			}
		} finally {
			downloading = false;
		}
	}

	// --- Creator controls -------------------------------------------------

	let editing = $state(false);
	let title = $state("");
	let description = $state("");
	let durationDays = $state(1);
	let objectives = $state<Objective[]>([]);
	let criteria = $state<Criterion[]>([]);
	let saving = $state(false);

	// Rules lock once a run is in — the leaderboard would otherwise rank runs
	// scored against different rules (the Worker refuses the PATCH too).
	const rulesEditable = $derived(challenge.submission_count === 0);

	function daysBetween(fromIso: string, toIso: string): number {
		const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
		return Math.max(1, Math.round(ms / 86_400_000));
	}

	function startEditing() {
		title = challenge.title;
		description = challenge.description ?? "";
		durationDays = daysBetween(challenge.created_at, challenge.closes_at);
		// Snapshots: the editor mutates its rows, and the loader data has to
		// survive a cancel untouched.
		objectives = $state.snapshot(challenge.objectives);
		criteria = $state.snapshot(challenge.criteria);
		editing = true;
	}

	async function save() {
		const body: PatchChallengeBody = {
			title: title.trim(),
			description: description.trim(),
		};
		// Only a changed duration is sent: the Worker refuses one on a closed
		// challenge, and a title edit must not move closes_at.
		if (durationDays !== daysBetween(challenge.created_at, challenge.closes_at))
			body.duration_days = durationDays;
		if (rulesEditable) {
			body.objectives = $state.snapshot(objectives);
			body.criteria = $state.snapshot(criteria);
		}
		if (!body.title || (rulesEditable && objectives.length === 0)) {
			toast.error("A title and at least one objective are required.");
			return;
		}
		saving = true;
		try {
			await cloudApi.patchChallenge(challenge.number, body);
			await invalidateAll();
			editing = false;
			toast.info("Saved");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Save failed");
		} finally {
			saving = false;
		}
	}

	let removing = $state(false);
	async function remove() {
		if (removing) return;
		const ok = await confirmDialog({
			title: `Delete challenge #${challenge.number}?`,
			message:
				challenge.submission_count > 0
					? `${challenge.submission_count} run${challenge.submission_count === 1 ? "" : "s"} will lose their challenge link. The games themselves stay.`
					: "The map and its rules will be removed.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) return;
		removing = true;
		try {
			await cloudApi.deleteChallenge(challenge.number);
			await goto(resolve("/challenges"));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Delete failed");
		} finally {
			removing = false;
		}
	}
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-screen-2xl">
				<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
					<div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
						<Breadcrumb {crumbs} class="min-w-0" />
						<span
							class="whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide {isOpen
								? 'bg-amber-700/40 text-orange'
								: 'bg-surface-raised text-tan opacity-60'}"
						>
							{isOpen ? "Open" : "Closed"}
						</span>
					</div>
					<div class="flex items-center gap-2">
						{#if canManage}
							<button
								type="button"
								class={SECONDARY_BTN}
								onclick={startEditing}
							>
								Edit
							</button>
						{/if}
						{#if canDelete}
							<button
								type="button"
								class="whitespace-nowrap rounded border border-red-400 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-400 hover:text-black disabled:opacity-50"
								disabled={removing}
								onclick={remove}
							>
								Delete
							</button>
						{/if}
						<!-- Both hrefs carry a dynamic query string resolve()'s
						     branded types can't express: the upload link is built from
						     resolve("/upload"), the other is the login bounce. -->
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						{#if data.user}
							<button
								type="button"
								class={PRIMARY_BTN}
								disabled={downloading}
								onclick={download}
							>
								{downloading ? "Downloading…" : "Download map"}
							</button>
							{#if isOpen}
								<a href={submitHref} class={PRIMARY_BTN}>Submit run</a>
							{/if}
						{:else}
							<a href={loginHref} class={PRIMARY_BTN}>
								{isOpen ? "Sign in to play" : "Sign in to download"}
							</a>
						{/if}
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</div>
				</div>

				<div
					class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-400"
				>
					<span class="inline-flex items-center gap-1.5">
						<PlayerAvatar avatarUrl={challenge.creator.avatar_url} size={16} />
						<ProfileLink
							userId={challenge.creator.user_id}
							slug={challenge.creator.slug}
							class="hover:underline"
						>
							<span class="font-bold text-tan"
								>{challenge.creator.display_name}</span
							>
						</ProfileLink>
					</span>
					<span>·</span>
					<span>{setupLine}</span>
					<span>·</span>
					<span>
						{isOpen ? "closes" : "closed"}
						{formatRelativeToNow(challenge.closes_at)}
					</span>
				</div>

				{#if challenge.description}
					<p class="mb-4 max-w-3xl whitespace-pre-line text-sm text-gray-200">
						{challenge.description}
					</p>
				{/if}

				<div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
					<StatTile label="Objectives">
						{#snippet icon()}
							<SpriteIcon
								category="icons"
								value="GOAL_STARTED"
								size={10}
								alt="Objectives"
							/>
						{/snippet}
						{challenge.objectives.length}
					</StatTile>
					<StatTile label="Runners">
						{#snippet icon()}
							<SpriteIcon
								category="icons"
								value="MULTIPLAYER"
								size={10}
								alt="Runners"
							/>
						{/snippet}
						{challenge.runner_count > 0 ? challenge.runner_count : "—"}
					</StatTile>
					<StatTile label="Runs">
						{#snippet icon()}
							<SpriteIcon category="icons" value="STATS" size={10} alt="Runs" />
						{/snippet}
						{challenge.submission_count > 0 ? challenge.submission_count : "—"}
					</StatTile>
					<StatTile label="Best">
						{#snippet icon()}
							<SpriteIcon category="icons" value="TURN" size={10} alt="Best" />
						{/snippet}
						{#if data.leaderboard[0]}
							T{data.leaderboard[0].score_turn} · {data.leaderboard[0].user
								.display_name}
						{:else}
							—
						{/if}
					</StatTile>
				</div>

				{#if editing}
					<Panel title="Edit challenge" class="mb-4">
						<div class="mb-4 flex flex-col gap-3 text-xs text-tan">
							<label class="flex flex-col gap-1">
								<span>Title</span>
								<input
									type="text"
									bind:value={title}
									maxlength="120"
									class={INPUT_CLASS}
								/>
							</label>
							<label class="flex flex-col gap-1">
								<span
									>Description <span class="opacity-60">(optional)</span></span
								>
								<textarea
									bind:value={description}
									rows="3"
									maxlength="4000"
									class={INPUT_CLASS}
								></textarea>
							</label>
							{#if isOpen}
								<label class="flex items-center gap-2">
									<span>Open for</span>
									<input
										type="number"
										bind:value={durationDays}
										min="1"
										max="365"
										class="w-20 {INPUT_CLASS}"
									/>
									<span>days from creation</span>
								</label>
							{:else}
								<p class="text-gray-400">
									Closed {formatRelativeToNow(challenge.closes_at)} — a closed challenge
									stays closed.
								</p>
							{/if}
						</div>
						{#if rulesEditable}
							<RulesEditor
								setup={challenge.setup}
								bind:objectives
								bind:criteria
							/>
						{:else}
							<p class="text-xs text-gray-400">
								The rules are locked — a run has already been scored against
								them.
							</p>
						{/if}
						<div class="mt-4 flex items-center justify-end gap-3">
							<button
								type="button"
								class="text-sm text-tan hover:text-orange"
								onclick={() => (editing = false)}
							>
								Cancel
							</button>
							<button
								type="button"
								class={PRIMARY_BTN}
								disabled={saving}
								onclick={save}
							>
								{saving ? "Saving…" : "Save"}
							</button>
						</div>
					</Panel>
				{/if}

				<div
					class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
				>
					<Panel title="Rules">
						<RulesList
							objectives={challenge.objectives}
							criteria={challenge.criteria}
						/>
					</Panel>

					<Panel title="Leaderboard">
						{#if data.leaderboard.length === 0}
							<p class="text-sm text-gray-400">
								No runs yet{isOpen ? " — be the first." : "."}
							</p>
						{:else}
							<div class="overflow-x-auto">
								<table class="w-full text-sm">
									<thead>
										<tr
											class="text-left text-xs uppercase tracking-wide text-gray-400"
										>
											<th class="py-1 pr-3">#</th>
											<th class="py-1 pr-3">Runner</th>
											<th class="py-1 pr-3 text-right">Score</th>
											<th class="py-1 pr-3 text-right">Met on</th>
											<th class="py-1 pr-3">Game</th>
											<th class="py-1">Submitted</th>
										</tr>
									</thead>
									<tbody>
										{#each data.leaderboard as row (row.submission_id)}
											<tr class="border-t border-border-subtle text-gray-200">
												<td class="py-1.5 pr-3 font-bold text-tan"
													>{row.rank}</td
												>
												<td class="py-1.5 pr-3">
													<span class="inline-flex items-center gap-1.5">
														<PlayerAvatar
															avatarUrl={row.user.avatar_url}
															size={16}
														/>
														<ProfileLink
															userId={row.user.user_id}
															slug={row.user.slug}
															class="hover:underline"
														>
															{row.user.display_name}
														</ProfileLink>
													</span>
												</td>
												<td class="py-1.5 pr-3 text-right font-bold text-white">
													T{row.score_turn}
												</td>
												<td class="py-1.5 pr-3 text-right text-gray-400">
													{row.earliest_turn != null
														? `T${row.earliest_turn}`
														: "—"}
												</td>
												<td class="py-1.5 pr-3">
													<a
														href={resolve("/games/[id]", { id: row.game_id })}
														class="text-tan hover:text-orange hover:underline"
													>
														{row.game_name}
													</a>
												</td>
												<td class="py-1.5 text-gray-400">
													{formatRelativeToNow(row.submitted_at)}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
						{#if data.viewer && data.viewer.runs.length > 1}
							<p class="mt-3 text-xs text-gray-400">
								Your best of {data.viewer.runs.length} runs counts; the others are
								on their game pages.
							</p>
						{/if}
					</Panel>
				</div>
			</div>
		</div>
	</main>
</div>
