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
	// so an on/off flag there would show the wrong state after a toggle.

	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { ApiError, cloudApi } from "$lib/api-cloud";
	import { COMPACT_BTN, INPUT_CLASS } from "$lib/ui/classes";
	import { ASK_QUESTION_MAX } from "./limits";

	let question = $state("");
	let asking = $state(false);
	let refusal = $state<string | null>(null);

	const BUILDER_WORKS = "The query builder below still works.";

	// The line a refused submit shows. A limit or the switch is the feature
	// declining, so the line says the builder is still there; a question the
	// catalog cannot express, or a name that matched nothing, is the Worker's
	// own message, which names what failed.
	function refusalLine(err: unknown): string {
		if (!(err instanceof ApiError)) {
			return `Couldn't reach the server. ${BUILDER_WORKS}`;
		}
		switch (err.code) {
			case "ASK_DISABLED":
				return `Asking in plain language is switched off right now. ${BUILDER_WORKS}`;
			case "ASK_UNAVAILABLE":
				return `Asking in plain language is unavailable right now. ${BUILDER_WORKS}`;
			case "RATE_LIMIT_ASK_USER":
				return `You've asked a lot of questions this hour. Try again later. ${BUILDER_WORKS}`;
			case "RATE_LIMIT_ASK_IP":
				return `Too many questions have come from this network this hour. Try again later. ${BUILDER_WORKS}`;
			case "RATE_LIMIT_ASK_GLOBAL":
				return `Asking in plain language is busy this hour. Try again later. ${BUILDER_WORKS}`;
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
			class={COMPACT_BTN}
			disabled={asking || question.trim() === ""}>Ask</button
		>
	</div>
	{#if refusal}
		<p id="ask-refusal" class="text-xs text-orange" role="status">{refusal}</p>
	{/if}
</form>
