<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import {
		ApiError,
		cloudApi,
		type CreateTournamentBody,
	} from "$lib/api-cloud";

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	// Modal only collects name + description. Divisions, Swiss thresholds,
	// and allowed_map_scripts are configured from the tournament settings
	// page after create. The setup → swiss transition rejects an empty
	// map list, so the admin can't accidentally start without one.
	let name = $state("");
	let description = $state("");

	let busy = $state(false);
	let banner = $state<{ kind: "ok" | "err"; message: string } | null>(null);

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
		banner = null;
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
			banner = { kind: "err", message };
			busy = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape" && !busy) {
			e.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
	onclick={onClose}
	role="presentation"
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border-2 border-black bg-blue-gray p-5 shadow-lg"
		onclick={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="create-modal-title"
		tabindex="-1"
	>
		<header class="mb-4 flex items-baseline justify-between gap-3">
			<h2
				id="create-modal-title"
				class="border-b-2 border-orange pb-1 text-lg font-bold text-tan"
			>
				New tournament
			</h2>
			<button
				type="button"
				class="text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
				onclick={onClose}
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

		{#if banner}
			<div
				class="mb-3 rounded border px-3 py-2 text-sm"
				class:border-red-500={banner.kind === "err"}
				class:text-red-400={banner.kind === "err"}
				role="status"
			>
				{banner.message}
			</div>
		{/if}

		<div class="flex flex-col gap-3 text-xs text-tan">
			<label class="flex flex-col gap-1">
				<span>Name</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="text"
					bind:value={name}
					autofocus
					maxlength="120"
					class="rounded border border-black bg-[#35302b] p-1.5"
				/>
			</label>

			<label class="flex flex-col gap-1">
				<span>Description <span class="opacity-60">(optional)</span></span>
				<textarea
					bind:value={description}
					rows="3"
					maxlength="2000"
					class="rounded border border-black bg-[#35302b] p-1.5"
				></textarea>
			</label>

			<p class="text-tan opacity-60">
				Divisions, Swiss configuration, and map scripts are set on the
				tournament page after create.
			</p>
		</div>

		<div class="mt-4 flex justify-end gap-2">
			<button
				type="button"
				class="rounded border border-brown px-3 py-1.5 text-xs text-tan transition-colors hover:bg-brown disabled:opacity-50"
				onclick={onClose}
				disabled={busy}
			>
				Cancel
			</button>
			<button
				type="button"
				class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan disabled:opacity-50"
				onclick={submit}
				disabled={!canSubmit}
			>
				{busy ? "Creating…" : "Create"}
			</button>
		</div>
	</div>
</div>
