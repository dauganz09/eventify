/**
 * Loads the event exactly as the tabulator page does and prints the rank-order
 * result + the majority tie-break explanation, to confirm the fix.
 *   npx tsx --env-file=.env scripts/tie-breaker-test/verify-rankorder.ts
 */
import { getEventTabulatorDetail } from "@/lib/scoring/tabulator-service";
import { db } from "@/db";
import { EVENT_ID, ORG_ID, NAME } from "./design";

async function main() {
  const detail = await getEventTabulatorDetail({ database: db, organizationId: ORG_ID, eventId: EVENT_ID });
  const ro = detail.rankOrder;
  console.log("tieBreak (points):", detail.tieBreak);
  if (!ro) {
    console.log("No rank-order result.");
    process.exit(0);
  }
  console.log(`Rank order — ${ro.groupName}: ${ro.rows.length} contestants\n`);
  const bySum = new Map<number, typeof ro.rows>();
  for (const r of ro.rows) bySum.set(r.rankSum, [...(bySum.get(r.rankSum) ?? []), r]);
  for (const r of ro.rows) {
    const ranks = ro.judges.map((j, i) => `J${i + 1}:${r.ranksByJudge[j.id]}`).join(" ");
    const cluster = bySum.get(r.rankSum)!;
    let note = "";
    if (cluster.length > 1) {
      const peers = cluster.filter((c) => c.contestantId !== r.contestantId);
      let ahead = 0, behind = 0;
      for (const p of peers) for (const j of ro.judges) {
        const a = r.ranksByJudge[j.id], b = p.ranksByJudge[j.id];
        if (a < b) ahead++; else if (b < a) behind++;
      }
      const shared = cluster.every((c) => c.placement === r.placement);
      note = shared
        ? `  ▬ tied on ${r.rankSum} — judges split ${ahead}–${behind} → shared place`
        : ahead >= behind
          ? `  ▲ won tie on ${r.rankSum} — majority ${ahead}–${behind}`
          : `  ▽ lost tie on ${r.rankSum} — majority ${behind}–${ahead}`;
    }
    console.log(`  place ${r.placement}  ${NAME[r.contestantId].padEnd(14)} rank-sum ${String(r.rankSum).padStart(2)}  (${ranks})${note}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
