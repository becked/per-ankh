// The promise around downscale-worker.ts. One picked file, one worker, one
// answer, then terminate — a screenshot upload is a single image the user is
// waiting on, so there is nothing for a long-lived worker to amortise, and a
// worker that outlives its answer is one more thing a cancelled picker has to
// remember to kill.
//
// The parse flows keep their worker instance on the component instead
// (UploadModal, BulkUploadModal) because they stream progress back and reuse
// the instance across a batch. This one has neither.

import DownscaleWorker from "./downscale-worker?worker";
import type { DownscaleMessage, DownscaleRequest } from "./downscale-worker";

export interface StoredVariant {
	// The bytes the upload sends and R2 stores.
	webp: Blob;
	width: number;
	height: number;
	sourceWidth: number;
	sourceHeight: number;
}

export class DownscaleFailure extends Error {
	constructor(
		message: string,
		public code: string,
	) {
		super(message);
		this.name = "DownscaleFailure";
	}
}

export function downscaleToStoredVariant(file: Blob): Promise<StoredVariant> {
	return new Promise<StoredVariant>((resolve, reject) => {
		const worker = new DownscaleWorker();
		worker.onmessage = (ev: MessageEvent<DownscaleMessage>) => {
			const msg = ev.data;
			worker.terminate();
			if (msg.type === "result") {
				resolve({
					webp: msg.webp,
					width: msg.width,
					height: msg.height,
					sourceWidth: msg.sourceWidth,
					sourceHeight: msg.sourceHeight,
				});
			} else {
				reject(new DownscaleFailure(msg.message, msg.code));
			}
		};
		// Fires for a worker that failed to load or threw outside the handler
		// — the handler's own throws come back as an error message above.
		// Without this the promise would never settle and the picker would sit
		// on "Preparing…" forever.
		worker.onerror = () => {
			worker.terminate();
			reject(
				new DownscaleFailure("Couldn't prepare that image", "WORKER_FAILED"),
			);
		};
		worker.postMessage({ type: "downscale", file } satisfies DownscaleRequest);
	});
}
