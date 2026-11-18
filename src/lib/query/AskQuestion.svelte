<script lang="ts">
	// The question input on /stats/explore (issue #380): a question in plain
	// language, which the Worker translates into a selection. On success the
	// page navigates to that selection, so the builder below fills with the
	// question as the model read it and the results panel answers it — the
	// same path a hand-built question takes.
	//
	// A refusal is one line under the input, and the builder keeps working
	// whatever the reason. The page learns that the feature is switched off
	// only from a refused submit: the catalog is edge-cached for five minutes,
	// so an on/off flag there would show the wrong state after a toggle. An
	// expired session goes to sign-in and comes back to this page.

	import { untrack } from "svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { ApiError, cloudApi, UnauthorizedError } from "$lib/api-cloud";
	import { ASK_BTN, INPUT_CLASS } from "$lib/ui/classes";
	import { loginBounce } from "$lib/utils/safe-next";
	import { ASK_QUESTION_MAX } from "./limits";

	// The selection on screen in words (describeDraft), or "" when nothing
	// has been asked yet.
	let { described }: { described: string } = $props();

	// The input opens on that description. Without it, a page reached by a
	// link would show an empty question box above an answered query.
	//
	// The description follows the selection as it changes (the builder, the
	// back button, Reset), but only while it is still what the input holds.
	// Text somebody typed stays in the input, whether or not it was asked.
	// `placed` is the description last put there, so the effect can tell the
	// two apart. untrack() marks both as initial values only.
	let question = $state(untrack(() => described));
	let placed = untrack(() => described);

	// .pre, so the new description is in the input before the new rows paint.
	$effect.pre(() => {
		const next = described;
		if (untrack(() => question) === placed) question = next;
		placed = next;
	});

	let asking = $state(false);
	let refusal = $state<string | null>(null);

	const BUILDER_WORKS = "The query builder below still works.";

	// The line a refused submit shows. The Worker's message is the text, so
	// the wording lives in one place, and the per-account limit it names is
	// the configured one. A limit or the switch is the feature declining, so
	// the line adds that the builder is still there. A question the catalog
	// cannot express, or a name that matched nothing, gets a lead-in before
	// the message, which names what failed.
	function refusalLine(err: unknown): string {
		if (!(err instanceof ApiError)) {
			return `Couldn't reach the server. ${BUILDER_WORKS}`;
		}
		switch (err.code) {
			case "ASK_DISABLED":
			case "ASK_UNAVAILABLE":
			case "RATE_LIMIT_ASK_USER":
			case "RATE_LIMIT_ASK_IP":
			case "RATE_LIMIT_ASK_GLOBAL":
			case "RATE_LIMIT_ASK_BUDGET":
				return `${err.message}. ${BUILDER_WORKS}`;
			case "ASK_UNSUPPORTED":
				return `Explore can't answer that. ${err.message}`;
			case "ASK_UNMATCHED":
				return `Couldn't turn that into a query. ${err.message}`;
			default:
				return err.message;
		}
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const text = question.trim();
		if (text === "" || asking) return;
		asking = true;
		refusal = null;
		try {
			const { selection } = await cloudApi.askQuery(text);
			// Built rather than mutated, as the builder's own run() does it.
			const next = new URL(`${page.url.pathname}?${selection}`, page.url);
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- search-param-only update on the current route; URL objects are SvelteKit's documented dynamic-nav API
			await goto(next, { keepFocus: true, noScroll: true });
		} catch (err) {
			if (err instanceof UnauthorizedError) {
				// loginBounce carries pathname + search, so the selection on screen
				// survives the round trip through OAuth.
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic next-query construction; resolve()'s branded types don't admit dynamic search strings
				await goto(loginBounce(page.url));
				return;
			}
			refusal = refusalLine(err);
		} finally {
			asking = false;
		}
	}
</script>

<form class="flex flex-col gap-1.5" onsubmit={submit} aria-busy={asking}>
	<div class="flex items-center gap-2">
		<input
			class="{INPUT_CLASS} min-w-0 flex-1 text-xs text-tan disabled:opacity-50"
			type="text"
			bind:value={question}
			maxlength={ASK_QUESTION_MAX}
			disabled={asking}
			aria-label="Your question"
			aria-describedby={refusal ? "ask-refusal" : undefined}
		/>
		<button
			type="submit"
			class={ASK_BTN}
			disabled={asking || question.trim() === ""}>Ask</button
		>
	</div>
	{#if refusal}
		<p id="ask-refusal" class="text-xs text-gray-400" role="status">
			{refusal}
		</p>
	{/if}
</form>
