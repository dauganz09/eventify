/**
 * Seeds the engineered tie-breaker scores into "Test Event 2026" and puts the
 * event into a walk-through state:
 *   • all scores submitted for every set (groups 0–2 identical across judges;
 *     Q&A per-judge for the 5 advancers)
 *   • groups 0–2 (points/carry-over) + their sets → status "finished"
 *   • group 3 (Q&A, rank_order) + its set → status "idle"
 *
 * With no active round the tabulator shows the cumulative Final Rankings, which
 * is where the advancement (top-5) tie-break is decided. Activate the Q&A round
 * in the app when you want to run the rank-order stage.
 *
 * Idempotent: wipes this event's score_records first. Does NOT touch the event's
 * tieBreak config — change that in the app (or Settings) to compare methods.
 *
 *   npx tsx --env-file=.env scripts/tie-breaker-test/seed.ts
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { scoreRecords, rounds, roundGroups } from "@/db/schema";
import {
  EVENT_ID,
  ORG_ID,
  GROUPS,
  SETS,
  POINTS,
  QANDA,
  JUDGE_IDS,
} from "./design";

type Insert = typeof scoreRecords.$inferInsert;

async function main() {
  const now = new Date();
  const rows: Insert[] = [];

  const base = (roundId: string, contestantId: string, judgeId: string, criterionId: string, value: number): Insert => ({
    organizationId: ORG_ID,
    eventId: EVENT_ID,
    roundId,
    contestantId,
    judgeId,
    criterionId,
    value: value.toString(),
    status: "submitted",
    revision: 1,
    submittedAt: now,
  });

  // Points sets (groups 0–2): every judge gives the same sub-scores.
  for (const [key, row] of Object.entries(POINTS)) {
    const set = SETS[key as keyof typeof SETS];
    for (const [contestantId, values] of Object.entries(row)) {
      values.forEach((value, i) => {
        for (const judgeId of JUDGE_IDS) {
          rows.push(base(set.id, contestantId, judgeId, set.crit[i], value));
        }
      });
    }
  }

  // Q&A (group 3, rank-order): per-judge sub-scores for the 5 advancers.
  for (const judgeId of JUDGE_IDS) {
    for (const [contestantId, values] of Object.entries(QANDA[judgeId])) {
      values.forEach((value, i) => {
        rows.push(base(SETS.qanda.id, contestantId, judgeId, SETS.qanda.crit[i], value));
      });
    }
  }

  await db.transaction(async (tx) => {
    // Clean slate for this event's scores.
    await tx.delete(scoreRecords).where(eq(scoreRecords.eventId, EVENT_ID));
    // Insert in chunks (postgres bind-parameter limits).
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(scoreRecords).values(rows.slice(i, i + 500));
    }

    // Round-group statuses.
    const finishedGroups = [GROUPS.prejudging, GROUPS.closedDoor, GROUPS.coronation];
    await tx.update(roundGroups).set({ status: "finished", updatedAt: now }).where(inArray(roundGroups.id, finishedGroups));
    await tx.update(roundGroups).set({ status: "idle", qualifiedContestantIds: null, updatedAt: now }).where(eq(roundGroups.id, GROUPS.qanda));

    // Round (set) statuses: finish everything in groups 0–2, idle the Q&A set.
    await tx.update(rounds).set({ status: "finished", updatedAt: now }).where(and(eq(rounds.eventId, EVENT_ID), inArray(rounds.roundGroupId, finishedGroups)));
    await tx.update(rounds).set({ status: "idle", updatedAt: now }).where(and(eq(rounds.eventId, EVENT_ID), eq(rounds.roundGroupId, GROUPS.qanda)));
  });

  console.log(`Seeded ${rows.length} score records.`);
  console.log("Groups 0–2 finished; Q&A idle. Open the tabulator → Final Rankings.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
