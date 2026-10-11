// Threshold eval for the screenshot upload gate (issue #289, build order step 2).
//
// Runs the local corpus in test-data/screenshots/ through Clef and prints the
// per-image probabilities, the band each question's probabilities support, and
// what the two model variants cost to run. Everything downstream — the upload
// endpoint's reject/review/accept decision, the admin queue's sort order —
// depends on these numbers, so this script is the one place they come from.
//
// CORPUS (local-only, gitignored): test-data/screenshots/, flat, one prefix
// per class — `oldworld-NN` for Old World screenshots, `photo-NN` for ordinary
// camera photographs. The prefix IS the label; there is no manifest. Its
// README explains why those are the only two classes, and why each question's
// band is derived differently.
//
// IT CLASSIFIES THE STORED VARIANT, NOT THE FILE ON DISK. Upload-path step 1
// downscales in the browser to 1600 px long edge capped at ~1.8 MP and
// re-encodes to WebP, and step 4 classifies the exact bytes that get stored,
// so the verdict binds the stored object. A band fitted on originals would be
// a band about images that are never stored — and most of this corpus cannot
// be sent raw anyway: Clef's limit is 8 MiB *decoded* per request and a Retina
// @2x capture blows through it on its own. The resize here is sharp's lanczos3
// against the browser's `resizeQuality: "high"`, which is the one part of the
// pipeline Node cannot reproduce exactly.
//
// WHICH DIRECTION A QUESTION RUNS DECIDES WHAT ITS BAND CAN BE:
//   contains_nsfw / contains_gore — reject direction, calibrated from
//     legitimate content alone. The review floor sits just above the highest
//     probability any passing oldworld- image reaches. The corpus cannot set
//     the auto-reject bound, because no illicit material is collected
//     (categorically so for CSAM), so that number is a policy choice above
//     the floor and this script reports the floor rather than inventing one.
//     These two are the ONLY one-sided questions: the other two have both
//     classes present, so all three outcomes are derivable for them.
//   is_a_photograph — reject direction with both classes present, so the
//     separation is measurable: porn and CSAM are photographs, which is what
//     makes this question the measurable proxy for the class that cannot be
//     assembled. Floor at the midpoint of the gap.
//   is_old_world — accept direction, and an accept threshold is not decidable
//     from positives alone: if every legitimate image scores >= 0.92 then 0.9,
//     0.5 and 0.01 all fit the corpus equally. It ships loose on purpose —
//     keeping other 4X titles out of the gallery is not what this gate is for,
//     and a loose floor is what stops odd crops being refused. The gap
//     measured here is against photographs, a far easier discrimination than
//     Civ-vs-Old-World, so the suggested floor sits a quarter of the way up it
//     rather than at the midpoint.
//   game_screenshot_confidence — not a gate at all. Stored on the row and used
//     to sort the admin queue, so it is reported, not thresholded.
//
// CLEF IS NOT DETERMINISTIC. Two runs over byte-identical inputs moved
// contains_gore's legitimate maximum by 0.034 and is_old_world's legitimate
// minimum by 0.187. Every band here is an extreme of a distribution, not a
// mean, so a single pass is optimistic by construction — and a band is only
// as good as the margin around it. `--repeat n` classifies each image n times
// and keeps, per question, the draw least favourable to the band it feeds;
// the margin is then the movement actually observed rather than a guessed
// cushion. One pass falls back to MIN_MARGIN and says so.
//
// The bands only transfer to production if production sends the same request,
// so the request is not written here: the state string, the five questions and
// the conjunctive gate are imported from cloud/src/screenshots/clef.ts, the
// module the upload endpoint calls Clef through. They are as much the output of
// this eval as the numbers are — editing a question there invalidates every
// band in it, and re-running this is how the new ones are found.
//
// AUTH: hits the Workers AI REST API with CLOUDFLARE_ACCOUNT_ID and
// CLOUDFLARE_AI_TOKEN (a token with Workers AI Read AND Edit — inference is
// an Edit operation), from the environment or the gitignored .env.
// `--dry-run` needs neither and makes no API call.
//
// Run: npm run eval:screenshots -- [--dry-run] [--model clef-flash] [--repeat 3] [--limit 2] [--json]

import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
	BAND_KIND,
	buildClefRequest,
	CLEF_MAX_DECODED_BYTES,
	CLEF_MAX_IMAGE_BYTES,
	gateVerdict,
	NOUL_IDS,
	QUESTIONS,
	readClefAnswers,
	SCORE_ID,
	STATE,
	type BandKind,
	type ClefAnswers,
	type ClefResult,
	type GateVerdict,
} from "../cloud/src/screenshots/clef";
import {
	MIN_LONG_EDGE,
	STORED_MAX_LONG_EDGE,
	STORED_MAX_PIXELS,
	STORED_WEBP_QUALITY,
	storedDimensions,
} from "../src/lib/screenshots/stored-variant";
import { flagInt, flagString, parseFlags, printJson } from "./lib/cli";
import {
	bold,
	dim,
	formatBytes,
	info,
	printTable,
	warn,
	type Column,
} from "./lib/format";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_DIR = resolve(REPO_ROOT, "test-data/screenshots");

// ─── The stored variant and the free pre-filter ─────────────────────────────
// Imported, not restated: what the browser's own re-encode produces (upload
// path step 1) and the floor the endpoint applies to it (step 3) are the same
// numbers this script's sharp mirror has to hit, or the bands below are a
// statement about bytes nothing stores. Why each number is what it is lives
// beside it in stored-variant.ts.
//
// The one part Node cannot reproduce is the resampler: sharp's lanczos3
// against the browser's `resizeQuality: "high"`.
//
// An image the gate already rejects must not contribute to a band, so the
// ones under MIN_LONG_EDGE are classified for information and excluded from
// the statistics.

// ─── Variants ───────────────────────────────────────────────────────────────
// The variant lives in two places — the model path and the body's required
// `model` field, which matches ^\s*(clef|clef-flash)\s*$ — so a swap moves
// both or the call 400s.
const VARIANTS = ["clef-flash", "clef"] as const;
type Variant = (typeof VARIANTS)[number];

// $ per million input tokens, from the model pages, read 2026-10-09. Clef
// bills input only; output tokens are free. Each image is capped at 1024
// tokens, so an upload's classification costs a fraction of a cent.
const PRICE_PER_M_INPUT: Record<Variant, number> = {
	"clef-flash": 0.038,
	clef: 0.24,
};

// ─── Response shapes ────────────────────────────────────────────────────────

// The REST envelope around the ClefResult the Workers AI binding returns
// directly. The result itself, and the narrowing of its answers, are shared
// with the Worker (readClefAnswers) so the two cannot disagree about what a
// malformed answer means.
interface ApiEnvelope {
	success: boolean;
	errors?: { code?: number; message?: string }[];
	result?: ClefResult;
}

// ─── Corpus ─────────────────────────────────────────────────────────────────

type ImageClass = "oldworld" | "photo";

interface CorpusImage {
	name: string;
	imageClass: ImageClass;
	srcWidth: number;
	srcHeight: number;
	srcBytes: number;
	// The stored variant: what upload-path step 4 classifies and R2 holds.
	width: number;
	height: number;
	bytes: number;
	webp: Buffer;
	// Does the stored variant clear the free pre-filter?
	passesFloor: boolean;
}

const CLASS_PREFIX: Record<ImageClass, string> = {
	oldworld: "oldworld-",
	photo: "photo-",
};

function classOf(name: string): ImageClass | null {
	for (const [cls, prefix] of Object.entries(CLASS_PREFIX)) {
		if (name.startsWith(prefix)) return cls as ImageClass;
	}
	return null;
}

async function loadCorpus(limit: number | null): Promise<CorpusImage[]> {
	const entries = (await readdir(CORPUS_DIR)).filter(
		(f) => classOf(f) !== null,
	);
	entries.sort();
	const images: CorpusImage[] = [];
	for (const name of entries) {
		if (limit != null && images.length >= limit) break;
		const path = resolve(CORPUS_DIR, name);
		const src = await readFile(path);
		const meta = await sharp(src).metadata();
		// autoOrient carries the dimensions after EXIF rotation is applied —
		// the camera photographs in this corpus can carry an orientation tag,
		// and the browser's createImageBitmap honours it too.
		const srcWidth = meta.autoOrient.width;
		const srcHeight = meta.autoOrient.height;
		// Upload-path step 1, in Node: the same target the browser worker
		// computes, from dimensions read the same way it reads them.
		const { width, height } = storedDimensions(srcWidth, srcHeight);
		const webp = await sharp(src)
			.autoOrient()
			.resize(width, height, { fit: "fill" })
			.webp({ quality: STORED_WEBP_QUALITY })
			.toBuffer();
		images.push({
			name,
			imageClass: classOf(name) as ImageClass,
			srcWidth,
			srcHeight,
			srcBytes: src.byteLength,
			width,
			height,
			bytes: webp.byteLength,
			webp,
			passesFloor: Math.max(width, height) >= MIN_LONG_EDGE,
		});
	}
	return images;
}

// ─── The Clef call ──────────────────────────────────────────────────────────

function requireEnv(name: string): string {
	const v = process.env[name];
	if (v == null || v.trim() === "") {
		throw new Error(
			`${name} is not set. The eval needs CLOUDFLARE_ACCOUNT_ID and a ` +
				`CLOUDFLARE_AI_TOKEN with Workers AI Read and Edit — in the environment or in ` +
				`.env (gitignored). Use --dry-run to check the resize pipeline without ` +
				`either.`,
		);
	}
	return v.trim();
}

const RETRY_DELAYS_MS = [1000, 2000, 4000];

async function classify(
	variant: Variant,
	image: CorpusImage,
	accountId: string,
	token: string,
): Promise<ClefResult> {
	const body = buildClefRequest(image.webp.toString("base64"), variant);
	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/cloudflare/${variant}`;
	let lastError = "";
	for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
		if (attempt > 0) {
			await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
		}
		let res: Response;
		try {
			res = await fetch(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});
		} catch (e) {
			lastError = e instanceof Error ? e.message : String(e);
			continue;
		}
		const text = await res.text();
		// 429 and 5xx are worth another attempt; a 400 or a 403 is the request
		// or the token and will fail the same way every time.
		if (res.status === 429 || res.status >= 500) {
			lastError = `HTTP ${res.status}: ${text.slice(0, 300)}`;
			continue;
		}
		if (!res.ok) {
			throw new Error(`${variant} ${image.name}: HTTP ${res.status}: ${text}`);
		}
		let envelope: ApiEnvelope;
		try {
			envelope = JSON.parse(text) as ApiEnvelope;
		} catch {
			throw new Error(
				`${variant} ${image.name}: response was not JSON: ${text.slice(0, 300)}`,
			);
		}
		if (!envelope.success || envelope.result == null) {
			const msg = (envelope.errors ?? [])
				.map((e) => `${e.code ?? "?"} ${e.message ?? ""}`.trim())
				.join("; ");
			throw new Error(`${variant} ${image.name}: ${msg || text.slice(0, 300)}`);
		}
		return envelope.result;
	}
	throw new Error(
		`${variant} ${image.name}: giving up after ${RETRY_DELAYS_MS.length + 1} attempts — ${lastError}`,
	);
}

// ─── Statistics ─────────────────────────────────────────────────────────────

// One Clef call's worth of answers for one image — the shape the Worker reads
// too, so a question added here is a question both sides must handle.
type Observation = ClefAnswers;

interface Row {
	name: string;
	imageClass: ImageClass;
	passesFloor: boolean;
	// The band-relevant aggregate over the repeats: per question, the
	// observation LEAST favourable to the band it feeds. Clef is not
	// deterministic, and every band here is an extreme of a distribution
	// rather than a mean, so a single draw is optimistic by construction.
	nouls: Record<string, number>;
	// Observed range per question across the repeats. This is what the margin
	// is set from — measured run-to-run movement instead of a guessed cushion.
	spread: Record<string, number>;
	score: number;
	scoreSpread: number;
	confidence: number;
	probabilities: Record<string, number>;
	// Summed across repeats; printCost divides back out per call.
	inputTokens: number;
	repeats: number;
}

// The draw that would widen the band or close the gap. A reject-direction
// question is endangered by the HIGHEST probability a legitimate image reaches
// (it pushes the review floor up) and by the LOWEST a photograph reaches (it
// closes the gap the auto-reject bound sits in); is_old_world runs the accept
// direction, so the two swap.
function worstCase(
	values: number[],
	question: string,
	imageClass: ImageClass,
): number {
	const acceptDirection = BAND_KIND[question] === "accept-loose";
	const takeMax =
		imageClass === "oldworld" ? !acceptDirection : acceptDirection;
	return takeMax ? Math.max(...values) : Math.min(...values);
}

function mean(values: number[]): number {
	return values.reduce((a, b) => a + b, 0) / values.length;
}

function range(values: number[]): number {
	return Math.max(...values) - Math.min(...values);
}

function buildRow(image: CorpusImage, observations: Observation[]): Row {
	const nouls: Record<string, number> = {};
	const spread: Record<string, number> = {};
	for (const id of NOUL_IDS) {
		const values = observations.map((o) => o.nouls[id]);
		nouls[id] = worstCase(values, id, image.imageClass);
		spread[id] = range(values);
	}
	const scores = observations.map((o) => o.score);
	return {
		name: image.name,
		imageClass: image.imageClass,
		passesFloor: image.passesFloor,
		nouls,
		spread,
		score: mean(scores),
		scoreSpread: range(scores),
		confidence: mean(observations.map((o) => o.confidence)),
		// The score's per-level probabilities are reported, not aggregated —
		// the last pass's are a real distribution, where an elementwise mean of
		// several would not be one.
		probabilities: observations[observations.length - 1].probabilities,
		inputTokens: observations.reduce((sum, o) => sum + o.inputTokens, 0),
		repeats: observations.length,
	};
}

interface ClassStats {
	n: number;
	min: number;
	median: number;
	max: number;
}

function stats(values: number[]): ClassStats | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return {
		n: sorted.length,
		min: sorted[0],
		median:
			sorted.length % 2 === 1
				? sorted[mid]
				: (sorted[mid - 1] + sorted[mid]) / 2,
		max: sorted[sorted.length - 1],
	};
}

// Round to the next hundredth, so a printed band is a number an operator can
// read off and type into a wrangler var. Rounding direction follows which way
// makes the band safer: up for a review floor, down for an auto-reject bound.
function ceilTo2(x: number): number {
	return Math.min(0.99, Math.ceil(x * 100) / 100);
}
function floorTo2(x: number): number {
	return Math.max(0.01, Math.floor(x * 100) / 100);
}
function round2(x: number): number {
	return Math.round(x * 100) / 100;
}

// The cushion between the extreme a legitimate image reached and the band set
// from it. Two clef-flash runs over byte-identical bytes moved contains_gore's
// legitimate maximum by 0.034 and is_old_world's minimum by 0.187, so a band
// placed exactly on one run's extreme is a lower bound on the band rather than
// the band. With --repeat the margin is the largest movement actually observed
// on that question; this is the floor under it, and what a single pass gets.
const MIN_MARGIN = 0.05;

function marginFor(question: string, rows: Row[]): number {
	const spreads = rows.map((r) => r.spread[question] ?? 0);
	return Math.max(MIN_MARGIN, ...spreads);
}

interface Band {
	question: string;
	kind: BandKind;
	rule: string;
	oldworld: ClassStats | null;
	photo: ClassStats | null;
	margin: number;
	// Crossing reviewAt routes an upload to the admin queue; crossing rejectAt
	// refuses it outright. Null means the corpus cannot set that bound —
	// which, for the two safety questions, is the whole point.
	reviewAt: number | null;
	rejectAt: number | null;
	note: string;
}

function deriveBand(question: string, rows: Row[]): Band {
	const kind = BAND_KIND[question];
	const margin = marginFor(question, rows);
	const ow = stats(
		rows
			.filter((r) => r.imageClass === "oldworld")
			.map((r) => r.nouls[question]),
	);
	const ph = stats(
		rows.filter((r) => r.imageClass === "photo").map((r) => r.nouls[question]),
	);
	const base = { question, kind, oldworld: ow, photo: ph, margin };

	if (kind === "accept-loose") {
		// Accept direction, and both classes are present, so all three outcomes
		// are derivable. The accept floor goes a quarter of the way up the gap
		// rather than at its midpoint: the gap measured here is against
		// photographs, a far easier discrimination than Civ-vs-Old-World, so a
		// midpoint would overstate how tight this can safely be. Keeping other
		// 4X titles out of the gallery is not what this gate is for, and a
		// loose floor is what stops odd crops being refused.
		const rule =
			"accept at max(photo) + 0.25 x gap (deliberately loose); reject at " +
			"or below max(photo) + margin";
		if (ow == null || ph == null) {
			return {
				...base,
				rule,
				reviewAt: null,
				rejectAt: null,
				note: "both classes needed",
			};
		}
		if (ph.max >= ow.min) {
			return {
				...base,
				rule,
				reviewAt: null,
				rejectAt: null,
				note: `classes OVERLAP (photo max ${ph.max.toFixed(3)} >= oldworld min ${ow.min.toFixed(3)}) — no bound separates them`,
			};
		}
		const reviewAt = round2(ph.max + 0.25 * (ow.min - ph.max));
		const rejectAt = floorTo2(ph.max + margin);
		return {
			...base,
			rule,
			reviewAt,
			rejectAt: rejectAt < reviewAt ? rejectAt : null,
			note:
				`gap ${(ow.min - ph.max).toFixed(3)}; margin ${margin.toFixed(3)}` +
				(rejectAt < reviewAt
					? ""
					: " — margin swallows the gap, so no auto-reject bound fits under the accept floor"),
		};
	}

	if (kind === "reject-separated") {
		// Reject direction with both classes present, so the separation is
		// measurable and all three outcomes are derivable. Porn and CSAM are
		// photographs, which is what makes this question the usable proxy for
		// the class that cannot be assembled.
		const rule =
			"review above the midpoint of the gap; reject at or above " +
			"min(photo) - margin";
		if (ow == null || ph == null) {
			return {
				...base,
				rule,
				reviewAt: null,
				rejectAt: null,
				note: "both classes needed",
			};
		}
		if (ph.min <= ow.max) {
			return {
				...base,
				rule,
				reviewAt: null,
				rejectAt: null,
				note: `classes OVERLAP (photo min ${ph.min.toFixed(3)} <= oldworld max ${ow.max.toFixed(3)}) — no bound separates them`,
			};
		}
		const reviewAt = round2((ow.max + ph.min) / 2);
		const rejectAt = ceilTo2(ph.min - margin);
		return {
			...base,
			rule,
			reviewAt,
			rejectAt: rejectAt > reviewAt ? rejectAt : null,
			note:
				`gap ${(ph.min - ow.max).toFixed(3)}; margin ${margin.toFixed(3)}` +
				(rejectAt > reviewAt
					? ""
					: " — margin swallows the gap, so no auto-reject bound fits above the review floor"),
		};
	}

	// contains_nsfw / contains_gore — one-sided by construction. No illicit
	// material is collected, categorically so for CSAM, so the corpus sets
	// where legitimate content ENDS and nothing more. The auto-reject bound
	// above that is a policy choice, and this eval declines to invent one:
	// a number with nothing measured behind it would read as derived.
	return {
		...base,
		rule: `review above max(oldworld) + margin (${margin.toFixed(3)}), rounded up`,
		reviewAt: ow == null ? null : ceilTo2(ow.max + margin),
		rejectAt: null,
		note:
			"one-sided: no auto-reject bound, because no illicit material is " +
			"collected and the corpus cannot say where the reject line goes",
	};
}

// The gate itself is the production one (cloud/src/screenshots/clef.ts), fed
// the bands derived above instead of the shipped ones — which is what makes
// the corpus outcome below a statement about the endpoint rather than about a
// second implementation of it.
type Verdict = GateVerdict;

// ─── Output ─────────────────────────────────────────────────────────────────

function pct(x: number): string {
	return x.toFixed(3);
}

function printCorpusTable(images: CorpusImage[]): void {
	process.stdout.write(`\n${bold("Corpus — source and stored variant")}\n`);
	const columns: Column[] = [
		{ header: "file", width: 16 },
		{ header: "class", width: 8 },
		{ header: "source", width: 11 },
		{ header: "dec MiB", width: 8, align: "right" },
		{ header: "stored", width: 11 },
		{ header: "MP", width: 5, align: "right" },
		{ header: "webp", width: 9, align: "right" },
		{ header: "floor", width: 6 },
	];
	printTable(
		columns,
		images.map((i) => [
			i.name,
			i.imageClass,
			`${i.srcWidth}x${i.srcHeight}`,
			((i.srcWidth * i.srcHeight * 4) / 1048576).toFixed(1),
			`${i.width}x${i.height}`,
			((i.width * i.height) / 1e6).toFixed(2),
			formatBytes(i.bytes),
			i.passesFloor ? "pass" : "REJECT",
		]),
	);
	const overBudget = images.filter(
		(i) => i.srcWidth * i.srcHeight * 4 > CLEF_MAX_DECODED_BYTES,
	);
	const storedOverBudget = images.filter(
		(i) => i.width * i.height * 4 > CLEF_MAX_DECODED_BYTES,
	);
	const tooBig = images.filter((i) => i.bytes > CLEF_MAX_IMAGE_BYTES);
	process.stdout.write(
		dim(
			`\n${images.length} images; dec MiB is w x h x 4 bytes, the decoded size Clef budgets. ` +
				`${overBudget.length} source file(s) exceed its 8 MiB decoded limit on their own ` +
				`and cannot be sent raw; ${storedOverBudget.length} stored variant(s) do.\n`,
		),
	);
	if (tooBig.length > 0) {
		warn(
			`${tooBig.length} stored variant(s) exceed Clef's 4 MiB per-image limit: ${tooBig.map((i) => i.name).join(", ")}`,
		);
	}
	const floorRejects = images.filter((i) => !i.passesFloor);
	if (floorRejects.length > 0) {
		process.stdout.write(
			dim(
				`${floorRejects.length} image(s) fail the ${MIN_LONG_EDGE} px long-edge pre-filter and are excluded from every band: ${floorRejects.map((i) => i.name).join(", ")}\n`,
			),
		);
	}
}

function printRows(variant: Variant, rows: Row[]): void {
	process.stdout.write(`\n${bold(`${variant} — per-image probabilities`)}\n`);
	const columns: Column[] = [
		{ header: "file", width: 16 },
		{ header: "class", width: 8 },
		...NOUL_IDS.map((id) => ({
			header: id.replace(/^(is|contains)_/, ""),
			width: 13,
			align: "right" as const,
		})),
		{ header: "score", width: 6, align: "right" },
		{ header: "conf", width: 6, align: "right" },
		{ header: "", width: 7 },
	];
	printTable(
		columns,
		rows.map((r) => [
			r.name,
			r.imageClass,
			...NOUL_IDS.map((id) => pct(r.nouls[id])),
			r.score.toFixed(2),
			r.confidence.toFixed(2),
			r.passesFloor ? "" : "excl.",
		]),
	);
	const repeats = rows[0]?.repeats ?? 1;
	if (repeats > 1) {
		process.stdout.write(
			dim(
				`\n  Each cell is the worst of ${repeats} passes for the band it feeds, ` +
					`not a single draw: the highest probability a reject-direction question ` +
					`reached on an oldworld- image, the lowest on a photo-, and the reverse ` +
					`for is_old_world. score and conf are means.\n`,
			),
		);
	}
}

function printBands(
	variant: Variant,
	bands: Band[],
	rows: Row[],
	repeats: number,
): void {
	process.stdout.write(`\n${bold(`${variant} — bands`)}\n`);
	const columns: Column[] = [
		{ header: "question", width: 18 },
		{ header: "oldworld min/med/max", width: 26 },
		{ header: "photo min/med/max", width: 26 },
		{ header: "review", width: 7, align: "right" },
		{ header: "reject", width: 7, align: "right" },
	];
	const fmt = (st: ClassStats | null): string =>
		st == null
			? "—"
			: `${pct(st.min)} ${pct(st.median)} ${pct(st.max)} (n=${st.n})`;
	printTable(
		columns,
		bands.map((b) => [
			b.question,
			fmt(b.oldworld),
			fmt(b.photo),
			b.reviewAt == null ? "—" : b.reviewAt.toFixed(2),
			b.rejectAt == null ? "—" : b.rejectAt.toFixed(2),
		]),
	);
	process.stdout.write("\n");
	for (const b of bands) {
		process.stdout.write(`  ${bold(b.question)} — ${b.rule}\n`);
		process.stdout.write(`    ${dim(b.note)}\n`);
	}
	// What the derived bounds do to the corpus they came from. The oldworld
	// class is the one that matters: a legitimate image sent to the queue is
	// the feature's own content being refused.
	const scored = rows.filter((r) => r.passesFloor);
	for (const cls of ["oldworld", "photo"] as ImageClass[]) {
		const of = scored.filter((r) => r.imageClass === cls);
		if (of.length === 0) continue;
		const byVerdict = (v: Verdict): Row[] =>
			of.filter((r) => gateVerdict(r.nouls, bands) === v);
		const parts = (["accept", "review", "reject"] as Verdict[]).map((v) => {
			const hit = byVerdict(v);
			return `${hit.length} ${v}${hit.length > 0 && v !== "accept" ? ` (${hit.map((r) => r.name).join(", ")})` : ""}`;
		});
		process.stdout.write(`\n  ${cls} (n=${of.length}): ${parts.join(", ")}`);
	}
	process.stdout.write("\n");
	if (repeats > 1) {
		printSpread(bands, scored, repeats);
	} else {
		process.stdout.write(
			dim(
				`\n  margin ${MIN_MARGIN} on every question — one pass measures no ` +
					`run-to-run movement, so this is the assumed floor rather than an ` +
					`observed spread. --repeat 3 or more measures it.\n`,
			),
		);
	}
}

// Clef is not deterministic, so the margin is only honest if it was measured.
// This is that measurement: per question, the largest per-image movement seen
// across the repeats, and which image moved that far.
function printSpread(bands: Band[], scored: Row[], repeats: number): void {
	process.stdout.write(
		`\n  ${bold(`spread across ${repeats} passes`)} — largest per-image movement, which is what set each margin\n`,
	);
	const columns: Column[] = [
		{ header: "question", width: 18 },
		{ header: "max spread", width: 11, align: "right" },
		{ header: "on", width: 16 },
		{ header: "median spread", width: 14, align: "right" },
		{ header: "margin used", width: 12, align: "right" },
	];
	printTable(
		columns,
		bands.map((b) => {
			const worst = scored.reduce((a, r) =>
				(r.spread[b.question] ?? 0) > (a.spread[b.question] ?? 0) ? r : a,
			);
			const med = stats(scored.map((r) => r.spread[b.question] ?? 0));
			return [
				b.question,
				pct(worst.spread[b.question] ?? 0),
				worst.name,
				med == null ? "—" : pct(med.median),
				b.margin.toFixed(3),
			];
		}),
	);
	const scoreWorst = scored.reduce((a, r) =>
		r.scoreSpread > a.scoreSpread ? r : a,
	);
	process.stdout.write(
		dim(
			`\n  ${SCORE_ID} moved at most ${scoreWorst.scoreSpread.toFixed(2)} levels (${scoreWorst.name}).\n`,
		),
	);
}

function printScoreSpread(variant: Variant, rows: Row[]): void {
	const byClass = (cls: ImageClass): string => {
		const s = stats(
			rows
				.filter((r) => r.passesFloor && r.imageClass === cls)
				.map((r) => r.score),
		);
		return s == null
			? "—"
			: `${s.min.toFixed(2)} / ${s.median.toFixed(2)} / ${s.max.toFixed(2)} (n=${s.n})`;
	};
	process.stdout.write(
		`\n  ${bold(SCORE_ID)} min/med/max — oldworld ${byClass("oldworld")}, photo ${byClass("photo")}\n` +
			`    ${dim(`${SCORE_ID} is not a gate: it is stored on the row to sort the admin queue. ${variant} returns a probability-weighted level, so it can land between levels.`)}\n`,
	);
}

function printCost(variant: Variant, rows: Row[], repeats: number): void {
	const tokens = rows.reduce((sum, r) => sum + r.inputTokens, 0);
	const calls = rows.length * repeats;
	// Per CALL, not per image — an upload is classified once, however many
	// passes this eval made over the same bytes.
	const perCall = calls > 0 ? tokens / calls : 0;
	const dollars = (tokens / 1e6) * PRICE_PER_M_INPUT[variant];
	process.stdout.write(
		`\n  ${bold("cost")} — ${tokens} input tokens over ${calls} calls ` +
			`(${rows.length} images x ${repeats} pass${repeats === 1 ? "" : "es"}, ${perCall.toFixed(0)}/call) ` +
			`at $${PRICE_PER_M_INPUT[variant]}/M = $${dollars.toFixed(5)} for this run; ` +
			`$${((perCall / 1e6) * PRICE_PER_M_INPUT[variant] * 1000).toFixed(4)} per 1000 uploads.\n`,
	);
}

// ─── Main ───────────────────────────────────────────────────────────────────

function printHelp(): void {
	process.stdout.write(
		[
			"eval-screenshot-classifier — set the Clef bands for the screenshot upload gate",
			"",
			"Usage:",
			"  npm run eval:screenshots -- [flags]",
			"",
			"Flags:",
			"  --dry-run          Build the stored variants and print the corpus table only.",
			"                     Makes no API call and needs no credentials.",
			`  --model <variant>  Run one variant (${VARIANTS.join(" | ")}). Default: both.`,
			"  --limit <n>        Only the first n images, sorted by filename. Use 1 or 2",
			"                     to check the call shape before spending on the full run.",
			"  --repeat <n>       Classify every image n times and take, per question, the",
			"                     draw least favourable to the band. Clef is not",
			"                     deterministic, so one pass understates every bound; with",
			"                     n > 1 the margin is the movement measured rather than a",
			"                     guessed cushion. Costs n x the run. Default: 1.",
			"  --json             Emit the whole result as JSON instead of tables.",
			"  --help             This.",
			"",
			`Corpus: ${CORPUS_DIR.replace(REPO_ROOT + "/", "")} (gitignored; see its README).`,
			"Credentials: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN (Workers AI Read + Edit).",
			"",
		].join("\n"),
	);
}

async function main(): Promise<void> {
	const { flags } = parseFlags(process.argv.slice(2));
	if (flags.help === true) {
		printHelp();
		return;
	}
	const dryRun = flags["dry-run"] === true;
	const asJson = flags.json === true;
	let limit: number | null = null;
	if (flags.limit !== undefined) {
		limit = flagInt(flags, "limit", 0);
		if (limit <= 0) throw new Error("--limit takes a positive integer");
	}
	let repeats = 1;
	if (flags.repeat !== undefined) {
		repeats = flagInt(flags, "repeat", 0);
		if (repeats <= 0) throw new Error("--repeat takes a positive integer");
	}
	const only = flagString(flags, "model");
	if (only != null && !VARIANTS.includes(only as Variant)) {
		throw new Error(
			`--model must be one of ${VARIANTS.join(", ")} (got ${only})`,
		);
	}
	const variants: Variant[] = only == null ? [...VARIANTS] : [only as Variant];

	const images = await loadCorpus(limit);
	if (images.length === 0) {
		throw new Error(
			`no oldworld-* or photo-* images in ${CORPUS_DIR}. The corpus is ` +
				`gitignored and a fresh clone starts empty — see its README.`,
		);
	}
	const counts = { oldworld: 0, photo: 0 };
	for (const i of images) counts[i.imageClass]++;
	info(
		`${images.length} images (${counts.oldworld} oldworld, ${counts.photo} photo) downscaled to the stored variant`,
	);
	if (!asJson) printCorpusTable(images);

	if (dryRun) {
		if (asJson) {
			printJson({
				dryRun: true,
				stored: {
					maxLongEdge: STORED_MAX_LONG_EDGE,
					maxPixels: STORED_MAX_PIXELS,
					webpQuality: STORED_WEBP_QUALITY,
				},
				images: images.map(({ webp: _webp, ...rest }) => rest),
			});
		}
		return;
	}

	const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
	const token = requireEnv("CLOUDFLARE_AI_TOKEN");

	const perVariant: {
		variant: Variant;
		rows: Row[];
		bands: Band[];
		repeats: number;
	}[] = [];
	for (const variant of variants) {
		const observations = new Map<string, Observation[]>();
		for (let pass = 1; pass <= repeats; pass++) {
			for (const [idx, image] of images.entries()) {
				const of = repeats > 1 ? ` pass ${pass}/${repeats}` : "";
				info(`${variant}${of} ${idx + 1}/${images.length} ${image.name}`);
				const result = await classify(variant, image, accountId, token);
				const list = observations.get(image.name) ?? [];
				list.push(readClefAnswers(result, `${variant} ${image.name}`));
				observations.set(image.name, list);
			}
		}
		const rows = images.map((image) =>
			buildRow(image, observations.get(image.name) as Observation[]),
		);
		// Bands are derived only over images the free pre-filter admits — a band
		// fitted on an image the gate already rejects is a band about nothing.
		const scored = rows.filter((r) => r.passesFloor);
		const bands = NOUL_IDS.map((id) => deriveBand(id, scored));
		perVariant.push({ variant, rows, bands, repeats });
	}

	if (asJson) {
		printJson({
			corpus: images.map(({ webp: _webp, ...rest }) => rest),
			request: { state: STATE, questions: QUESTIONS },
			variants: perVariant,
		});
		return;
	}
	for (const { variant, rows, bands } of perVariant) {
		printRows(variant, rows);
		printBands(variant, bands, rows, repeats);
		printScoreSpread(variant, rows);
		printCost(variant, rows, repeats);
	}
}

await main();
