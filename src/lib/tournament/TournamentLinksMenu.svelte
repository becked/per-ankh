<script lang="ts">
	import type { TournamentDetail } from "$lib/api-cloud";
	import Popover from "$lib/ui/Popover.svelte";

	interface Props {
		tournament: TournamentDetail;
		// Opens the tournament guide. Same callback the standalone Guide button
		// used before this menu existed.
		onGuide: () => void;
	}

	let { tournament, onGuide }: Props = $props();

	const links = $derived(tournament.links);

	let open = $state(false);

	function openGuide() {
		open = false;
		onGuide();
	}

	// Shared button styling for the header's action row — full opacity with an
	// orange hover, matching the Settings trigger next to it.
	const triggerClass =
		"whitespace-nowrap rounded border border-tan px-2.5 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange";
</script>

{#if links.length === 0}
	<!-- Degrade to the plain Guide button when there's nothing else to show — no
	     point wrapping a single item in a dropdown. -->
	<button
		type="button"
		class={triggerClass}
		onclick={onGuide}
		aria-label="How the tournament works"
		title="How the tournament works"
	>
		Guide
	</button>
{:else}
	<Popover
		bind:open
		ariaLabel="Tournament links"
		contentClass="w-[min(92vw,16rem)]"
		frameClass="border-4 border-surface-raised bg-blue-gray p-1.5 shadow-lg"
	>
		{#snippet trigger({ props })}
			<button {...props} type="button" class={triggerClass} title="Links">
				Links
			</button>
		{/snippet}

		<div class="flex flex-col">
			<!-- Guide first: it's the built-in help page, distinct from the admin's
			     own links below the divider. -->
			<button
				type="button"
				class="flex w-full items-center rounded px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-surface-raised"
				onclick={openGuide}
			>
				Guide
			</button>

			<hr class="my-1 border-t border-tan opacity-20" />

			<!-- External links open in a new tab. rel=noopener noreferrer guards
			     against tabnabbing + referrer leakage; href is server-validated to
			     http(s) so it's not an app route (resolve() doesn't apply). -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			{#each links as link (link.url + link.label)}
				<a
					href={link.url}
					target="_blank"
					rel="noopener noreferrer"
					class="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs text-tan transition-colors hover:bg-surface-raised"
					onclick={() => (open = false)}
				>
					<span class="truncate">{link.label}</span>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="ml-auto h-3.5 w-3.5 shrink-0 opacity-70"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
						/>
					</svg>
				</a>
			{/each}
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</div>
	</Popover>
{/if}
