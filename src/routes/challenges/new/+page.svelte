<script lang="ts">
	// Create a challenge: drop the turn-1 save, check it's a valid map, read
	// its setup, write the rules, post. The parse runs in the parser Worker
	// like /upload; the map validation and setup extraction are the same
	// functions the Worker re-runs on receipt, so what the creator sees is
	// what gets stored.
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { ApiError, cloudApi, type CreateChallengeMeta } from "$lib/api-cloud";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import { describeSetup } from "$lib/challenges/describe";
	import RulesEditor from "$lib/challenges/RulesEditor.svelte";
	import {
		asScorable,
		extractSetup,
		validateChallengeMap,
	} from "$lib/challenges/scoring";
	import {
		DEFAULT_CHALLENGE_DAYS,
		STANDARD_CRITERIA,
		type ChallengeSetup,
		type Criterion,
		type Objective,
	} from "$lib/challenges/types";
	import Breadcrumb from "$lib/Breadcrumb.svelte";
	import { keepFirstSeat, scrubIdentity } from "$lib/challenges/strip-seats";
	import ParserWorker from "$lib/parser/worker?worker";
	import { extractXmlFromZip } from "$lib/parser/extract-zip";
	import {
		gzipJson,
		ParseFailure,
		parseSaveFile,
	} from "$lib/parser/upload-helpers";
	import { INPUT_CLASS, PRIMARY_BTN } from "$lib/ui/classes";
	import { toast } from "$lib/ui/toast";
	import { formatEnum } from "$lib/utils/formatting";
	import { strToU8, zipSync } from "fflate";

	type MapState =
		| { kind: "empty" }
		| { kind: "parsing"; fileName: string; phase: string; percent: number }
		| {
				kind: "invalid";
				fileName: string;
				problems: string[];
				/** Set when the save is a solo map plus extra seats — the fix is one click. */
				extraSeats?: { rawZip: ArrayBuffer; seats: string[] };
		  }
		| {
				kind: "ready";
				fileName: string;
				setup: ChallengeSetup;
				gzippedData: Blob;
				rawZip: Blob;
				/** The AI seat, when the map has one and the creator may want it gone. */
				extraSeats?: { rawZip: ArrayBuffer; seats: string[] };
		  };

	let map = $state<MapState>({ kind: "empty" });
	let worker: Worker | null = null;
	$effect(() => () => {
		worker?.terminate();
		worker = null;
	});

	let title = $state("");
	let description = $state("");
	let durationDays = $state(DEFAULT_CHALLENGE_DAYS);
	let objectives = $state<Objective[]>([]);
	let criteria = $state<Criterion[]>(
		structuredClone(STANDARD_CRITERIA) as Criterion[],
	);
	let busy = $state(false);

	const canSubmit = $derived(
		map.kind === "ready" &&
			title.trim().length > 0 &&
			objectives.length > 0 &&
			durationDays >= 1 &&
			!busy,
	);

	async function onPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = "";
		if (!file) return;
		await load(await file.arrayBuffer(), file.name);
	}

	async function load(buffer: ArrayBuffer, fileName: string) {
		worker ??= new ParserWorker();
		// Rules describe a map: keep them when the same map is reloaded (seat
		// stripping re-runs load), start over when a different one replaces it.
		const previousId = map.kind === "ready" ? map.setup.xml_game_id : null;
		map = { kind: "parsing", fileName, phase: "Starting", percent: 0 };
		try {
			// The map is a public download, so the creator's identity comes off
			// before anything else reads it — the stored ZIP and the parsed
			// blob then agree.
			const xml = extractXmlFromZip(buffer);
			const scrubbed = scrubIdentity(xml);
			if (scrubbed !== xml) buffer = rezip(fileName, scrubbed);
			const { data, rawZip } = await parseSaveFile(
				buffer,
				fileName,
				worker,
				(phase, percent) => {
					if (map.kind === "parsing") map = { ...map, phase, percent };
				},
				// A map is turn 1 by definition — the completed-game rule is the
				// one thing a challenge upload must not enforce.
				{ requireCompleted: false },
			);
			const blob = asScorable(data);
			const problems = validateChallengeMap(blob);
			// Every seat after the first can be stripped, so a hotseat map (or
			// one with an AI) is one click from a solo map — provided the first
			// seat is the creator's.
			const roster = blob.player_roster;
			const extraSeats =
				roster.length > 1 && roster[0].is_human
					? {
							rawZip,
							seats: roster.slice(1).map((seat) => {
								const details = blob.game_details.players.find(
									(p) => p.player_id === seat.player_index,
								);
								const nation = seat.nation
									? formatEnum(seat.nation, "NATION_")
									: "no nation yet";
								return `${details?.player_name || `Seat ${seat.player_index + 1}`} (${nation}, ${seat.is_human ? "human" : "AI"})`;
							}),
						}
					: undefined;
			if (problems.length > 0) {
				map = { kind: "invalid", fileName, problems, extraSeats };
				return;
			}
			const setup = extractSetup(blob);
			if (previousId != null && previousId !== setup.xml_game_id) {
				objectives = [];
				criteria = structuredClone(STANDARD_CRITERIA) as Criterion[];
			}
			map = {
				kind: "ready",
				fileName,
				setup,
				gzippedData: await gzipJson(data),
				rawZip: new Blob([rawZip], { type: "application/zip" }),
				extraSeats,
			};
		} catch (err) {
			const message =
				err instanceof ParseFailure
					? `${err.code}: ${err.message}`
					: err instanceof Error
						? err.message
						: "Parse failed";
			map = { kind: "invalid", fileName, problems: [message] };
		}
	}

	/** A save ZIP holding `xml` as its one entry, named after the upload. */
	function rezip(fileName: string, xml: string): ArrayBuffer {
		const entry = fileName.replace(/\.zip$/i, "") + ".xml";
		const zipped = zipSync({ [entry]: strToU8(xml) });
		return zipped.buffer.slice(
			zipped.byteOffset,
			zipped.byteOffset + zipped.byteLength,
		) as ArrayBuffer;
	}

	// Rewrite the save without its extra seats and load the result as the
	// map — it's the file everyone downloads, so the creator gets it too.
	async function stripSeats() {
		if (map.kind !== "invalid" && map.kind !== "ready") return;
		const extra = map.extraSeats;
		if (!extra) return;
		const fileName = map.fileName;
		map = { kind: "parsing", fileName, phase: "Removing seats", percent: 0 };
		try {
			const xml = keepFirstSeat(extractXmlFromZip(extra.rawZip));
			await load(rezip(fileName, xml), fileName);
		} catch (err) {
			map = {
				kind: "invalid",
				fileName,
				problems: [err instanceof Error ? err.message : "Strip failed"],
			};
		}
	}

	async function submit() {
		if (map.kind !== "ready" || !canSubmit) return;
		busy = true;
		try {
			const meta: CreateChallengeMeta = {
				title: title.trim(),
				description: description.trim() || undefined,
				duration_days: durationDays,
				objectives: $state.snapshot(objectives),
				criteria: $state.snapshot(criteria),
			};
			const form = new FormData();
			form.append("meta", JSON.stringify(meta));
			form.append("data", map.gzippedData, "data.json.gz");
			form.append("save", map.rawZip, map.fileName);
			const { challenge } = await cloudApi.createChallenge(form);
			await goto(
				resolve("/challenges/[number]", { number: String(challenge.number) }),
			);
		} catch (err) {
			if (err instanceof ApiError && err.code === "INVALID_MAP") {
				const problems = (err.payload as { problems?: string[] })?.problems;
				toast.error(problems?.join(" ") ?? err.message);
			} else if (err instanceof ApiError && err.status === 429) {
				toast.error("Too many challenges created recently — try again later.");
			} else {
				toast.error(err instanceof Error ? err.message : "Create failed");
			}
		} finally {
			busy = false;
		}
	}
</script>

{#snippet stripOffer(seats: string[])}
	<div class="mt-3 text-sm text-gray-400">
		<p>Seat 1 is yours; the rest can go: {seats.join(", ")}.</p>
		<button type="button" class="mt-2 {PRIMARY_BTN}" onclick={stripSeats}>
			Remove {seats.length === 1 ? "that seat" : "those seats"}
		</button>
	</div>
{/snippet}

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-3xl">
				<Breadcrumb
					crumbs={[
						{ label: "Home", href: resolve("/") },
						{ label: "Challenges", href: resolve("/challenges") },
						{ label: "New" },
					]}
				/>
				<h1 class="mb-4 mt-2 text-2xl font-bold text-gray-200">
					New challenge
				</h1>

				<section
					class="mb-6 rounded-lg border border-border-subtle bg-surface p-3"
				>
					<h2
						class="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400"
					>
						1. The map
					</h2>
					<p class="mb-3 text-sm text-gray-400">
						A save from turn 1. Set the game up as a hotseat if the map script
						needs a second player; every seat after yours is removed here, and
						the stripped file is the one everyone downloads — you included.
					</p>
					{#if map.kind === "empty" || map.kind === "invalid"}
						<label
							class="inline-flex cursor-pointer items-center gap-2 {PRIMARY_BTN}"
						>
							Choose save
							<input
								type="file"
								accept=".zip"
								onchange={onPick}
								class="sr-only"
							/>
						</label>
						{#if map.kind === "invalid"}
							<p class="mt-3 text-sm font-bold text-danger">
								{map.fileName} can't be a challenge map:
							</p>
							<ul class="mt-1 list-disc pl-5 text-sm text-danger">
								{#each map.problems as p, i (i)}
									<li>{p}</li>
								{/each}
							</ul>
							{#if map.extraSeats}
								{@render stripOffer(map.extraSeats.seats)}
							{/if}
						{/if}
					{:else if map.kind === "parsing"}
						<p class="text-sm text-gray-400">
							Parsing {map.fileName} — {map.phase} ({map.percent}%)
						</p>
					{:else}
						<div class="flex items-start justify-between gap-3">
							<div>
								<p class="text-sm font-bold text-white">{map.fileName}</p>
								<p class="text-xs text-gray-400">
									{describeSetup(map.setup).join(" · ")}
								</p>
								{#if map.setup.leader_is_custom}
									<p class="mt-1 text-xs text-orange">
										Custom leader — the trait picks resolve on turn 1, so the
										standard-traits criterion will read every run's picks.
									</p>
								{/if}
								{#if map.extraSeats}
									{@render stripOffer(map.extraSeats.seats)}
								{/if}
							</div>
							<label
								class="shrink-0 cursor-pointer text-xs text-tan hover:text-orange"
							>
								Replace
								<input
									type="file"
									accept=".zip"
									onchange={onPick}
									class="sr-only"
								/>
							</label>
						</div>
					{/if}
				</section>

				<section
					class="mb-6 rounded-lg border border-border-subtle bg-surface p-3"
				>
					<h2
						class="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400"
					>
						2. The challenge
					</h2>
					<div class="flex flex-col gap-3 text-xs text-tan">
						<label class="flex flex-col gap-1">
							<span>Title</span>
							<input
								type="text"
								bind:value={title}
								maxlength="120"
								class={INPUT_CLASS}
							/>
						</label>
						<label class="flex flex-col gap-1">
							<span>Description <span class="opacity-60">(optional)</span></span
							>
							<textarea
								bind:value={description}
								rows="3"
								maxlength="4000"
								class={INPUT_CLASS}
							></textarea>
						</label>
						<label class="flex items-center gap-2">
							<span>Open for</span>
							<input
								type="number"
								bind:value={durationDays}
								min="1"
								max="365"
								class="w-20 {INPUT_CLASS}"
							/>
							<span>days</span>
						</label>
					</div>
				</section>

				<section
					class="mb-6 rounded-lg border border-border-subtle bg-surface p-3"
				>
					<h2
						class="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400"
					>
						3. The rules
					</h2>
					{#if map.kind === "ready"}
						<RulesEditor setup={map.setup} bind:objectives bind:criteria />
					{:else}
						<p class="text-sm text-gray-400">
							Choose the map first — the rules are written against what it
							allows.
						</p>
					{/if}
				</section>

				<div class="flex items-center justify-end gap-3">
					<a
						href={resolve("/challenges")}
						class="text-sm text-tan hover:text-orange"
					>
						Cancel
					</a>
					<button
						type="button"
						class={PRIMARY_BTN}
						disabled={!canSubmit}
						onclick={submit}
					>
						{busy ? "Creating…" : "Create challenge"}
					</button>
				</div>
			</div>
		</div>
	</main>
</div>
