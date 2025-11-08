import { confirm, message } from "@tauri-apps/plugin-dialog";

/**
 * Show a confirmation dialog with consistent branding.
 * Uses "Confirm" as the default title.
 *
 * @param msg - The confirmation message to display
 * @param title - Optional custom title (defaults to "Confirm")
 * @returns Promise<boolean> - true if user confirmed, false if cancelled
 */
export async function showConfirm(
	msg: string,
	title: string = "Confirm"
): Promise<boolean> {
	return await confirm(msg, { title, kind: "warning" });
}

/**
 * Show a success message dialog with consistent branding.
 *
 * @param msg - The success message to display
 * @param title - Optional custom title (defaults to "Success")
 */
export async function showSuccess(
	msg: string,
	title: string = "Success"
): Promise<void> {
	await message(msg, { title, kind: "info" });
}

/**
 * Show an error message dialog with consistent branding.
 *
 * @param msg - The error message to display
 * @param title - Optional custom title (defaults to "Error")
 */
export async function showError(
	msg: string,
	title: string = "Error"
): Promise<void> {
	await message(msg, { title, kind: "error" });
}
