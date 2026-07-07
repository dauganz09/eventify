/**
 * Reads the SEEDED database through the real tabulator services to confirm the
 * app produces the same standings as the pure simulation — proving seed → DB →
 * service → tie-break all agree. Flips events.config.tieBreak between runs.
 *
 *   npx tsx --env-file=.env scripts/tie-breaker-test/verify-db.ts
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { getCumulativeStandings, snapshotAdvancementQualifiers } from "@/lib/scoring/tabulator-service";
import { EVENT_ID, GROUPS, NAME } from "./design";

async function setTieBreak(tb: string) {
  await db
    .update(events)
    .set({ config: sql`jsonb_set(coalesce(${events.config}, '{}'::jsonb), '{tieBreak}', ${JSON.stringify(tb)}::jsonb)` })
    .where(eq(events.id, EVENT_ID));
}

async function main() {
  const original = (await db.select({ config: events.config }).from(events).where(eq(events.id, EVENT_ID)))[0]?.config as Record<string, unknown>;

  for (const tb of ["shared", "countback", "highest_single_set"]) {
    await setTieBreak(tb);
    console.log(`\n▸ tieBreak = "${tb}"  (cumulative standings, from the DB)`);
    const { rows } = await getCumulativeStandings({ database: db, eventId: EVENT_ID });
    for (const r of rows.sort((a, b) => a.rank - b.rank || b.overall - a.overall)) {
      console.log(`   ${String(r.rank).padStart(2)}. ${NAME[r.contestantId].padEnd(14)} overall ${r.overall}`);
    }
    // What the app would snapshot as the top-5 qualifiers when Q&A is activated.
    const snap = await snapshotAdvancementQualifiers({ database: db, eventId: EVENT_ID, groupId: GROUPS.qanda });
    console.log("   advances →", snap?.qualifiedIds.map((id) => NAME[id]).join(", "));
  }

  // Restore original config and clear the snapshot we took while probing.
  await setTieBreak((original?.tieBreak as string) ?? "shared");
  await db.update((await import("@/db/schema")).roundGroups).set({ qualifiedContestantIds: null }).where(eq((await import("@/db/schema")).roundGroups.id, GROUPS.qanda));
  console.log(`\nRestored tieBreak = "${(original?.tieBreak as string) ?? "shared"}" and cleared probe snapshot.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
