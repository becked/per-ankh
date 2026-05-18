<script lang="ts">
	import { page } from "$app/state";

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
</script>

<main class="flex flex-1 items-center justify-center p-4">
	<div class="w-full max-w-sm rounded-lg p-4" style="background-color: #2a2622;">
		<h3 class="mb-3 text-base font-bold text-tan">
			{status} — {heading}
		</h3>
		<div class="rounded-lg p-3" style="background-color: #35302B;">
			<p class="mb-3 text-xs text-gray-400">
				{message || "The page you were looking for isn't here."}
			</p>

			<a
				href="/dashboard"
				class="block w-full rounded border border-brown px-3 py-1.5 text-center text-xs font-semibold text-tan transition-colors hover:bg-brown"
			>
				Back to dashboard
			</a>
		</div>
	</div>
</main>
