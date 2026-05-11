// Pretty-printing primitives for the admin CLI: colored info/warn/error logs
// (to stderr), a fixed-width table renderer, and bytes/date helpers. All
// color codes disabled automatically when stdout isn't a TTY (piped output,
// CI, etc.).
//
// JSON output is the responsibility of the calling command — these helpers
// always emit human-readable text. In --json mode, commands skip printTable
// and write JSON.stringify(rows) to stdout instead.

const COLOR_OUT = process.stdout.isTTY;
const COLOR_ERR = process.stderr.isTTY;

const ESC = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
};

function wrap(code: string, s: string, color: boolean): string {
	return color ? `${code}${s}${ESC.reset}` : s;
}

export function bold(s: string): string {
	return wrap(ESC.bold, s, COLOR_OUT);
}
export function dim(s: string): string {
	return wrap(ESC.dim, s, COLOR_OUT);
}
export function red(s: string): string {
	return wrap(ESC.red, s, COLOR_OUT);
}
export function green(s: string): string {
	return wrap(ESC.green, s, COLOR_OUT);
}
export function yellow(s: string): string {
	return wrap(ESC.yellow, s, COLOR_OUT);
}

export function info(msg: string): void {
	process.stderr.write(`${wrap(ESC.blue, "[INFO]", COLOR_ERR)} ${msg}\n`);
}
export function ok(msg: string): void {
	process.stderr.write(`${wrap(ESC.green, "[OK]", COLOR_ERR)} ${msg}\n`);
}
export function warn(msg: string): void {
	process.stderr.write(`${wrap(ESC.yellow, "[WARN]", COLOR_ERR)} ${msg}\n`);
}
export function err(msg: string): void {
	process.stderr.write(`${wrap(ESC.red, "[ERROR]", COLOR_ERR)} ${msg}\n`);
}

export function formatBytes(bytes: number | null | undefined): string {
	if (bytes == null) return "0 B";
	if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(2) + " GB";
	if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1) + " MB";
	if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
	return `${bytes} B`;
}

// D1 timestamps come back as "2026-05-10 13:42:11" (datetime('now')) or
// occasionally ISO 8601 from the application. Slice to YYYY-MM-DD HH:MM.
export function formatDate(iso: string | null | undefined): string {
	if (!iso) return "—";
	return iso.slice(0, 16).replace("T", " ");
}

export function trunc(s: string, n: number): string {
	if (s.length <= n) return s;
	return s.slice(0, n - 1) + "…";
}

export function emdash(s: string | null | undefined): string {
	return s == null || s === "" ? "—" : s;
}

export interface Column {
	header: string;
	width: number;
	align?: "left" | "right";
}

function padCell(s: string, width: number, align: "left" | "right"): string {
	const t = trunc(s, width);
	return align === "right" ? t.padStart(width) : t.padEnd(width);
}

export function printTable(columns: Column[], rows: string[][]): void {
	const headerLine = columns
		.map((c) => padCell(c.header, c.width, c.align ?? "left"))
		.join("  ");
	process.stdout.write(`${bold(headerLine)}\n`);
	for (const row of rows) {
		const line = columns
			.map((c, i) => padCell(row[i] ?? "", c.width, c.align ?? "left"))
			.join("  ");
		process.stdout.write(`${line}\n`);
	}
}

export function printCount(n: number, noun: string): void {
	process.stdout.write(`\n${dim(`${n} ${noun}`)}\n`);
}

// Print a single-record detail view as aligned "label: value" lines. Used by
// `user <id>`, `game <id>`, `shares info <id>` etc.
export function printDetail(title: string, fields: [string, string][]): void {
	const labelWidth = Math.max(...fields.map(([k]) => k.length)) + 2;
	process.stdout.write(`\n${bold(title)}\n`);
	process.stdout.write(`${"─".repeat(33)}\n`);
	for (const [k, v] of fields) {
		process.stdout.write(`  ${(k + ":").padEnd(labelWidth)} ${v}\n`);
	}
	process.stdout.write("\n");
}
