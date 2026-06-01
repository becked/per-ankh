<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import {
		ApiError,
		cloudApi,
		type CreateTournamentBody,
	} from "$lib/api-cloud";
	import Popover from "$lib/ui/Popover.svelte";
	import FormFooter from "$lib/tournament/FormFooter.svelte";
	import { toast } from "$lib/ui/toast";

	let open = $state(false);

	// Popover only collects name + description. Divisions, Swiss thresholds,
	// and the map pool are configured from the tournament settings page
	// after create. The setup → swiss transition rejects an empty map pool,
	// so the admin can't accidentally start without one.
	let name = $state("");
	let description = $state("");

	let busy = $state(false);

	const canSubmit = $derived(!busy && name.trim().length > 0);

	function buildBody(): CreateTournamentBody {
		const body: CreateTournamentBody = { name: name.trim() };
		const trimmedDesc = description.trim();
		if (trimmedDesc) body.description = trimmedDesc;
		return body;
	}

	async function submit() {
		if (!canSubmit) return;
		busy = true;
		try {
			const { tournament } = await cloudApi.createTournament(buildBody());
			// Refresh the layout-level my-tournaments / admin-tournaments
			// so the header dropdown picks up the new tournament before we
			// navigate (the user is now its sole admin).
			await invalidateAll();
			await goto(resolve("/tournaments/[slug]", { slug: tournament.slug }));
		} catch (err) {
			let message = "Create failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			toast.error(message);
			busy = false;
		}
	}
</script>

<Popover bind:open ariaLabel="New tournament">
	{#snippet trigger({ props })}
		<button
			{...props}
			type="button"
			class="rounded border border-tan px-3 py-1.5 text-xs text-tan"
		>
			New tournament
		</button>
	{/snippet}

	<header class="mb-4 flex items-baseline justify-between gap-3">
		<h2 class="border-b-2 border-orange pb-1 text-lg font-bold text-tan">
			New tournament
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

	<div class="flex flex-col gap-3 text-xs text-tan">
		<label class="flex flex-col gap-1">
			<span>Name</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				type="text"
				bind:value={name}
				autofocus
				maxlength="120"
				class="rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none"
			/>
		</label>

		<label class="flex flex-col gap-1">
			<span>Description <span class="opacity-60">(optional)</span></span>
			<textarea
				bind:value={description}
				rows="3"
				maxlength="2000"
				class="rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none"
			></textarea>
		</label>
	</div>

	<FormFooter
		class="mt-4"
		onCancel={() => (open = false)}
		onConfirm={submit}
		confirmLabel="Create"
		busyLabel="Creating…"
		{busy}
		confirmDisabled={!canSubmit}
	/>
</Popover>
