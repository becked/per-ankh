<script lang="ts">
	// The owner's upload control for a game's screenshots (issue #289, step 4).
	//
	// Pick → downscale in a worker → preview → POST. The preview is the WebP
	// that will be stored, not the file that was picked: the browser re-encodes
	// to 1600 px / ~1.8 MP (see stored-variant.ts) and the endpoint classifies
	// and stores those exact bytes, so showing the original would be showing
	// something nobody keeps.
	//
	// The terms are prompted by the endpoint, not by this component's own
	// knowledge: there is no read of `screenshot_terms_accepted_at`, so the
	// first upload of an account that hasn't agreed comes back
	// 403 TERMS_NOT_ACCEPTED and the agreement is collected then. That refusal
	// is the first gate on the endpoint, ahead of both the classifier call and
	// the rate-limit charge, so the round trip costs the user nothing.
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import {
		ApiError,
		cloudApi,
		SCREENSHOT_CAPTION_MAX,
		UnauthorizedError,
		type UploadedScreenshot,
	} from "$lib/api-cloud";
	import { INPUT_CLASS, PRIMARY_BTN, SECONDARY_BTN } from "$lib/ui/classes";
	import PanelInset from "$lib/ui/PanelInset.svelte";
	import { loginBounce } from "$lib/utils/safe-next";
	import {
		DownscaleFailure,
		downscaleToStoredVariant,
		type StoredVariant,
	} from "./downscale";
	import { MIN_LONG_EDGE } from "./stored-variant";

	let {
		gameId,
		isPublic,
	}: {
		gameId: string;
		// A screenshot requires a public game — that is what lets every stored
		// object be served from a cacheable public host with no per-request
		// gate, so it is a precondition of storing anything rather than a
		// display rule. Read from the shared visibility state, so flipping the
		// header's lock changes this without a reload.
		isPublic: boolean;
	} = $props();

	type Phase = "idle" | "preparing" | "ready" | "terms" | "uploading" | "done";

	interface Prepared {
		variant: StoredVariant;
		// A data: URL rather than an object URL, because the shipped CSP's
		// img-src allows `data:` and not `blob:` (svelte.config.js).
		preview: string;
	}

	let phase = $state<Phase>("idle");
	let prepared = $state<Prepared | null>(null);
	let uploaded = $state<UploadedScreenshot | null>(null);
	let caption = $state("");
	let error = $state<string | null>(null);
	let accepting = $state(false);
	// Once the terms have been collected, a second TERMS_NOT_ACCEPTED is not a
	// terms problem — prompting again would send the user round the same loop
	// with the same result, so it falls through to the error line instead.
	let termsPrompted = $state(false);

	const resized = $derived.by(() => {
		const p = prepared;
		if (!p) return false;
		return (
			p.variant.width !== p.variant.sourceWidth ||
			p.variant.height !== p.variant.sourceHeight
		);
	});

	function reset(message: string | null = null): void {
		prepared = null;
		uploaded = null;
		caption = "";
		phase = "idle";
		error = message;
	}

	function dataUrl(blob: Blob): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(blob);
		});
	}

	async function onPick(event: Event): Promise<void> {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		// Clear it, so picking the same file again after a refusal still fires
		// a change event.
		input.value = "";
		// A pick starts a new screenshot, which is also true of "Add another"
		// in the done state — so the finished upload and the caption that
		// belonged to it go now, rather than carrying onto the next one.
		error = null;
		uploaded = null;
		caption = "";
		phase = "preparing";
		try {
			const variant = await downscaleToStoredVariant(file);
			if (Math.max(variant.width, variant.height) < MIN_LONG_EDGE) {
				// The endpoint's floor, applied to the same bytes it would apply
				// it to. A client check gates nothing — this one spends neither
				// an upload nor one of the hour's classifier attempts on a
				// refusal that is already certain.
				reset(
					`Screenshots need to be at least ${MIN_LONG_EDGE} px on the long edge. That one came out ${variant.width}×${variant.height}.`,
				);
				return;
			}
			prepared = { variant, preview: await dataUrl(variant.webp) };
			phase = "ready";
		} catch (err) {
			reset(
				err instanceof DownscaleFailure
					? err.message
					: "Couldn't prepare that image",
			);
		}
	}

	async function submit(): Promise<void> {
		const p = prepared;
		if (!p) return;
		error = null;
		phase = "uploading";

		const form = new FormData();
		form.append("image", p.variant.webp, "screenshot.webp");
		// Sent unconditionally: the Worker trims, and a caption that trims to
		// empty is stored as no caption at all.
		form.append("caption", caption);

		try {
			const res = await cloudApi.uploadScreenshot(gameId, form);
			uploaded = res.screenshot;
			phase = "done";
		} catch (err) {
			if (err instanceof UnauthorizedError) {
				await bounceToLogin();
				return;
			}
			if (
				err instanceof ApiError &&
				err.code === "TERMS_NOT_ACCEPTED" &&
				!termsPrompted
			) {
				termsPrompted = true;
				phase = "terms";
				return;
			}
			// Every refusal the endpoint makes carries a message written for
			// the uploader — the cap counts, the rate limit, the classifier's
			// rejection — so it is shown verbatim rather than restated here.
			phase = "ready";
			error = err instanceof ApiError ? err.message : "Upload failed";
		}
	}

	async function agreeAndUpload(): Promise<void> {
		error = null;
		accepting = true;
		try {
			await cloudApi.acceptScreenshotTerms();
		} catch (err) {
			if (err instanceof UnauthorizedError) {
				await bounceToLogin();
				return;
			}
			error =
				err instanceof ApiError
					? err.message
					: "Couldn't record that you agreed";
			return;
		} finally {
			accepting = false;
		}
		await submit();
	}

	// The session expired under a control only its owner sees — both writes
	// here are session writes, so both can land on it. loginBounce carries
	// pathname + search, so the game the uploader was on survives the round
	// trip through OAuth.
	async function bounceToLogin(): Promise<void> {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic next-query construction; resolve()'s branded types don't admit dynamic search strings
		await goto(loginBounce(page.url));
	}
</script>

{#if !isPublic}
	<p class="text-sm text-gray-400">
		Screenshots live on a public game. Use the lock above to make this one
		public.
	</p>
{:else}
	{#if error}
		<p class="mb-3 text-sm font-bold text-danger">{error}</p>
	{/if}

	{#if phase === "idle"}
		<label class="inline-flex cursor-pointer items-center gap-2 {PRIMARY_BTN}">
			Choose a screenshot
			<input type="file" accept="image/*" onchange={onPick} class="sr-only" />
		</label>
	{:else if phase === "preparing"}
		<p class="text-sm text-tan">Preparing…</p>
	{:else if prepared}
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start">
			<PanelInset class="sm:w-80 sm:flex-none">
				<!-- The local preview stays up through the done state rather than
				     swapping to the stored object's URL: they are the same bytes,
				     and fetching the public URL here would both need img-src to
				     name the image host (a CSP the readers in step 5 will widen
				     anyway) and warm the edge cache for an object a review-band
				     upload is holding hidden. -->
				<img
					src={prepared.preview}
					alt="Screenshot preview"
					class="w-full rounded"
				/>
				<p class="mt-1 text-xs text-gray-400">
					{prepared.variant.width}×{prepared.variant.height}
					{#if resized}
						· resized from {prepared.variant.sourceWidth}×{prepared.variant
							.sourceHeight}
					{/if}
				</p>
			</PanelInset>

			<div class="min-w-0 flex-1">
				{#if phase === "terms"}
					<h3 class="mb-2 text-sm font-bold text-tan">
						Before your first screenshot
					</h3>
					<div class="mb-3 space-y-2 text-sm leading-relaxed text-gray-300">
						<p>
							Screenshots appear on this game's page and on your profile, where
							anyone can see them.
						</p>
						<p>
							Every upload is screened automatically before it is stored. One
							the screening isn't sure about waits for a site admin to look at
							it.
						</p>
						<p>
							By uploading you confirm the image is a screenshot of your own
							&ldquo;Old World&rdquo; game, and that it contains nothing
							illegal, sexual or graphic. A screenshot can be taken down at any
							time.
						</p>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<button
							type="button"
							class={PRIMARY_BTN}
							disabled={accepting}
							onclick={agreeAndUpload}
						>
							{accepting ? "Uploading…" : "I agree — upload"}
						</button>
						<button
							type="button"
							class={SECONDARY_BTN}
							disabled={accepting}
							onclick={() => reset()}
						>
							Cancel
						</button>
					</div>
				{:else if phase === "done" && uploaded}
					<p class="mb-1 text-sm font-bold text-tan">
						{uploaded.status === "published" ? "Added." : "Waiting on review."}
					</p>
					<p class="mb-3 text-sm text-gray-400">
						{uploaded.status === "published"
							? "It's on this game now."
							: "The screening wasn't sure about this one, so a site admin will look at it before it appears."}
					</p>
					<label
						class="inline-flex cursor-pointer items-center gap-2 {SECONDARY_BTN}"
					>
						Add another
						<input
							type="file"
							accept="image/*"
							onchange={onPick}
							class="sr-only"
						/>
					</label>
				{:else}
					<label class="mb-3 block">
						<span class="mb-1 block text-xs font-bold text-gray-400">
							Caption (optional)
						</span>
						<input
							type="text"
							bind:value={caption}
							maxlength={SCREENSHOT_CAPTION_MAX}
							disabled={phase === "uploading"}
							class="w-full text-sm text-tan {INPUT_CLASS}"
						/>
					</label>
					<div class="flex flex-wrap items-center gap-2">
						<button
							type="button"
							class={PRIMARY_BTN}
							disabled={phase === "uploading"}
							onclick={submit}
						>
							{phase === "uploading" ? "Uploading…" : "Upload"}
						</button>
						<button
							type="button"
							class={SECONDARY_BTN}
							disabled={phase === "uploading"}
							onclick={() => reset()}
						>
							Cancel
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/if}
