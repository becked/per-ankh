// Pure functions for changelog entry generation. No I/O — `git.ts` handles
// shelling out and the `commands/changelog.ts` orchestrator wires the two
// together. Keeping the rendering pure makes it trivial to test or preview.

const REPO_URL = "https://github.com/becked/per-ankh";

const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

export interface Commit {
	sha: string;
	short: string;
	type: string | null;
	scope: string | null;
	breaking: boolean;
	subject: string;
}

export interface CommitGroups {
	features: Commit[];
	fixes: Commit[];
	performance: Commit[];
	other: Commit[];
}

// Parse one `git log --format='%H%x09%s'` line. Falls back to a typeless
// commit if the subject doesn't look conventional — we keep it in "Other"
// rather than dropping it, since the internal log values completeness.
export function parseCommit(line: string): Commit | null {
	const tabIdx = line.indexOf("\t");
	if (tabIdx < 0) return null;
	const sha = line.slice(0, tabIdx);
	const subject = line.slice(tabIdx + 1);
	if (sha.length === 0 || subject.length === 0) return null;
	const m = CONVENTIONAL.exec(subject);
	if (m) {
		return {
			sha,
			short: sha.slice(0, 7),
			type: m[1].toLowerCase(),
			scope: m[2] ?? null,
			breaking: m[3] === "!",
			subject: m[4],
		};
	}
	return {
		sha,
		short: sha.slice(0, 7),
		type: null,
		scope: null,
		breaking: false,
		subject,
	};
}

export function groupByType(commits: Commit[]): CommitGroups {
	const groups: CommitGroups = {
		features: [],
		fixes: [],
		performance: [],
		other: [],
	};
	for (const c of commits) {
		switch (c.type) {
			case "feat":
				groups.features.push(c);
				break;
			case "fix":
				groups.fixes.push(c);
				break;
			case "perf":
				groups.performance.push(c);
				break;
			default:
				groups.other.push(c);
		}
	}
	return groups;
}

function renderLine(c: Commit): string {
	const scope = c.scope ? `(${c.scope}) ` : "";
	const bang = c.breaking ? "**BREAKING** " : "";
	return `- ${bang}${scope}${c.subject} — [${c.short}](${REPO_URL}/commit/${c.sha})`;
}

export interface RenderArgs {
	stamp: string; // calver, e.g. "2026-05-19-512851d"
	date: string; // ISO date, e.g. "2026-05-19"
	groups: CommitGroups;
}

export function renderEntry({ stamp, date, groups }: RenderArgs): string {
	const lines: string[] = [`## [${stamp}] - ${date}`, ""];
	const sections: [string, Commit[]][] = [
		["Features", groups.features],
		["Fixes", groups.fixes],
		["Performance", groups.performance],
		["Other", groups.other],
	];
	for (const [title, items] of sections) {
		if (items.length === 0) continue;
		lines.push(`### ${title}`, "");
		for (const c of items) lines.push(renderLine(c));
		lines.push("");
	}
	return lines.join("\n");
}

// Insert a freshly rendered entry into the existing CHANGELOG. On the first
// run there's still an `## [Unreleased]` section from the desktop era — we
// strip it so the new entry becomes the topmost one. Subsequent runs are
// pure prepends.
export function prependToChangelog(existing: string, entry: string): string {
	const firstEntry = existing.search(/^## \[/m);
	if (firstEntry < 0) {
		// No entries yet — sit the new one right under the H1 title.
		return existing.replace(/^(# Changelog\s*\n)/m, (_, h) => `${h}\n${entry}`);
	}
	const header = existing.slice(0, firstEntry);
	let rest = existing.slice(firstEntry);
	if (/^## \[Unreleased\]/.test(rest)) {
		const regex = /^## \[/gm;
		regex.exec(rest); // skip past [Unreleased]
		const second = regex.exec(rest);
		rest = second ? rest.slice(second.index) : "";
	}
	return header + entry + "\n" + rest;
}
