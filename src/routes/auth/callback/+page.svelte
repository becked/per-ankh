<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { cloudApi, ApiError } from "$lib/api-cloud";

	type Status =
		| { kind: "loading" }
		| { kind: "success"; displayName: string }
		| { kind: "error"; message: string };

	let status = $state<Status>({ kind: "loading" });

	onMount(async () => {
		const params = new URLSearchParams(window.location.search);
		const code = params.get("code");
		const state = params.get("state");
		const oauthError = params.get("error");

		if (oauthError) {
			const desc = params.get("error_description") ?? oauthError;
			status = { kind: "error", message: `Discord: ${desc}` };
			return;
		}
		if (!code || !state) {
			status = { kind: "error", message: "Missing code or state in callback URL" };
			return;
		}

		const redirectUri = `${window.location.origin}/auth/callback`;
		try {
			const me = await cloudApi.discordCallback(code, state, redirectUri);
			status = { kind: "success", displayName: me.display_name };
			// Brief pause so the user sees the confirmation, then home.
			setTimeout(() => goto("/", { replaceState: true }), 500);
		} catch (err) {
			const message =
				err instanceof ApiError
					? `${err.code ?? err.status}: ${err.message}`
					: err instanceof Error
						? err.message
						: "Sign-in failed";
			status = { kind: "error", message };
		}
	});
</script>

<div class="flex min-h-screen items-center justify-center bg-blue-gray p-4">
	<div class="w-full max-w-sm rounded border-2 border-border-gray bg-tan p-8 text-center">
		{#if status.kind === "loading"}
			<p class="text-brown">Completing sign-in…</p>
		{:else if status.kind === "success"}
			<p class="text-brown">Signed in as {status.displayName}.</p>
			<p class="mt-2 text-xs text-brown">Redirecting…</p>
		{:else}
			<p class="font-semibold text-red-700">Sign-in failed</p>
			<p class="mt-2 break-words text-sm text-brown">{status.message}</p>
			<a class="mt-4 inline-block text-sm underline text-brown" href="/login">Try again</a>
		{/if}
	</div>
</div>
