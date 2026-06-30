// Convert a CSS color — hex (#rgb or #rrggbb) or rgb()/rgba() — to an rgba()
// string at the given alpha. Use where a translucent color is needed but a
// flat ECharts `areaStyle.opacity` won't do: per-stop gradient colors (the
// military-power area fade) and CSS `linear-gradient()` stops (the H2H bars).
// Unknown formats pass through unchanged.
export function toRgba(color: string, alpha: number): string {
	if (color.startsWith("#")) {
		let hex = color.slice(1);
		if (hex.length === 3)
			hex = hex
				.split("")
				.map((c) => c + c)
				.join("");
		const n = parseInt(hex, 16);
		return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
	}
	const m = color.match(/rgba?\(([^)]+)\)/);
	if (m) {
		const [r, g, b] = m[1].split(",").map((x) => x.trim());
		return `rgba(${r},${g},${b},${alpha})`;
	}
	return color;
}
