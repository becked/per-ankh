// Focus the element on mount, and (for inputs) select the existing value so
// the user can type to overwrite or arrow-key to position. Pairs naturally
// with toggle-to-edit UIs like SlotUsernameCell.

export function autofocus(node: HTMLElement): { destroy(): void } {
	node.focus();
	if (node instanceof HTMLInputElement) node.select();
	return { destroy() {} };
}
