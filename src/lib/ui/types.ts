// Shared types for the ui/ design-system components.

export type SelectOption = {
	// "" is a legal value (used for placeholder / "all" entries).
	value: string;
	label: string;
	disabled?: boolean;
};

export type SelectGroup = {
	heading: string;
	options: SelectOption[];
};

export type SelectOptions = readonly SelectOption[] | readonly SelectGroup[];

export function isSelectGroup(
	entry: SelectOption | SelectGroup,
): entry is SelectGroup {
	return "options" in entry;
}
