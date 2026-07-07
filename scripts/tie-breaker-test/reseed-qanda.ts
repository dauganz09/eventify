/**
 * Re-seeds ONLY the Question & Answer scores for all 6 contestants, so the
 * rank-order round is complete regardless of which 5 the advancement snapshot
 * picked. Leaves group/round statuses and the existing snapshot untouched.
 *
 *   npx tsx --env-file=.env scripts/tie-breaker-test/reseed-qanda.ts
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scoreRecords } from "@/db/schema";
import { EVENT_ID, ORG_ID, SETS, QANDA, JUDGE_IDS } from "./design";

async function main() {
  const now = new Date();
  const rows: (typeof scoreRecords.$inferInsert)[] = [];
  for (const judgeId of JUDGE_IDS) {
    for (const [contestantId, values] of Object.entries(QANDA[judgeId])) {
      values.forEach((value, i) => {
        rows.push({
          organizationId: ORG_ID,
          eventId: EVENT_ID,
          roundId: SETS.qanda.id,
          contestantId,
          judgeId,
          criterionId: SETS.qanda.crit[i],
          value: value.toString(),
          status: "submitted",
          revision: 1,
          submittedAt: now,
        });
      });
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(scoreRecords)
      .where(and(eq(scoreRecords.eventId, EVENT_ID), eq(scoreRecords.roundId, SETS.qanda.id)));
    await tx.insert(scoreRecords).values(rows);
  });

  console.log(`Re-seeded ${rows.length} Q&A scores for all 6 contestants.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
