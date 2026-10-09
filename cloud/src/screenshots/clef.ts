// The Clef request the screenshot upload gate sends, and the decision it makes
// from the answer (issue #289).
//
// This module is the one copy of the request. The threshold eval
// (scripts/eval-screenshot-classifier.ts) imports STATE, QUESTIONS and
// gateVerdict from here rather than restating them, because a band only
// transfers to production if production asks the same question: the numbers in
// BANDS were fitted against this exact state string, these exact criteria and
// this exact model variant, over the corpus in test-data/screenshots/. Editing
// a question or swapping the variant invalidates every number below, so the
// two move together or the eval is re-run (`npm run eval:screenshots --
// --repeat 3`).
//
// The eval also owns the derivation. Which direction each question runs, and
// therefore what its corpus can and cannot say, is argued there; the short
// version is in BANDS.

// The variant lives in TWO places — the model path and the body's required
// `model` field, which matches ^\s*(clef|clef-flash)\s*$ — so a swap has to
// move both or the call 400s. Derived here rather than written twice, which is
// what makes that one edit instead of two.
//
// `clef` is the 27B model at $0.24 per M input tokens; `clef-flash` is the 9B
// sibling at $0.038, same request shape. The eval picked the 27B and not on
// price: under clef-flash the load-bearing is_old_world gate is noisier than
// the margin it needs (0.187 of run-to-run movement against a class gap of
// 0.163), so no auto-reject bound fits under its accept floor at all. Under
// clef the same question moves 0.074 against a gap of 0.611. At this volume
// the 5-per-game cap bounds lifetime classification at $2.07 either way.
export const CLEF_VARIANT = "clef";
export const CLEF_MODEL = `@cf/cloudflare/${CLEF_VARIANT}` as const;

// Clef's per-request image limits: 4 MiB encoded and 8 MiB DECODED, the
// second of which is the binding one. Decoded RGBA bites on non-16:9 shapes —
// 1920x1080 decodes to 7.91 MiB and squeaks under, 1920x1200 on a 16:10
// display is 8.79 MiB and over — so the ceiling the upload endpoint enforces
// is on pixel count, not on the long edge.
export const CLEF_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const CLEF_MAX_DECODED_BYTES = 8 * 1024 * 1024;

// Images are placed before the state, so the questions can refer to "the
// attached image". The last sentence of the state is load-bearing: without it
// the context ("a gallery of game screenshots") primes a yes on the one
// question that is the gate's allowlist.
export const STATE =
	"The attached image was submitted by a user to a public Old World fan site, " +
	"to be published in a gallery of game screenshots. Answer each question " +
	"about the attached image. Nothing about the submission says what the image " +
	"actually contains.";

export interface NoulQuestion {
	type: "noul";
	instructions: string;
	criteria: { true: string; false: string };
}
export interface ScoreQuestion {
	type: "score";
	instructions: string;
	criteria: string[];
}

// Four nouls and one score, one forward pass. The bands are conjunctive: a
// high is_old_world must never relax the safety questions, because the gate
// screens for inappropriate content rather than identifying the game, and
// Clef runs one pass over the whole image without localizing — so confidence
// that the game is present says nothing about what else is in frame.
export const NOUL_QUESTIONS: Record<string, NoulQuestion> = {
	// The load-bearing gate. A positive requirement is an allowlist: anything
	// that isn't the game fails it regardless of what it is. Narrow on purpose
	// — the other 4X titles named below should fail.
	is_old_world: {
		type: "noul",
		instructions:
			"Is the attached image a screenshot of the turn-based strategy game Old World by Mohawk Games?",
		criteria: {
			true:
				"The image shows Old World itself — its hex-tile map, its city, unit or " +
				"character art, its yield and resource icons, its tech tree, a council or " +
				"event popup, or any other part of its interface — including a crop or a " +
				"zoomed-in detail of any of those.",
			false:
				"Anything else. A screenshot of a different strategy game — Civilization, " +
				"Humankind, Total War, Stellaris, Age of Wonders — is a no, as is any image " +
				"that is not a screenshot of Old World at all.",
		},
	},
	// Reject direction. The carve-out is what keeps the band tight: Old World's
	// own portrait and event art is painted classical imagery, and without the
	// false criterion the legitimate maximum — which IS the band — drifts up.
	contains_nsfw: {
		type: "noul",
		instructions:
			"Does the attached image contain sexual or pornographic content?",
		criteria: {
			true:
				"Sexual activity, pornography, exposed genitals or breasts, or imagery " +
				"whose purpose is sexual arousal.",
			false:
				"No such content. A historical strategy game's own painted portrait or " +
				"event illustration — classical statuary, a draped or partially draped " +
				"figure — is not sexual content.",
		},
	},
	// Reject direction, and nothing had to be collected for it: Old World is
	// map-based with no battle screen, so warfare is units resolving on the hex
	// map and is already in the corpus. The band is the maximum the oldworld-
	// images reach.
	contains_gore: {
		type: "noul",
		instructions: "Does the attached image contain gore?",
		criteria: {
			true:
				"Graphic injury or death shown realistically: open wounds, mutilation, " +
				"dismemberment, blood, or a corpse.",
			false:
				"No such content. A strategy game's own stylised depiction of warfare — " +
				"armies or units facing each other on a map, a weapon or a siege engine, a " +
				"battle result in a text popup, a death reported in words — is not gore.",
		},
	},
	// The measurable proxy for the class that cannot be assembled. The photo-of
	// -a-screen case is deliberately a yes: it is the adversarial edge between
	// this question and is_old_world, and the gate wants it caught here.
	is_a_photograph: {
		type: "noul",
		instructions: "Is the attached image a photograph taken with a camera?",
		criteria: {
			true:
				"A camera photograph of the physical world — people, places, animals, " +
				"objects, food — including a photograph taken of a screen, monitor or " +
				"television that is displaying something else.",
			false:
				"A screen capture, a rendered image, a digital illustration, a drawing, a " +
				"diagram or a document.",
		},
	},
};

export const SCORE_ID = "game_screenshot_confidence";

// Ordered lowest-first; levels are indexed from 0. Not a gate — the score and
// its per-level probabilities are stored on the row so the admin queue can be
// sorted by how plausible a screenshot is.
export const SCORE_QUESTION: ScoreQuestion = {
	type: "score",
	instructions:
		"How confidently is the attached image a screenshot of Old World?",
	criteria: [
		"Not a screen capture at all — a photograph, a drawing, or a document.",
		"A screen capture, but of something other than Old World — a different game, a web page, or an application.",
		"Possibly Old World, but too small, too blurry or too tightly cropped to tell.",
		"Recognisably Old World — a crop or a detail of its map, interface or art.",
		"Unmistakably Old World — its hex map or main interface, clearly legible.",
	],
};

export const QUESTIONS: Record<string, NoulQuestion | ScoreQuestion> = {
	...NOUL_QUESTIONS,
	[SCORE_ID]: SCORE_QUESTION,
};

export const NOUL_IDS = Object.keys(NOUL_QUESTIONS);

// Remote URLs are not accepted, so the bytes travel in the call. A plain
// object type rather than an interface: the AI binding's unknown-model
// overload takes Record<string, unknown>, which an interface does not satisfy.
export type ClefRequest = {
	model: string;
	state: string;
	questions: Record<string, NoulQuestion | ScoreQuestion>;
	images: { content_type: string; base64: string }[];
};

// `variant` is a parameter only because the eval compares both models over
// the same corpus; the upload path takes the default and never passes one.
export function buildClefRequest(
	imageBase64: string,
	variant: string = CLEF_VARIANT,
): ClefRequest {
	return {
		model: variant,
		state: STATE,
		questions: QUESTIONS,
		images: [{ content_type: "image/webp", base64: imageBase64 }],
	};
}

// ─── Response ───────────────────────────────────────────────────────────────

// A `noul` answer is { type: "noul", noul: <0-1> }. A `score` answer carries a
// probability-weighted LEVEL that can land between levels rather than a
// probability, plus the per-level probabilities a calibrated band would have
// to be taken from. `confidence` exists on score and choice answers, not on
// noul.
export interface NoulAnswer {
	type: "noul";
	noul: number;
}
export interface ScoreAnswer {
	type: "score";
	score: number;
	legend: Record<string, unknown>;
	probabilities: Record<string, number>;
	confidence: number;
}
export type ClefAnswer = NoulAnswer | ScoreAnswer;

export interface ClefResult {
	model: string;
	answers: Record<string, ClefAnswer>;
	usage: { input_tokens: number; output_tokens: number };
}

// One call's worth of answers for one image.
export interface ClefAnswers {
	nouls: Record<string, number>;
	score: number;
	confidence: number;
	probabilities: Record<string, number>;
	inputTokens: number;
}

// Pull the typed answers out of a response, failing loudly rather than
// coercing. A missing or wrongly-typed answer means the request and the bands
// have drifted apart, which is exactly the thing that must not pass silently —
// and on the upload path a throw here is what makes the gate fail closed.
export function readClefAnswers(result: unknown, label = "clef"): ClefAnswers {
	if (result == null || typeof result !== "object") {
		throw new Error(`${label}: response was not an object`);
	}
	const { answers, usage } = result as Partial<ClefResult>;
	if (answers == null || typeof answers !== "object") {
		throw new Error(`${label}: response carried no answers`);
	}
	const nouls: Record<string, number> = {};
	for (const id of NOUL_IDS) {
		const answer = answers[id];
		if (
			answer == null ||
			answer.type !== "noul" ||
			typeof answer.noul !== "number"
		) {
			throw new Error(
				`${label}: expected a noul answer for ${id}, got ${JSON.stringify(answer)}`,
			);
		}
		nouls[id] = answer.noul;
	}
	const score = answers[SCORE_ID];
	if (
		score == null ||
		score.type !== "score" ||
		typeof score.score !== "number" ||
		score.probabilities == null
	) {
		throw new Error(
			`${label}: expected a score answer for ${SCORE_ID}, got ${JSON.stringify(score)}`,
		);
	}
	return {
		nouls,
		score: score.score,
		confidence: score.confidence,
		probabilities: score.probabilities,
		inputTokens: usage?.input_tokens ?? 0,
	};
}

// ─── Bands ──────────────────────────────────────────────────────────────────

// Which band each question feeds, which is also which direction it runs. The
// eval's derivation and the gate below both read this, so the two cannot
// disagree about which end of a distribution is the dangerous one.
export type BandKind =
	"reject-legit-only" | "reject-separated" | "accept-loose";

export const BAND_KIND: Record<string, BandKind> = {
	is_old_world: "accept-loose",
	contains_nsfw: "reject-legit-only",
	contains_gore: "reject-legit-only",
	is_a_photograph: "reject-separated",
};

// Crossing reviewAt routes an upload to the admin queue; crossing rejectAt
// refuses it outright. Null means the corpus cannot set that bound — which,
// for the two safety questions, is the whole point.
export interface GateBand {
	question: string;
	kind: BandKind;
	reviewAt: number | null;
	rejectAt: number | null;
}

export type GateVerdict = "accept" | "review" | "reject";

// What the conjunctive gate does to an image. Bands never compensate: a high
// is_old_world must not relax the safety questions, so any one question
// rejecting ends it and any one flagging downgrades to the queue.
export function gateVerdict(
	nouls: Record<string, number>,
	bands: readonly GateBand[],
): GateVerdict {
	let verdict: GateVerdict = "accept";
	for (const band of bands) {
		const p = nouls[band.question];
		if (band.kind === "accept-loose") {
			if (band.rejectAt != null && p <= band.rejectAt) return "reject";
			if (band.reviewAt != null && p < band.reviewAt) verdict = "review";
		} else {
			if (band.rejectAt != null && p >= band.rejectAt) return "reject";
			if (band.reviewAt != null && p >= band.reviewAt) verdict = "review";
		}
	}
	return verdict;
}

// Which question sent an upload where. The refusal names it and so does the
// queue row, because "rejected" without the question is unactionable for
// anyone — the uploader reading the error or the admin reading the queue.
export function trippedQuestions(
	nouls: Record<string, number>,
	bands: readonly GateBand[],
	verdict: GateVerdict,
): string[] {
	if (verdict === "accept") return [];
	return bands
		.filter((band) => gateVerdict(nouls, [band]) === verdict)
		.map((band) => band.question);
}

// THE SHIPPED BANDS. Set by the step-2 eval on `clef`, over the 17 corpus
// images that clear the pre-filter and 8 photographs, worst-of-3-passes per
// question — and a band is only meaningful alongside the pass count that
// produced it, because each new pass can only push an extreme further out.
//
//   question          legitimate min/med/max   photo min/med/max       margin
//   is_old_world      0.647 / 0.800 / 0.837    0.023 / 0.029 / 0.037   0.074
//   contains_nsfw     0.014 / 0.025 / 0.038    0.016 / 0.018 / 0.023   0.050
//   contains_gore     0.021 / 0.031 / 0.058    0.022 / 0.025 / 0.170   0.067
//   is_a_photograph   0.025 / 0.036 / 0.053    0.839 / 0.945 / 0.963   0.050
//
// At these bounds the corpus comes out 17/17 legitimate images auto-accepted
// and 8/8 photographs auto-rejected, none queued.
//
// Why these are code constants rather than wrangler vars, unlike the rate and
// read ceilings: a band is fitted to the question text and the model variant
// above, and only a deploy can move all three together. A var that outlived a
// question edit would be a band about a question no longer asked.
export const BANDS: readonly GateBand[] = [
	{
		// The accept direction, and an accept threshold is not decidable from
		// positives alone — if every legitimate image scores >= 0.92 then 0.9,
		// 0.5 and 0.01 all fit the corpus equally. Deliberately loose: keeping
		// other 4X titles out of the gallery is not what this gate is for, and
		// a loose floor is what stops odd crops being refused.
		question: "is_old_world",
		kind: "accept-loose",
		reviewAt: 0.19,
		rejectAt: 0.11,
	},
	{
		// One-sided. No illicit material is collected, categorically so for
		// CSAM, so the corpus says where legitimate content ENDS and nothing
		// about where a reject line would go. A review floor and no ceiling:
		// the number above it would be a policy choice, and must not be
		// printed as though it were derived.
		question: "contains_nsfw",
		kind: "reject-legit-only",
		reviewAt: 0.09,
		rejectAt: null,
	},
	{
		// One-sided for the same reason. Note the highest contains_gore
		// probability anywhere in the corpus is on a photograph (0.170), not
		// on a battle screenshot — the band is unaffected, since it comes from
		// legitimate images only, but the question is reading something other
		// than game combat.
		question: "contains_gore",
		kind: "reject-legit-only",
		reviewAt: 0.13,
		rejectAt: null,
	},
	{
		// Both classes present, so the separation is measurable and an
		// auto-reject bound fits inside it: an ordinary photograph is refused
		// outright rather than queued. This is the measurable proxy for the
		// class that cannot be assembled, since porn and CSAM are photographs.
		question: "is_a_photograph",
		kind: "reject-separated",
		reviewAt: 0.45,
		rejectAt: 0.79,
	},
];
