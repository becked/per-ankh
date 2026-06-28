---
name: tournament-rules
description: >-
  Answer questions about how Per-Ankh tournaments work — Swiss pairing, byes,
  divisions and division sizing, advancement/elimination thresholds,
  tiebreakers/seeding, the championship bracket, map assignment, match
  reporting, forfeits, withdrawals, and the setup→swiss→championship→complete
  lifecycle. Use this whenever someone (you, an admin, or a player relayed
  through the user) asks how a tournament rule, mechanic, or process behaves —
  including "in Swiss…" questions, since they almost always mean OUR Swiss, not
  generic Swiss. Not for writing tournament FEATURE code (that's normal dev
  work); this is for explaining current behavior correctly and one-shot.
metadata:
  type: project
  source-of-truth: docs/tournament-rules.md
---

# Answering tournament rules questions

Per-Ankh's tournament rules diverge from textbook Swiss in ways that reliably cause confusion. The goal of this skill is **correct, one-shot answers** — grounded in our actual implementation, anticipating the obvious follow-up, and clear about where our behavior is special.

## Protocol

1. **Read the source of truth first.** `docs/tournament-rules.md` is the authoritative, code-grounded reference. Start there; it has a FAQ for the questions that actually come up. If the doc doesn't cover it, trace the engine in `cloud/src/tournament/` (`pairing.ts`, `standings.ts`, `bracket.ts`, `seed.ts`, `admin.ts`, `public.ts`, `player.ts`, `maps.ts`, `authz.ts`) and then **add the finding back to the doc** so the next answer is one-shot.

2. **Lead with OUR behavior, not generic Swiss.** When someone says "but in Swiss it works like X," assume they mean textbook Swiss and explicitly contrast it with ours. The three differences that cause the most confusion:
   - **Early-exit, not fixed-round:** players stop playing once they clinch advance/elimination; they don't all play every round.
   - **Threshold, not top-N cut:** everyone who reaches `swiss_wins_to_advance` qualifies — no cap, no per-division quota (the old top-N cutoff was removed in migration 0014).
   - **Tier 1 is losses, not wins:** because all qualifiers share the same win count by definition.

3. **Walk the chain — don't stop at the literal question.** Most rules questions have an adjacent consequence the asker will need next. Cover it proactively:
   - byes → how a bye scores and its effect on Buchholz/seeding
   - division sizing → effect on championship qualifier composition & tiebreaks
   - advancement threshold → how qualifiers are seeded into the bracket
   - tiebreakers → that they only set seeding, never who's in or out

4. **Match the register to the audience.**
   - **Developer/admin answer (default in this repo):** precise, with file + symbol citations from `cloud/src/tournament/` (e.g. `pickByeRecipient` in `pairing.ts`). This is what the user usually wants.
   - **Player-facing answer (when the user is drafting something to post, e.g. to Discord or the guide):** plain language, no code references. The bold **Rule** lines in `docs/tournament-rules.md` are written to be paste-ready, and the public guide is `src/routes/tournaments/guide/+page.svelte`. Ask which register if it's ambiguous.

5. **Verify before asserting.** Don't claim a rule from memory or from generic Swiss knowledge — confirm it against the doc or the code. If the doc and the code ever disagree, the **code wins**; fix the doc.

## The two questions that started this skill

- **"Do divisions need to be even/balanced?"** → Even matters (avoids byes); balance between divisions does not. 30/26 is fine; 29/27 (both odd) is the swap case.
- **"How does division size affect championship seeding?"** → Threshold + combined ranking means the larger division sends proportionally more qualifiers and cross-division tiebreaks are mildly non-comparable, but bracket size and eligibility are unaffected.

Both are written up in full in `docs/tournament-rules.md` — cite it.
