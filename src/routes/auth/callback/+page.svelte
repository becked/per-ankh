<script lang="ts">
	import { onMount } from "svelte";
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { cloudApi, ApiError } from "$lib/api-cloud";
	import { safeNext } from "$lib/utils/safe-next";

	type Status =
		| { kind: "loading" }
		| { kind: "success"; displayName: string }
		| { kind: "error"; message: string; code: string | null };

	let status = $state<Status>({ kind: "loading" });

	onMount(async () => {
		const params = new URLSearchParams(window.location.search);
		const code = params.get("code");
		const state = params.get("state");
		const oauthError = params.get("error");

		if (oauthError) {
			const desc = params.get("error_description") ?? oauthError;
			status = { kind: "error", message: `Discord: ${desc}`, code: null };
			return;
		}
		if (!code || !state) {
			status = {
				kind: "error",
				message: "Missing code or state in callback URL",
				code: null,
			};
			return;
		}

		const redirectUri = `${window.location.origin}/auth/callback`;
		try {
			const me = await cloudApi.discordCallback(code, state, redirectUri);
			status = { kind: "success", displayName: me.display_name };
			// Use the server-validated `next` from OAuthPending. safeNext is
			// defense-in-depth in case the worker is from before the field
			// was introduced and `next` comes back undefined.
			const target = safeNext(me.next);
			// invalidateAll() reruns the root +layout.ts user load so
			// CloudHeader picks up the freshly-set session and renders the
			// signed-in menu. Without this, goto() does a client-side nav
			// that skips the layout load, leaving data.user stuck at the
			// null value captured before the OAuth callback completed.
			setTimeout(async () => {
				await invalidateAll();
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- target is server- and client-validated via safeNext(); resolve()'s branded route types don't admit dynamic paths
				await goto(target, { replaceState: true });
			}, 500);
		} catch (err) {
			const message =
				err instanceof ApiError
					? err.message
					: err instanceof Error
						? err.message
						: "Login failed";
			const code = err instanceof ApiError ? err.code : null;
			status = { kind: "error", message, code };
		}
	});
</script>

<div class="flex min-h-screen flex-col bg-blue-gray">
	<!--
		Stripped-down header for the auth flow: just the centered wordmark,
		no hamburger / search. Matches / so the OAuth round-trip feels
		visually continuous.
	-->
	<header
		class="flex w-full shrink-0 items-center justify-center border-b-[3px] border-black bg-blue-gray px-4 pb-2 pt-6"
	>
		<div class="border-b-2 border-orange pb-1 text-3xl font-bold text-gray-200">
			𓉑 Per Ankh
		</div>
	</header>

	<div class="flex flex-1 items-center justify-center p-4">
		<div
			class="w-full max-w-sm rounded-lg p-4"
			style="background-color: #2a2622;"
		>
			<h3 class="mb-3 text-base font-bold text-tan">Login</h3>
			<div class="rounded-lg p-3" style="background-color: #35302B;">
				{#if status.kind === "loading"}
					<p class="text-xs text-gray-400">Logging in…</p>
				{:else if status.kind === "success"}
					<p class="text-xs text-tan">
						Logged in as
						<span class="font-bold">{status.displayName}</span>.
					</p>
					<p class="mt-1 text-xs text-gray-400">Redirecting…</p>
				{:else}
					<p class="text-xs font-bold text-red-400">Login failed</p>
					<p class="mt-2 break-words text-xs text-gray-400">
						{status.message}
					</p>
					<a
						href={resolve("/")}
						class="mt-3 inline-block rounded bg-brown px-3 py-1 text-xs text-tan hover:bg-orange"
					>
						Try again
					</a>
				{/if}
			</div>
		</div>
	</div>
</div>
