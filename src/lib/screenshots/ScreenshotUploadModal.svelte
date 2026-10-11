<script lang="ts">
	// The centered modal the game header's camera opens — the shell around
	// ScreenshotUploader, which holds the picker itself.
	//
	// A modal rather than one of GameActions' anchored popovers because the
	// picker carries a preview of the image that will be stored, and on an
	// account's first upload the screenshot terms as well. At the w-80 a
	// header popover can hang off a 28 px icon, a 16:9 screenshot previewed
	// ~290 px wide and the four rules read five words to the line — so the
	// panel scrolled, and the Upload button scrolled off with it.
	//
	// Portalled (bits-ui Dialog, as ConfirmDialogHost portals its AlertDialog)
	// rather than hand-rolled the way AboutModal and the admin modals are:
	// every surface that renders GameHeader puts it inside `<main class="isolate
	// …">`, which is a stacking context, so a fixed backdrop rendered in place
	// paints *under* CloudHeader — `relative`, and painted in the later
	// positioned-descendants step. The portal also brings the focus trap and
	// focus restore that an aria-modal dialog owes the keyboard.
	//
	// Not $lib/ui/Popover.svelte, the other shared bits-ui shell: it anchors to
	// its trigger and is non-blocking — no backdrop, no focus trap — which is
	// the anchored shape this surface just left. The trigger snippet below is
	// borrowed from it.
	//
	// Chrome follows the admin modals (BulkReparseModal): a `bg-surface` card
	// on a `bg-black/70` backdrop, with the orange-ruled title the other
	// dialogs use. Deliberately not the popovers' `bg-blue-gray`, which is the
	// page's own background colour (app.css) — on it a panel reads as a hole
	// with a black outline rather than as a surface.
	//
	// z-[80]/[81] sits above the page's popovers (z-50) and below the confirm
	// dialog (z-[90]) and the toasts (z-[100]), neither of which this opens
	// but both of which outrank it.
	import { Dialog } from "bits-ui";
	import type { Snippet } from "svelte";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import type { UploadedScreenshot } from "$lib/api-cloud";
	import ScreenshotUploader from "./ScreenshotUploader.svelte";

	let {
		open = $bindable(false),
		gameId,
		isPublic,
		onUploaded,
		onOpenChange,
		trigger,
	}: {
		open?: boolean;
		gameId: string;
		isPublic: boolean;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onUploaded?: (screenshot: UploadedScreenshot) => void;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onOpenChange?: (open: boolean) => void;
		// Receives bits-ui's trigger props to spread onto the caller's own button,
		// so the camera's markup and styling stay in GameActions beside the
		// popover triggers it sits with, and bits-ui supplies the aria-haspopup /
		// aria-expanded / aria-controls set and registers the button as the
		// element focus returns to on close.
		trigger: Snippet<[{ props: Record<string, unknown> }]>;
	} = $props();
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Trigger>
		{#snippet child({ props })}
			{@render trigger({ props })}
		{/snippet}
	</Dialog.Trigger>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-[80] bg-black/70" />
		<!-- Caps at 85vh and scrolls its body, so the title stays put and an
		     overlong first-upload screen can't push itself off the viewport. -->
		<Dialog.Content
			class="fixed left-1/2 top-1/2 z-[81] flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded border-2 border-black bg-surface p-6"
		>
			<header class="mb-4 flex flex-none items-baseline justify-between gap-3">
				<Dialog.Title
					class="border-b-2 border-orange pb-1 text-lg font-bold text-tan"
				>
					Add a screenshot
				</Dialog.Title>
				<Dialog.Close
					class="text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
					aria-label="Close"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</Dialog.Close>
			</header>

			<div
				class="cloud-scroll min-h-0 flex-1 overflow-y-auto"
				use:autohideScroll
			>
				<ScreenshotUploader {gameId} {isPublic} {onUploaded} />
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
