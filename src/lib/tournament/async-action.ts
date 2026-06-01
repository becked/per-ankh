import { invalidateAll } from "$app/navigation";
import { ApiError } from "$lib/api-cloud";
import { toast } from "$lib/ui/toast";

/**
 * Run a tournament mutation with the shared busy / toast / refresh skeleton
 * that every admin & player popover/form repeats: flip a busy flag, await the
 * API call, refresh the page data, surface a success toast, and turn any
 * ApiError into an error toast — always clearing busy in `finally`.
 *
 * Returns the operation's result on success, or `null` if it threw (so callers
 * can gate post-success work on `result !== null`). Component-specific cleanup
 * (resetting inputs, closing an editor, local refetch) stays in the caller.
 *
 * @param op       The async API call to run.
 * @param setBusy  Setter for the component's busy/saving `$state` flag.
 * @param success  Success toast text, or a fn deriving it from the result.
 *                 Omit for a silent success (no toast).
 * @param onError  Maps an ApiError to a custom message; falsy return falls back
 *                 to the default `message (CODE)` rendering.
 * @param failMessage Toast text for a non-ApiError (network/unexpected) failure.
 * @param refresh  Whether to `invalidateAll()` on success (default true).
 */
export async function runAction<T>(
	op: () => Promise<T>,
	{
		setBusy,
		success,
		onError,
		failMessage = "Action failed",
		refresh = true,
	}: {
		setBusy: (busy: boolean) => void;
		success?: string | ((result: T) => string);
		onError?: (err: ApiError) => string | void;
		failMessage?: string;
		refresh?: boolean;
	},
): Promise<T | null> {
	setBusy(true);
	try {
		const out = await op();
		if (success !== undefined) {
			toast.info(typeof success === "function" ? success(out) : success);
		}
		if (refresh) await invalidateAll();
		return out;
	} catch (err) {
		let message = failMessage;
		if (err instanceof ApiError) {
			message =
				onError?.(err) ?? err.message + (err.code ? ` (${err.code})` : "");
		}
		toast.error(message);
		return null;
	} finally {
		setBusy(false);
	}
}
