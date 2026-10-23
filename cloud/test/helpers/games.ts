// Game seeding for the games/* integration tests — a games row plus the R2
// blob that `GET /v1/games/:id` reads.
//
// Direct INSERT rather than driving handleGameUpload: the upload path wants a
// real parsed FullGameData payload and a multipart ZIP, neither of which the
// read-path tests care about. Everything these tests exercise happens after
// the row and the object exist.

import { env } from "cloudflare:test";
import { nanoid } from "nanoid";
import type { TestUser } from "./builders";

// Minimal FullGameData-shaped blob. handleGameDetail only JSON-parses it and
// spreads D1 metadata over the top, so the parser-level shape doesn't matter
// here — player_roster carries an online_id so the PII strip is exercised.
export function makeBlob(gameName: string): Record<string, unknown> {
	return {
		match_metadata: { game_name: gameName, winner: null },
		player_roster: [{ player_index: 0, online_id: "STEAM_SECRET" }],
	};
}

export async function putBlob(
	gameId: string,
	blob: Record<string, unknown>,
): Promise<void> {
	const gz = new Response(
		new Response(JSON.stringify(blob)).body!.pipeThrough(
			new CompressionStream("gzip"),
		),
	);
	await env.SHARE_BUCKET.put(
		`games/${gameId}.json.gz`,
		await gz.arrayBuffer(),
		{
			httpMetadata: { contentType: "application/json" },
		},
	);
}

// Seat rows for a game. `is_uploader` marks the one the uploader claimed — at
// most one row per game carries it (handleGameUpload binds a single index), and
// an observer upload carries none.
export async function seedSeats(
	gameId: string,
	seats: readonly { index: number; nation: string; uploader: boolean }[],
): Promise<void> {
	for (const seat of seats) {
		await env.SHARE_DB.prepare(
			`INSERT INTO player_summaries (
				game_id, player_index, player_name, nation, is_human, is_uploader
			) VALUES (?, ?, ?, ?, 1, ?)`,
		)
			.bind(
				gameId,
				seat.index,
				`seat-${seat.index}`,
				seat.nation,
				seat.uploader ? 1 : 0,
			)
			.run();
	}
}

export async function seedGame(
	user: TestUser,
	opts: { isPublic: boolean; gameName?: string },
): Promise<string> {
	const gameId = nanoid(21);
	await env.SHARE_DB.prepare(
		`INSERT INTO games (
			game_id, user_id, xml_game_id, total_turns, file_hash,
			game_name, is_public, blob_version, blob_size_bytes, parser_version
		) VALUES (?, ?, ?, ?, ?, ?, ?, 2, 1024, '1.0.0')`,
	)
		.bind(
			gameId,
			user.userId,
			nanoid(36),
			50,
			nanoid(64),
			opts.gameName ?? "Test Game",
			opts.isPublic ? 1 : 0,
		)
		.run();
	await putBlob(gameId, makeBlob(opts.gameName ?? "Test Game"));
	return gameId;
}
