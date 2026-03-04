import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const CHECK_TIMEOUT_MS = 10_000;

/**
 * Result of an update check.
 */
export interface UpdateCheckResult {
	available: boolean;
	update: Update | null;
	version: string | null;
	currentVersion: string | null;
}

/**
 * Check for application updates.
 * Returns update information if available, null values if up-to-date.
 * Times out after 10 seconds if GitHub is unreachable or slow.
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
	const update = await Promise.race([
		check(),
		new Promise<never>((_, reject) =>
			setTimeout(
				() =>
					reject(
						new Error("Update check timed out — GitHub may be unreachable"),
					),
				CHECK_TIMEOUT_MS,
			),
		),
	]);

	if (update) {
		return {
			available: true,
			update,
			version: update.version,
			currentVersion: update.currentVersion,
		};
	}

	return {
		available: false,
		update: null,
		version: null,
		currentVersion: null,
	};
}

/**
 * Download and install an update, then relaunch the application.
 *
 * @param update - The update object from checkForUpdates()
 * @param onProgress - Optional callback for download progress (0-100)
 * @param isCancelled - Optional callback checked before relaunching; if true, skips relaunch
 * @throws Error if download or installation fails
 */
export async function downloadAndInstall(
	update: Update,
	onProgress?: (percent: number) => void,
	isCancelled?: () => boolean,
): Promise<void> {
	let downloaded = 0;
	let contentLength = 0;

	await update.downloadAndInstall((event) => {
		switch (event.event) {
			case "Started":
				contentLength = event.data.contentLength ?? 0;
				break;
			case "Progress":
				downloaded += event.data.chunkLength;
				if (contentLength > 0 && onProgress) {
					onProgress(Math.round((downloaded / contentLength) * 100));
				}
				break;
			case "Finished":
				break;
		}
	});

	if (!isCancelled?.()) {
		await relaunch();
	}
}
