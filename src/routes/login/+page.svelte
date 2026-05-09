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
						: "Login failed";
		}
	}
</script>

<div class="flex min-h-screen flex-col bg-blue-gray">
	<!--
		Stripped-down header for the auth flow: just the centered wordmark,
		no hamburger / search. Visual proportions match CloudHeader so the
		page chrome feels continuous with the rest of the app.
	-->
	<header
		class="flex w-full shrink-0 items-center justify-center border-b-[3px] border-black bg-blue-gray px-4 pb-2 pt-6"
	>
		<div class="border-b-2 border-orange pb-1 text-3xl font-bold text-gray-200">
			𓉑 Per Ankh
		</div>
	</header>

	<div class="flex flex-1 items-center justify-center p-4">
		<div class="w-full max-w-sm rounded-lg p-4" style="background-color: #2a2622;">
			<h3 class="mb-3 text-base font-bold text-tan">Login</h3>
			<div class="rounded-lg p-3" style="background-color: #35302B;">
				<button
					type="button"
					onclick={signIn}
					disabled={busy}
					class="w-full rounded bg-[#5865F2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4752c4] disabled:opacity-60"
				>
					{busy ? "Redirecting…" : "Login with Discord"}
				</button>

				{#if error}
					<p class="mt-3 text-xs text-red-400">{error}</p>
				{/if}
			</div>
		</div>
	</div>
</div>
