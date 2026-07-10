/**
 * Restores the 6 fixture contestants (fixed UUIDs from design.ts) on
 * "Test Event 2026", deleting any other contestants on the event first.
 * Needed if the event's contestants were ever reset/edited via the Builder
 * UI, which breaks seed.ts's foreign-key references.
 *
 *   npx tsx --env-file=.env scripts/tie-breaker-test/seed-contestants.ts
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contestants } from "@/db/schema";
import { EVENT_ID, C, NAME } from "./design";

async function main() {
  const order = Object.values(C);

  await db.transaction(async (tx) => {
    await tx.delete(contestants).where(eq(contestants.eventId, EVENT_ID));
    await tx.insert(contestants).values(
      order.map((id, i) => ({
        id,
        eventId: EVENT_ID,
        displayNumber: String(i + 1),
        displayName: NAME[id],
        position: i,
        metadata: {},
      })),
    );
  });

  console.log(`Restored ${order.length} fixture contestants on ${EVENT_ID}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
