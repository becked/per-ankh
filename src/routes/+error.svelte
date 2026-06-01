<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { browser } from "$app/environment";

	const status = $derived(page.status);
	const message = $derived(page.error?.message ?? "");

	// Friendly heading per status. Falls through to generic "Error" so
	// uncommon codes (502, 503, ...) still render coherently.
	const heading = $derived(
		status === 404
			? "Page not found"
			: status === 403
				? "Not allowed"
				: status === 401
					? "Sign in required"
					: status >= 500
						? "Something went wrong"
						: "Error",
	);

	// Only offer "Go back" when this tab has a prior history entry —
	// fresh tabs / direct URL hits have history.length === 1 and
	// history.back() would no-op. Read on the client only.
	let canGoBack = $state(false);
	$effect(() => {
		if (browser) canGoBack = history.length > 1;
	});

	function goBack() {
		history.back();
	}
</script>

<main class="flex flex-1 items-center justify-center p-4">
	<div
		class="w-full max-w-sm rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<h3 class="mb-3 text-base font-bold text-tan">
			{status} — {heading}
		</h3>
		<div
			class="rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<p class="mb-3 text-xs text-gray-400">
				{message || "The page you were looking for isn't here."}
			</p>

			<div class="flex flex-col gap-2">
				{#if canGoBack}
					<button
						type="button"
						onclick={goBack}
						class="block w-full rounded border border-brown px-3 py-1.5 text-center text-xs font-semibold text-tan transition-colors hover:bg-brown"
					>
						Go back
					</button>
				{/if}
				<a
					href={resolve("/")}
					class="block w-full rounded border border-brown px-3 py-1.5 text-center text-xs font-semibold text-tan transition-colors hover:bg-brown"
				>
					Back to home
				</a>
			</div>
		</div>
	</div>
</main>
