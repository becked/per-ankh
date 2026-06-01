<script lang="ts">
	// Shared cancel / confirm footer for the tournament popovers and forms: a
	// right-aligned pair of a plain Cancel button and an accented confirm
	// button. Callers vary only in the labels, the disabled conditions, and an
	// optional wrapper spacing class.
	interface Props {
		onCancel: () => void;
		onConfirm: () => void;
		confirmLabel: string;
		// Shown on the confirm button while `busy` (e.g. "Saving…"). Falls back
		// to confirmLabel when omitted.
		busyLabel?: string;
		busy?: boolean;
		// Defaults to disabling confirm while busy; pass an explicit value for
		// validation gating (e.g. !canSubmit).
		confirmDisabled?: boolean;
		// Cancel is disabled while busy unless overridden.
		cancelDisabled?: boolean;
		// Extra classes on the wrapper (e.g. "mt-4" / "pt-1").
		class?: string;
	}
	let {
		onCancel,
		onConfirm,
		confirmLabel,
		busyLabel,
		busy = false,
		confirmDisabled,
		cancelDisabled,
		class: klass = "",
	}: Props = $props();
</script>

<div class="flex justify-end gap-2 {klass}">
	<button
		type="button"
		class="rounded border border-tan px-3 py-1.5 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
		onclick={onCancel}
		disabled={cancelDisabled ?? busy}
	>
		Cancel
	</button>
	<button
		type="button"
		class="rounded border border-tan px-3 py-1.5 text-xs text-tan disabled:opacity-50"
		onclick={onConfirm}
		disabled={confirmDisabled ?? busy}
	>
		{busy && busyLabel ? busyLabel : confirmLabel}
	</button>
</div>
