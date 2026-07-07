/**
 * Faithful simulation of how "Test Event 2026" resolves ties, using the REAL
 * ranking functions the tabulator and printed report use
 * (lib/scoring/ranking.ts). No database access — this proves the math.
 *
 *   npx tsx scripts/tie-breaker-test/simulate.ts
 *
 * It runs every level (per-round, cumulative + advancement, rank-order) under
 * every points tie-break method (shared / countback / highest_single_set) and
 * asserts the outcomes against hand-computed expectations.
 */
import {
  rankWithTieBreak,
  computeRankOrder,
  type TieBreak,
} from "@/lib/scoring/ranking";
import {
  computeGroupStandings,
  type GroupStandingsGroup,
} from "@/lib/scoring/tabulator-service";
import { NAME, C, POINTS, SETS, QANDA, JUDGE_IDS } from "./design";

// setId -> contestantId -> judge-averaged total (weights are all 100, and for
// the points sets every judge is identical, so the average == the sub-score sum).
function setTotal(setKey: keyof typeof POINTS, contestantId: string): number {
  return POINTS[setKey][contestantId].reduce((a, b) => a + b, 0);
}

const POINTS_METHODS: TieBreak[] = ["shared", "countback", "highest_single_set"];

let failures = 0;
function assert(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`   ${ok ? "✓" : "✗ FAIL"} ${label}${ok ? "" : `\n        expected ${e}\n        got      ${a}`}`);
}

function rankLine(ranks: Map<string, number>, ids: string[]): string {
  return ids
    .slice()
    .sort((x, y) => (ranks.get(x)! - ranks.get(y)!))
    .map((id) => `${ranks.get(id)}. ${NAME[id]}`)
    .join("   ");
}

// ── LEVEL 1: PER-ROUND standings (Pre-judging: Talent, Denim, Prelim) ─────────
// This is exactly what the tabulator's active-round standings table computes:
// primary = SUM of the round's set totals; tie-break compares the individual
// set totals, latest set first (countback) or best set first (highest_single).
function prejudgingStandings(tieBreak: TieBreak) {
  const setKeys: (keyof typeof POINTS)[] = ["talent", "denim", "prelim"];
  const rows = Object.values(C).map((id) => {
    const cells = setKeys.map((k) => setTotal(k, id)); // set-position order
    return {
      id,
      primary: cells.reduce((a, b) => a + b, 0),
      setScoresByRecency: [...cells].reverse(), // latest set first
    };
  });
  return rankWithTieBreak(rows, tieBreak);
}

console.log("═".repeat(78));
console.log("LEVEL 1 — PER-ROUND TIE  (Pre-judging: #2 Shanai vs #3 Kriesha, both 27)");
console.log("  Talent/Denim/Prelim →  #2 = 10/9/8      #3 = 8/9/10");
console.log("═".repeat(78));
for (const m of POINTS_METHODS) {
  const ranks = prejudgingStandings(m);
  console.log(`\n▸ tieBreak = "${m}"`);
  console.log("   " + rankLine(ranks, Object.values(C)));
}
console.log("\n  Assertions:");
{
  const shared = prejudgingStandings("shared");
  assert("shared: #2 and #3 both rank 2", [shared.get(C.c2_Shanai), shared.get(C.c3_Kriesha)], [2, 2]);
  const cb = prejudgingStandings("countback");
  // Prelim is the latest set: #3=10 beats #2=8 → #3 ranks above #2.
  assert("countback: #3 rank 2, #2 rank 3", [cb.get(C.c3_Kriesha), cb.get(C.c2_Shanai)], [2, 3]);
  const hs = prejudgingStandings("highest_single_set");
  // Both sorted best-first are [10,9,8] → identical → stays shared.
  assert("highest_single_set: #2 and #3 still tie at 2", [hs.get(C.c2_Shanai), hs.get(C.c3_Kriesha)], [2, 2]);
}

// ── LEVEL 2: CUMULATIVE standings + advancement (top 5) ───────────────────────
const CUM_GROUPS: GroupStandingsGroup[] = [
  { id: "g0", position: 0, carryOver: true, carryOverWeight: 100, sets: [{ id: "talent", carryOver: true }, { id: "denim", carryOver: true }, { id: "prelim", carryOver: true }] },
  { id: "g1", position: 1, carryOver: true, carryOverWeight: 100, sets: [{ id: "advocacy", carryOver: true }, { id: "cdi", carryOver: true }] },
  { id: "g2", position: 2, carryOver: true, carryOverWeight: 100, sets: [{ id: "production", carryOver: true }, { id: "swimsuit", carryOver: true }, { id: "gown", carryOver: true }] },
];
const CUM_TOTALS = new Map<string, Map<string, number>>();
for (const k of ["talent", "denim", "prelim", "advocacy", "cdi", "production", "swimsuit", "gown"] as (keyof typeof POINTS)[]) {
  CUM_TOTALS.set(k, new Map(Object.values(C).map((id) => [id, setTotal(k, id)])));
}
function cumulative(tieBreak: TieBreak) {
  return computeGroupStandings({
    groups: CUM_GROUPS,
    totalsBySet: CUM_TOTALS,
    contestantIds: Object.values(C),
    roundScoreMode: "sum",
    tieBreak,
  });
}
const ADVANCE = 5;

console.log("\n" + "═".repeat(78));
console.log("LEVEL 2 — CUMULATIVE + ADVANCEMENT  (sum of 3 groups; top 5 advance)");
console.log("  Overall:  #1=100  #2=90  #3=90  #4=84  #5=81  #6=81");
console.log("  Ties:  #2 vs #3 at 90 (advancer order)   #5 vs #6 at 81 (the cut!)");
console.log("  Per-group #5 = 24/24/33   #6 = 25/23/33");
console.log("═".repeat(78));
for (const m of POINTS_METHODS) {
  const { rows } = cumulative(m);
  console.log(`\n▸ tieBreak = "${m}"`);
  for (const r of rows) {
    const advances = r.rank <= ADVANCE;
    console.log(`   ${String(r.rank).padStart(2)}. ${NAME[r.contestantId].padEnd(14)} overall ${r.overall}   ${advances ? "ADVANCES" : "— eliminated —"}`);
  }
  const advancing = rows.filter((r) => r.rank <= ADVANCE).length;
  console.log(`   → ${advancing} contestant(s) advance`);
}
console.log("\n  Assertions:");
{
  const sharedRows = new Map(cumulative("shared").rows.map((r) => [r.contestantId, r.rank]));
  // shared: #5 and #6 tie at rank 5 → both ≤5 → all 6 advance (nobody cut).
  assert("shared: #5 and #6 both rank 5", [sharedRows.get(C.c5_Bernadette), sharedRows.get(C.c6_Desiree)], [5, 5]);
  assert("shared: 6 advance (tie sneaks a 6th in)", cumulative("shared").rows.filter((r) => r.rank <= ADVANCE).length, 6);

  const cbRows = new Map(cumulative("countback").rows.map((r) => [r.contestantId, r.rank]));
  // countback compares latest group first: g2 33=33, then g1 → #5=24 > #6=23 → #5 above.
  assert("countback: #5 rank 5 (advances), #6 rank 6 (OUT)", [cbRows.get(C.c5_Bernadette), cbRows.get(C.c6_Desiree)], [5, 6]);
  assert("countback: exactly 5 advance", cumulative("countback").rows.filter((r) => r.rank <= ADVANCE).length, 5);

  const hsRows = new Map(cumulative("highest_single_set").rows.map((r) => [r.contestantId, r.rank]));
  // highest single group: #5=[33,24,24] vs #6=[33,25,23] → 2nd best 24 vs 25 → #6 above.
  assert("highest_single_set: #6 rank 5 (advances), #5 rank 6 (OUT) — opposite of countback!", [hsRows.get(C.c6_Desiree), hsRows.get(C.c5_Bernadette)], [5, 6]);

  // Upper tie #2/#3 at 90 also breaks under countback/highest.
  assert("countback: #3 above #2 (g2 36>35)", [cbRows.get(C.c3_Kriesha), cbRows.get(C.c2_Shanai)], [2, 3]);
}

// ── LEVEL 3: RANK-ORDER (Question & Answer) ───────────────────────────────────
// Build per-judge Q&A totals from the design (rank-order combines set totals the
// same "sum" way; there is one Q&A set).
const perJudgeTotals = new Map<string, Map<string, number>>();
for (const jid of JUDGE_IDS) {
  const totals = new Map<string, number>();
  for (const [cid, vals] of Object.entries(QANDA[jid])) {
    totals.set(cid, vals.reduce((a, b) => a + b, 0));
  }
  perJudgeTotals.set(jid, totals);
}

console.log("\n" + "═".repeat(78));
console.log("LEVEL 3 — RANK-ORDER TIE  (Q&A; lowest rank-sum wins, majority breaks ties)");
console.log("  Q&A totals  J1&J2: #1=10 #2=9 #3=8 #4=7 #5=6");
console.log("              J3   : #1=10 #3=9 #4=8 #2=7 #5=6   (J3 flips #2/#3)");
console.log("  → rank-sums: #1=3  #2=8  #3=8  #4=11  #5=15  (#2 vs #3 tie at 8)");
console.log("═".repeat(78));
const results = computeRankOrder(perJudgeTotals);
console.log("");
for (const r of results.sort((a, b) => a.placement - b.placement || a.rankSum - b.rankSum)) {
  const ranks = JUDGE_IDS.map((j, i) => `J${i + 1}:${r.ranksByJudge[j]}`).join(" ");
  console.log(`   place ${r.placement}  ${NAME[r.contestantId].padEnd(14)} rank-sum ${String(r.rankSum).padStart(2)}   (${ranks})`);
}
console.log("\n  Assertions:");
{
  const byId = new Map(results.map((r) => [r.contestantId, r]));
  assert("#1 wins outright (rank-sum 3, place 1)", [byId.get(C.c1_Kristine)!.rankSum, byId.get(C.c1_Kristine)!.placement], [3, 1]);
  assert("#2 and #3 tie on rank-sum 8", [byId.get(C.c2_Shanai)!.rankSum, byId.get(C.c3_Kriesha)!.rankSum], [8, 8]);
  // Majority: J1 & J2 rank #2 above #3, J3 ranks #3 above #2 → 2:1 → #2 wins.
  assert("majority breaks it: #2 place 2, #3 place 3", [byId.get(C.c2_Shanai)!.placement, byId.get(C.c3_Kriesha)!.placement], [2, 3]);
  assert("#4 place 4, #5 place 5", [byId.get(C.c4_Nellycha)!.placement, byId.get(C.c5_Bernadette)!.placement], [4, 5]);
}

console.log("\n" + "═".repeat(78));
console.log(failures === 0 ? "ALL ASSERTIONS PASSED ✓" : `${failures} ASSERTION(S) FAILED ✗`);
console.log("═".repeat(78));
process.exit(failures === 0 ? 0 : 1);
