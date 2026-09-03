// Hand a fetched Blob to the browser as a file download. The standard
// pattern for authenticated downloads: a plain `<a href>` can't carry
// cookie auth, and the response needs to land under the right filename.
export function saveBlobAs(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}
