import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

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
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
	const update = await check();

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
 * @throws Error if download or installation fails
 */
export async function downloadAndInstall(
	update: Update,
	onProgress?: (percent: number) => void,
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

	await relaunch();
}
