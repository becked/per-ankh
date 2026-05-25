// Promise-based confirm dialog. Replaces native confirm() while preserving its
// imperative ergonomics: `if (!(await confirmDialog({...}))) return;`. The
// singleton ConfirmDialogHost (mounted in the root layout) renders the active
// request and resolves the promise on confirm / cancel / dismiss.
import { writable } from "svelte/store";

export type ConfirmRequest = {
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	// When true, the confirm button uses the destructive (brown/red) styling.
	destructive?: boolean;
};

type ActiveRequest = ConfirmRequest & { resolve: (ok: boolean) => void };

export const confirmRequest = writable<ActiveRequest | null>(null);

export function confirmDialog(req: ConfirmRequest): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		// Resolve any in-flight request as cancelled before replacing it. In
		// practice all call sites await, so overlap shouldn't occur — this is
		// defensive.
		confirmRequest.update((prev) => {
			prev?.resolve(false);
			return { ...req, resolve };
		});
	});
}
