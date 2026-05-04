<script lang="ts">
	import { cloudApi, ApiError } from "$lib/api-cloud";
	import { safeNext } from "$lib/utils/safe-next";

	let busy = $state(false);
	let error = $state<string | null>(null);

	async function signIn() {
		busy = true;
		error = null;
		try {
			const redirectUri = `${window.location.origin}/auth/callback`;
			// Read the post-login redirect target from the URL and sanitize
			// before sending to the worker. The worker re-validates with the
			// same rules — defense in depth.
			const params = new URLSearchParams(window.location.search);
			const next = safeNext(params.get("next"));
			const { authorize_url } = await cloudApi.discordStart(redirectUri, next);
			window.location.href = authorize_url;
		} catch (err) {
			busy = false;
			error =
				err instanceof ApiError
					? `${err.code ?? err.status}: ${err.message}`
					: err instanceof Error
						? err.message
						: "Sign-in failed";
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-blue-gray p-4">
	<div class="w-full max-w-sm rounded border-2 border-border-gray bg-tan p-8 text-center">
		<h1 class="mb-2 font-serif text-2xl text-brown">Per-Ankh</h1>
		<p class="mb-6 text-sm text-brown">Sign in to upload and view your Old World games.</p>

		<button
			class="w-full rounded bg-[#5865F2] px-4 py-2 font-semibold text-white hover:bg-[#4752c4] disabled:opacity-60"
			disabled={busy}
			onclick={signIn}
		>
			{busy ? "Redirecting…" : "Sign in with Discord"}
		</button>

		{#if error}
			<p class="mt-4 text-sm text-red-700">{error}</p>
		{/if}
	</div>
</div>
