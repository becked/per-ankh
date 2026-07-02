# Tournament Rules & Mechanics Reference

**The single source of truth for how Per-Ankh tournaments _actually behave_.**

This document describes the **current, implemented** rules of the tournament subsystem — not the design intent (that's `docs/archive/tournament-feature-spec.md`) and not the build history (that's `docs/tournament-implementation-notes.md`). When this document and the code disagree, **the code wins** — fix this document.

## How to use this document

- **Answering a rules question** (yours or a player's): find the mechanic below, read the **Rule** line, and follow the **chain** — most questions about one mechanic (e.g. byes) have a follow-on in an adjacent mechanic (e.g. how a bye affects seeding). The [Edge cases & FAQ](#edge-cases--faq) section collects the questions that actually come up.
- **Register.** Each mechanic has a bold **Rule** line written in plain language — that line is safe to paste to a player. The _In code_ pointers underneath are for developers. Where our behavior differs from textbook Swiss, there's a **vs. textbook Swiss** callout — lead with these when someone says "but in Swiss…", because they almost always mean generic Swiss, not ours.
- **Citations** name a file and a function/symbol, not line numbers (which rot). The engine lives in `cloud/src/tournament/`.
- **What players already see:** the public guide at `/tournaments/guide` (`src/routes/tournaments/guide/+page.svelte`) is the player-facing version of this material. Keep the two consistent; this doc is the superset.

## The one-paragraph model

A tournament runs a **double-threshold early-exit Swiss** qualifier, split into two independent **divisions** purely for parallelism, then merges all qualifiers into **one single-elimination championship bracket**. You play Swiss rounds against opponents in your own division until you either **advance** (reach the win threshold) or are **eliminated** (reach the loss threshold) — you don't play a fixed number of rounds, you play until you clinch. Everyone who advances — no cap, no per-division cutoff — is ranked by a six-tier tiebreaker cascade and seeded 1-vs-N into the bracket. Win the final to be champion.

> **vs. textbook Swiss (read this first):** Classic Swiss plays a _fixed number of rounds_ with _everyone playing every round_, then ranks by win-points and takes a top-N cut. Ours is different in three ways that drive most "wait, in Swiss it works like…" confusion: (1) it's **early-exit** — you stop playing once you clinch advance/elimination; (2) advancement is an **absolute win threshold**, not a top-N cut; (3) the primary ranking tier is **losses, not wins**, because every qualifier has the same win count by definition.

---

## Lifecycle (status FSM)

**Rule:** A tournament moves `setup → swiss → championship → complete`, in that order, never backward. Most configuration is editable only in `setup`; later phases progressively lock it.

- *In code:* status type in `cloud/src/tournament/data.ts`; transitions in `cloud/src/tournament/admin.ts`.

| State | How it's entered | What an admin can still change |
| --- | --- | --- |
| `setup` | Tournament created | Everything: slots (add/delete/reorder), divisions, Swiss config, map pool freely |
| `swiss` | Admin clicks **Start** (`handleStartTournament`) | Slots can only be **withdrawn**, not deleted; map pool is **append-only**; Swiss config (`swiss_wins_to_advance`/`losses_to_eliminate`/`max_rounds`) is **frozen** |
| `championship` | Admin runs **transition to championship** (`handleTransitionChampionship`) | Same locks as swiss; Swiss config fully immutable |
| `complete` | Final championship match is reported (auto, `maybeAdvanceAfterMatchReport`) | Immutable; can't be deleted |

**Transition preconditions:**

- **setup → swiss** (`handleStartTournament`): both divisions need ≥1 slot, and the map pool must be non-empty (an empty pool is legal _during_ setup but match generation needs at least one map). Creates Round 1 for both divisions and closes signups.
- **swiss → championship** (`handleTransitionChampionship`): status must be `swiss`; all pending Swiss matches must be reported first; at least **2** qualifiers (else `INSUFFICIENT_QUALIFIERS`, with an `override_ranks` escape hatch — see [Transition](#swiss--championship-transition)).
- **championship → complete**: automatic when the single final match is reported; stamps `completed_at`.

---

## Setup & configuration

These fields govern the rules. All are set in `setup` and frozen at Start.

- *In code:* validation in `cloud/src/schemas/tournament.ts` (`CreateTournamentSchema` / `PatchTournamentSchema`); defaults applied in `cloud/src/tournament/admin.ts` (`handleCreateTournament`).

| Field | Default | Range / constraint | What it does |
| --- | --- | --- | --- |
| `swiss_wins_to_advance` | 3 | integer 1–20 | Wins needed to **advance** to the championship |
| `swiss_losses_to_eliminate` | 3 | integer 1–20 | Losses that **eliminate** a player from Swiss |
| `swiss_max_rounds` | 5 | integer 1–20 | Hard cap on Swiss rounds generated |
| `division_a_name` / `division_b_name` | "Division A" / "Division B" | 1–64 chars | Display labels only |
| `map_pool` | — | 0–64 entries; append-only after setup | Maps auto-assigned to matches |
| `signups_open` | — | boolean | When true (and status=setup), the public can self-sign-up |

**Cross-field invariant (enforced):**

> `swiss_wins_to_advance + swiss_losses_to_eliminate` must be **≤ `swiss_max_rounds + 1`** — "otherwise some players may finish Swiss with no verdict" (`admin.ts`). The default 3 / 3 / 5 satisfies this (3 + 3 = 6 ≤ 6).

The rationale: a player who alternates win-loss-win-loss… is the slowest to reach either threshold, and this invariant guarantees even that player clinches by `swiss_max_rounds`. If you raise the thresholds, raise `max_rounds` too.

---

## Signups, slots & divisions

**Rule:** Players occupy **slots**. A slot belongs to one division and carries a `swiss_seed` (its seeding number within that division). Slots are filled either by player **self-signup** or by an admin **bulk-creating** them.

- *In code:* self-signup `handleTournamentSignup` (`player.ts`); admin bulk-create `handleBulkCreateSlots` (`admin.ts`).

- **Self-signup** is allowed only while `status=setup` **and** `signups_open=1`. The player picks a division; the server assigns the next `swiss_seed` in that division (`MAX+1`) and records their Discord identity. One slot per user per tournament (enforced atomically).
- **Admin bulk-create** (setup only) seeds slots from a list, either pre-linked to a Per-Ankh user (`user_id` supplied → canonical handle used) or as free-text Discord usernames (unclaimed until that user logs in).
- **Slot claiming:** when a user logs in via Discord, a slot whose `discord_id` matches is auto-claimed (gets their `user_id`). Claiming is identity-binding, not a rules event.
- **Division & phase are immutable once the tournament starts** — you cannot move a player between divisions mid-tournament (`handlePatchSlot`).

### Divisions

**Rule:** The two divisions are **independent Swiss pools** that exist only so rounds can run in parallel and finish faster. They carry **no competitive weight** once Swiss ends — there is no per-division bracket, quota, or bonus.

- *In code:* `pairSwissRound` pairs within a single division's slots; spec `docs/archive/tournament-feature-spec.md` §2: divisions are "purely as a parallelization mechanism."

**Sizing — the rule operators actually ask about:**

- **What matters is parity (even/odd) _within_ each division, not balance _between_ them.** An odd division hands out a bye every round; an even division pairs everyone with no bye. Division sizes do **not** need to be equal.
- So **30/26 is fine as-is** (both even → no byes). **29/27 is the case that warrants a roster swap** (both odd → a bye each round in each division); one swap makes it 28/28 or 30/26 (both even).
- The engine **does not require or enforce** equal or even divisions — there is no validation on it. Odd divisions are handled gracefully via byes, not rejected. The only floor is `playersPerDivision ≥ 2`.
- Size still has _soft_ effects on the championship — see [How division size affects championship seeding](#how-division-size-affects-championship-seeding).

> **vs. textbook Swiss:** Standard Swiss is one pool. Splitting into two parallel pools is a Per-Ankh choice; the cross-division comparison only happens once, at bracket seeding.

---

## Swiss pairing

**Rule:** Each round, every still-active player in a division is paired against one opponent with a similar record; the system avoids rematches where it can. Pairings are generated **automatically and committed as-is** when the round is created — there is no step to hand-edit who plays whom. Seeding and division assignment, both set before the tournament starts, are the only levers that shape pairings.

- *In code:* `pairSwissRound`, `pairRound1`, `pairBucket` (`pairing.ts`).
- **"Active"** = not yet advanced and not yet eliminated. Once you clinch either threshold you **sit out** the remaining Swiss rounds (you're removed from the pairing pool). This is the early-exit property.

**Round 1:** all records are 0-0, so slots are sorted by `swiss_seed` (best first) and folded top-half vs bottom-half — seed 1 vs the middle seed, etc.

**Round 2+:**

1. Compute each active slot's W-L.
2. Bucket players by identical (wins, losses) record.
3. Within a bucket, sort by (wins desc, losses asc, seed asc) and fold top vs bottom half.
4. **Rematch avoidance:** if a pairing repeats a prior match, try swapping one bottom-half player with another to break it — but only if the swap doesn't create a _new_ rematch. If no clean swap exists, the rematch is accepted and stands — there is no manual re-pair step.
5. **Odd bucket:** the lowest-ranked player in the bucket "floats down" to the next bucket and is paired there.

> **vs. textbook Swiss:** This is close to standard Swiss (records buckets, fold pairing, rematch avoidance). The main difference is the **early-exit pool** — once you clinch advance or elimination you're removed from the pool rather than paired every round.

### Byes

**Rule:** When a division has an **odd** number of active players, one player gets a **bye** that round — a free win against no opponent. The bye goes to the **lowest-ranked player who hasn't already had one** this tournament.

- *In code:* `pickByeRecipient` (`pairing.ts`); bye scoring in `computeRecord` / standings (`standings.ts`).

- **Who:** Round 1 → the lowest seed. Round 2+ → walk up from the bottom of the standings and pick the first player who hasn't had a bye yet. The idea: the free win goes to whoever's doing worst, and no one gets two byes.
- **One bye per player** — guaranteed unless _every_ active player has already had one (a tiny-field degenerate case).
- **Only active players** are bye candidates; clinched/eliminated players are already out of the pool.
- **Scoring:** a bye is **+1 win**. It does **not** enter anyone's opponent list, so it doesn't affect Buchholz / strength-of-schedule for anyone.
- **Not directly assignable:** the bye recipient is chosen by the algorithm and committed when the round is created — there's no endpoint to reassign it. The only lever is *indirect and pre-Start*: in Round 1 the lowest seed takes the bye, so seed order (`/slots/reorder`, setup-only) decides who that is.

> **vs. textbook Swiss:** This matches standard Swiss bye handling (lowest score group, no repeat byes, bye = full point).

---

## Advancement, elimination & standings

**Rule:** You **advance** the instant you reach `swiss_wins_to_advance` wins, and you're **eliminated** the instant you reach `swiss_losses_to_eliminate` losses. There is **no cap and no per-division cutoff** — every player who reaches the win threshold qualifies for the championship.

- *In code:* `computeRecord` sets `status` to `advanced` / `eliminated` / `active` (`standings.ts`); qualifier filter in `handleTransitionChampionship` (`admin.ts`).

**Status values a player sees:** `Active` (still playing), `Advanced` ✓ (qualified), `Eliminated` ✗ (out), `Withdrawn` WD (dropped by an admin; games already played stand).

> **History:** A "top-N per division advances" cutoff used to exist and was **removed in migration 0014**. Qualification is now purely the win threshold. Don't reintroduce per-division-quota assumptions when reasoning about who advances.

### Tiebreaker cascade (seeding only)

**Rule:** Qualifiers are sorted into bracket seeds 1, 2, 3… by a six-tier cascade. Each tier is consulted only to break ties left by the previous one. **Tiebreakers only set seeding — never who's in or out.**

- *In code:* `rankStandings` and the tier helpers in `standings.ts`.

1. **Fewest losses** (composite: more wins first, then fewer losses). Among qualifiers, wins are equal by definition, so this reduces to fewest losses — whoever clinched in fewer rounds seeds higher.
2. **Head-to-head** — wins against the other _still-tied_ players.
3. **Buchholz cut-1 (B1)** — strength of schedule: sum of opponents' final win counts, dropping the single lowest.
4. **Opponents' Buchholz (B2)** — depth of schedule: sum of your opponents' own B1 scores.
5. **Cumulative (Harkness)** — running win total across rounds; rewards winning earlier.
6. **Initial Swiss seed**, then `slot_id` — a fully deterministic terminal key, so seeding never needs a manual tiebreak.

> **vs. textbook Swiss:** Tier 1 being _losses_ rather than _wins_ is the headline difference, and it's a direct consequence of early-exit Swiss (all qualifiers share the same win count). Buchholz/Harkness are standard.
>
> **Within-division vs. combined:** Buchholz (tiers 3–4) is computed from a player's **actual Swiss opponents, who are all in their own division**. The resulting numbers are then used to rank players **across both divisions** at seeding time, with no normalization for division size — see the next section.

---

## Swiss → championship transition

**Rule:** When Swiss is done, the admin transitions to championship. The system takes **every advanced, non-withdrawn slot from both divisions**, ranks them by the tiebreaker cascade into one combined list, and builds the bracket.

- *In code:* `handleTransitionChampionship` (`admin.ts`); ranking via `computeStandings` + `rankStandings` (`standings.ts`).

- **Single combined pool** — both divisions merged; no per-division quota.
- **Withdrawn slots are excluded** even if they'd reached the win threshold.
- **Minimum 2 qualifiers.** Fewer → `INSUFFICIENT_QUALIFIERS`. The admin can supply an explicit seed order via **`override_ranks`** to seed the bracket by hand (also the escape hatch when auto-qualification is too thin or the admin wants a manual seeding).

---

## Championship bracket

**Rule:** A single-elimination bracket of size **next-power-of-two ≥ qualifier count**, seeded standard **1-vs-N** (seed 1 plays the lowest qualifier, 2 plays the next-lowest, …). If the count isn't a power of two, the **top seeds get round-1 byes**. Win every round through the final to be champion.

- *In code:* `buildChampionshipRound1`, `standardBracketPairs`, `largestPowerOfTwoAtLeast`, `buildChampionshipFollowupRound` (`bracket.ts`); round progression in `maybeAdvanceAfterMatchReport` (`admin.ts`).

- **Bye seats:** phantom seeds (`qualifierCount+1 … bracketSize`) make their R1 opponent's match a bye — `status='bye'`, the real seed auto-advances at insert time. Standard 1-vs-N order puts these byes on the top seeds. Example: 6 qualifiers → bracket size 8 → 2 byes (seeds 1 and 2 advance free to R2).
- **Seeding structure:** adjacent R1 matches feed the same R2 match; the top two seeds can only meet in the final.
- **Later rounds:** winner of match `2i-1` plays winner of match `2i`, recursively until one match remains.
- **Completion:** when the round with a single match (the final) is reported, the tournament auto-completes and its winner is **champion**.

### How division size affects championship seeding

This is the subtle follow-on to division sizing. Because advancement is a **threshold, not a per-division quota**, and qualifiers are merged into **one combined ranking**, an unequal split (e.g. 30/26) propagates into the championship in three ways:

1. **Qualifier composition tilts toward the larger division.** At a fixed win threshold, roughly a fixed _fraction_ of each pool advances, so the bigger division sends proportionally more players (≈13 vs ≈10 rather than 11/11). This is **not a seeding error** — each qualifier earned the same record; the threshold model treats qualifying as an absolute achievement. Whether that tilt is "fair" is a philosophy call, not a bug.
2. **Cross-division tiebreaks are mildly apples-to-oranges.** Buchholz is measured against your own division's pool with no size normalization, but is then used to seed you against players from the other-sized division. A cross-division tie can be broken by numbers computed over structurally different pools. Round _depth_ is equal (rounds are capped tournament-wide by `swiss_max_rounds`), so it's the opponent win-_distribution_ that differs, not the number of games.
3. **Bracket size is essentially unaffected.** Bracket size depends on the **total** qualifier count, and the total field is the same regardless of the split (30+26 = 28+28). So balancing divisions barely changes bracket shape or bye count — its real effect is on _which division_ qualifiers come from and on the tiebreak comparison.

**Bottom line for an admin:** unequal-but-even divisions (30/26) don't break anything and don't change who's eligible, the bracket size, or the algorithm. Balancing to 28/28 only buys symmetric per-division representation and cleaner cross-division tiebreaks. Balance it if you care about those; otherwise 30/26 is fine.

---

## Match reporting & scoring

**Rule:** A match result is recorded by **uploading the finished save** — the winner is read from the game, no opponent confirmation needed. Either participant or a tournament admin can report. Admins can also set/edit a result directly.

- *In code:* upload path links the match via `linkTournamentMatch` (`cloud/src/games.ts`); admin direct edit `handleRetroEditMatch` (`admin.ts`).

- **Match statuses:** `pending`, `complete`, `forfeit`, `bye`. **There is no draw** — every decided match has a `winner_slot_id`.
- **Who can report by upload:** the owner of slot A, the owner of slot B, or a tournament admin (observer upload on a player's behalf).
- **Admin direct edit:** can set `winner_slot_id` / `status` / `game_id`, but **cannot edit a match if a downstream round already has reported results** — you can't rewrite history that's already been built on. The winner must be one of the match's two slots.
- **Auto-advance:** reporting the last match of a round auto-closes the round and generates the next one (Swiss or championship), or completes the tournament if it was the final.
- **Occupant snapshots:** when a match leaves `pending`, the participants' names/avatars are snapshotted onto the match, so later substitutions don't rewrite historical results.

---

## Maps

**Rule:** Every non-bye match is **auto-assigned** a map from the tournament's pool when its round is generated — **nobody picks**. The assignment prioritizes a map script that **neither player has played yet**.

- *In code:* `assignMap` / `assignMapsToPairings` (`maps.ts`); admin override `handlePatchMatchMap` (`admin.ts`).

1. **Fresh base map:** prefer a script neither player has played earlier in the tournament (chosen uniformly among eligible instances).
2. **Forced repeat:** once every remaining script has been played by one of them, pick the script the pair has played fewest times, preferring a variant whose exact settings they haven't seen so it at least plays differently.
3. **Secondary touch:** lightly spread distinct scripts across a single round's matches.

Selection is seeded by a deterministic per-round PRNG so retries are stable. Byes get no map (`map_pool_id=null`). An admin can change the map of a **pending or bye** match (`handlePatchMatchMap`); once a match is reported its map is locked. Repeat-avoidance depends on the pool having enough distinct base scripts.

---

## Withdrawals & reinstatement

**Rule:** Before the tournament starts, a player can withdraw themselves (their slot is deleted). After it starts, only an **admin** can withdraw a player; their **pending matches are forfeited to their opponents**, they're excluded from all future pairing and from championship qualification, but **games already played stand**.

- *In code:* admin `handleWithdrawSlot` + `forfeitPendingMatchesForSlot`, reinstate `handleReinstateSlot` (`admin.ts`); player self-withdraw `handleTournamentWithdraw` (`player.ts`).

- **Self-withdraw** is `setup`-only and **hard-deletes** the slot.
- **Admin withdraw** (swiss/championship) sets `withdrawn_at`, forfeits pending matches (inert if the opponent is also withdrawn), and triggers round advancement. A forfeit is a `status='forfeit'` result credited to the opponent.
- **Reinstate** clears `withdrawn_at` and takes effect from the **next** round generated; it does **not** undo already-forfeited matches or re-pair an in-progress round.

---

## Scheduling, export & limits (operational)

- **Scheduling metadata** is a per-match list of **parts** (sittings), each with its own `scheduled_at`, an ordered caster list (first = streamer, the rest co-casters), and VOD links (`parts` JSON column, migration 0029). While a match is **pending**, an admin or either participant can replace the whole list; once it's **decided** (complete/forfeit) editing is **admin-only** — the parts become an archive (VODs, caster credits) that a participant shouldn't be able to wipe. Byes are never editable. Writes carry the `parts_rev` the editor loaded and 409 on conflict, so concurrent edits can't silently erase each other (`handlePatchMatchSchedule`). It's display-only and not phase-locked.
- **Export:** admins can `GET …/export` for a zip of `standings.csv` + `matches.csv` (`export.ts`), rate-limited per hour.
- **Access:** the tournament feature is public — anonymous visitors can browse, and any logged-in user can sign up, report, and act as a granted admin. The `tournament_beta_users` allowlist gates tournament **creation** only; a non-allowlisted caller gets **403 `TOURNAMENT_CREATE_FORBIDDEN`** (`authz.ts` + `admin.ts`), and create-allowlist grants are CLI-only. The only tournament 404s are the *setup-gate* (`setupGateHides` in `public.ts`), which hides setup-phase tournaments with signups closed from non-admins.
- **Rate limits** apply per-user/per-IP per hour to create, admin actions, scheduling, export, and anonymous views (`limits.ts`).

---

## Edge cases & FAQ

These are the questions that come up in practice; answer from here.

**Do divisions need to be equal in size?**
No. They need to be **even** to avoid byes, but not equal to each other. 30/26 is fine (both even). See [Divisions](#divisions).

**When do we need to swap players between divisions?**
Only to fix **odd** divisions. 29/27 (both odd) → a bye every round in each division; one swap fixes it. 30/26 (both even) needs nothing.

**Does an unequal split distort the championship?**
It tilts qualifier _count_ toward the larger division (expected, not a bug) and makes cross-division tiebreaks slightly non-comparable; it does **not** change eligibility, bracket size, or the algorithm. See [How division size affects championship seeding](#how-division-size-affects-championship-seeding).

**Who gets the bye in an odd division?**
The lowest-ranked player who hasn't had one yet (lowest seed in round 1). One per player. It's worth +1 win and doesn't affect anyone's Buchholz. See [Byes](#byes).

**Does a bye count as a win?**
Yes — +1 win in the standings. It just doesn't enter opponent lists, so it has no strength-of-schedule effect.

**How many players advance?**
However many reach `swiss_wins_to_advance` — no fixed number, no per-division cap. With default thresholds, a rough rule of thumb is shown in the admin config panel ("expect roughly X–Y qualifiers").

**What if fewer than 2 players advance?**
The transition returns `INSUFFICIENT_QUALIFIERS`; the admin seeds the bracket by hand with `override_ranks`.

**Is there a draw / tie result for a match?**
No. Every decided match has a winner. Forfeits (from withdrawals or admin action) credit the opponent.

**Why is the top seed's first championship match a bye?**
Non-power-of-two qualifier counts give the top seeds round-1 byes by standard 1-vs-N seeding. 6 qualifiers → bracket of 8 → seeds 1 and 2 advance free to R2.

**Can the pairing or bye be overridden?**
Not directly. Swiss pairings and the bye recipient are generated by the algorithm and committed when the round is created — there is **no endpoint** to re-pair a round, swap an opponent, or reassign the bye. The only influence is *indirect and before Start*: seed order (`/slots/reorder`) and division assignment. What an admin **can** edit afterward are match _results_ (`handleRetroEditMatch` — winner / status), and a match's _map_ and _schedule_ — never who plays whom. A reported result can't be edited once a downstream round has reported matches.

**Why does a tournament 404 in dev?**
Setup-phase tournaments with signups closed are hidden from non-admins by the *setup-gate* (`setupGateHides` in `public.ts`): they 404 so the tournament's existence doesn't leak. Open signups on it, or view it as an admin, to make it visible. (Tournaments are no longer beta-gated, so create-allowlist membership doesn't affect visibility.)

---

## Related references

- `docs/archive/tournament-feature-spec.md` — design intent and rationale.
- `docs/tournament-implementation-notes.md` — build record / decisions.
- `src/routes/tournaments/guide/+page.svelte` — the player-facing guide.
- Engine: `cloud/src/tournament/` — `pairing.ts`, `standings.ts`, `bracket.ts`, `seed.ts`, `admin.ts`, `public.ts`, `player.ts`, `maps.ts`, `authz.ts`.
