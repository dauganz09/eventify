/**
 * Single source of truth for the tie-breaker test scenario on "Test Event 2026".
 *
 * The raw per-criterion scores below are deliberately engineered to produce
 * exact ties at THREE levels so we can watch how each tie-break method resolves
 * them:
 *
 *   1. PER-ROUND (within Pre-judging's 3 sets) — #2 Shanai vs #3 Kriesha tie at 27.
 *   2. CUMULATIVE (the standings that decide who advances) — two ties:
 *        • #2 Shanai vs #3 Kriesha at 90  (ordering among advancers)
 *        • #5 Bernadette vs #6 Desiree at 81 (the top-5 cut → who is eliminated)
 *   3. RANK-ORDER (Question & Answer) — #2 vs #3 tie on rank-sum 8, broken by
 *      judges' head-to-head majority.
 *
 * Groups 0–2 are points/carry-over with roundScoreMode "sum" (set totals add up,
 * group scores add up). Group 3 (Q&A) is rank_order, advances top 5.
 * For groups 0–2 all three judges give identical scores (keeps set totals clean);
 * for Q&A the judges differ (rank-order needs disagreement to be meaningful).
 */

export const EVENT_ID = "278d8b25-964b-4d2f-b67b-1aea450936ad";
export const ORG_ID = "9a514be1-5163-443a-8316-e5766deb3e89";

export const JUDGES = {
  J1: "fb1c02c2-c2c4-41b1-b1ce-1924dd9d011d",
  J2: "28bedd67-3b42-4089-b76a-01768af77d32",
  J3: "a241d583-2cbc-4c2a-9d2c-94f01c211b08",
} as const;
export const JUDGE_IDS = [JUDGES.J1, JUDGES.J2, JUDGES.J3];

export const C = {
  c1_Kristine: "832a2699-4ab6-438a-8b4f-957fbb421802",
  c2_Shanai: "a1134467-fc86-4126-b601-0b6d5778cf49",
  c3_Kriesha: "02f0d5e5-1fe5-4a4e-9654-7033b26c3e89",
  c4_Nellycha: "2be11461-47f7-4cdb-bb6f-a03b9be3b5f0",
  c5_Bernadette: "b85ddd57-eb9c-48aa-ba86-432815e6c051",
  c6_Desiree: "032ed614-7ae2-456b-bb79-8efa5a82123f",
} as const;
export const NAME: Record<string, string> = {
  [C.c1_Kristine]: "#1 Kristine",
  [C.c2_Shanai]: "#2 Shanai",
  [C.c3_Kriesha]: "#3 Kriesha",
  [C.c4_Nellycha]: "#4 Nellycha",
  [C.c5_Bernadette]: "#5 Bernadette",
  [C.c6_Desiree]: "#6 Desiree",
};
export const ALL_CONTESTANTS = Object.values(C);

// ── Round groups ──────────────────────────────────────────────────────────────
export const GROUPS = {
  prejudging: "4dec4b17-8cfd-47d6-9018-7714045a2ecd", // pos 0, points, carryOver
  closedDoor: "d49b139f-921c-41ca-bd00-b0d56ed41756", // pos 1, points, carryOver
  coronation: "d37c4803-c456-45d6-ab86-aa46b9013f45", // pos 2, points, carryOver
  qanda: "17ba9f71-6ed8-4869-9d27-393b0b92e38e", // pos 3, rank_order, advance 5
} as const;

// ── Sets (rounds) and their criteria ids ─────────────────────────────────────
// crit ids ordered by their sub-score position within the set.
export const SETS = {
  talent: { id: "8bc7de0f-9ad6-4c93-975e-75dc6c93b0e2", group: GROUPS.prejudging, crit: ["6ed9852d-ffab-4746-b4f9-2cac04654de4", "281c697b-cb91-4adb-ab29-a33ce2fbf97d", "6c19ae0a-ca6c-4cb0-934b-75d0481f2fa5"] }, // Exec 3-5, Crea 2-3, Stage 1-2
  denim: { id: "133ef3a3-43f2-49d1-8ce5-28f19b121cd5", group: GROUPS.prejudging, crit: ["2e7ccb93-b133-48a3-a8a3-b0b32c2360c6"] }, // 6-10
  prelim: { id: "88c57607-cf6b-4f10-bbba-c0a1c4b823d9", group: GROUPS.prejudging, crit: ["b8c43b5d-3614-4624-8a02-103d50b87ce9"] }, // 6-10
  advocacy: { id: "40b2d6de-0730-47ce-bf6b-f9310a446cd8", group: GROUPS.closedDoor, crit: ["84b00cb8-8069-4736-9505-48a08223015f", "9c42813b-df29-4ad4-a59e-04076f12120f", "50db5b07-5d87-46aa-87fb-3f124b23badb"] }, // Content 2-3, Mastery 3-5, Crea 1-2
  cdi: { id: "473bdf2b-c2b0-4c06-8ef3-a979cbfd8880", group: GROUPS.closedDoor, crit: ["89bea08c-f658-42e6-9ca0-332eb83d2547", "194136f4-7730-4fbb-b3f8-dccd26ec9bc5", "233e88f3-5d2e-4ecb-89e2-259add8ae899", "0dd0bbe2-bd59-4b9a-b50b-d5f922094c75"] }, // Poise 1-2, Personality 5-8, Appearance 2-4, Intelligence 4-6
  production: { id: "f59d5c98-997e-43ed-9035-8c3bad2dc1cb", group: GROUPS.coronation, crit: ["d3d47764-2b6d-4a03-be64-71d361e2f9d6"] }, // 6-10
  swimsuit: { id: "1119cbde-8648-45c8-a7fb-e29d298f870d", group: GROUPS.coronation, crit: ["42cc0de4-8323-42b3-b4d6-d76d3ef09864"] }, // 9-15
  gown: { id: "3772db30-8c6b-4f5c-b1ab-2d3404eb7ca5", group: GROUPS.coronation, crit: ["5bbe8565-0aad-48db-85aa-4bfdcedd87f5"] }, // 9-15
  qanda: { id: "7ff4d4d3-a7a8-4d08-bc3e-332f8e0ceda2", group: GROUPS.qanda, crit: ["0d15eaaf-a6a6-41d4-8da7-c5fa68ebaa34", "f011a9b6-6b79-490b-8173-64fb94089b72", "8590f7e6-1bb3-4532-8075-d4b58301d082"] }, // Beauty 2-3, Wit 3-5, Poise 1-2
} as const;

// ── Points sets: sub-criteria values per contestant (same for all 3 judges) ───
// The arrays line up with each set's `crit` order above; each row's sum is the
// contestant's set total. Comments show the resulting set total.
type Row = Record<string, number[]>;
export const POINTS: Record<string, Row> = {
  // Pre-judging (group 0) — sets: Talent, Denim, Prelim  → group sums below
  talent: {
    [C.c1_Kristine]: [5, 3, 2], // 10
    [C.c2_Shanai]: [5, 3, 2], // 10
    [C.c3_Kriesha]: [4, 2, 2], // 8
    [C.c4_Nellycha]: [5, 2, 2], // 9
    [C.c5_Bernadette]: [4, 2, 2], // 8
    [C.c6_Desiree]: [5, 2, 2], // 9
  },
  denim: {
    [C.c1_Kristine]: [10],
    [C.c2_Shanai]: [9],
    [C.c3_Kriesha]: [9],
    [C.c4_Nellycha]: [8],
    [C.c5_Bernadette]: [8],
    [C.c6_Desiree]: [8],
  },
  prelim: {
    [C.c1_Kristine]: [10],
    [C.c2_Shanai]: [8],
    [C.c3_Kriesha]: [10],
    [C.c4_Nellycha]: [8],
    [C.c5_Bernadette]: [8],
    [C.c6_Desiree]: [8],
  },
  // group 0 totals: #1=30  #2=27  #3=27  #4=25  #5=24  #6=25
  // (#2 vs #3 tie at 27 → per-round tie: Talent/Denim/Prelim = 10/9/8 vs 8/9/10)

  // Closed Door Interview (group 1) — sets: Advocacy, CDI
  advocacy: {
    [C.c1_Kristine]: [3, 5, 2], // 10
    [C.c2_Shanai]: [3, 5, 2], // 10
    [C.c3_Kriesha]: [3, 5, 1], // 9
    [C.c4_Nellycha]: [2, 5, 1], // 8
    [C.c5_Bernadette]: [2, 5, 1], // 8
    [C.c6_Desiree]: [2, 4, 1], // 7
  },
  cdi: {
    [C.c1_Kristine]: [2, 8, 4, 6], // 20
    [C.c2_Shanai]: [2, 8, 4, 4], // 18
    [C.c3_Kriesha]: [2, 8, 4, 4], // 18
    [C.c4_Nellycha]: [2, 8, 4, 4], // 18
    [C.c5_Bernadette]: [2, 6, 4, 4], // 16
    [C.c6_Desiree]: [2, 6, 4, 4], // 16
  },
  // group 1 totals: #1=30  #2=28  #3=27  #4=26  #5=24  #6=23

  // Coronation Night (group 2) — sets: Production, Swimsuit, Gown
  production: {
    [C.c1_Kristine]: [10],
    [C.c2_Shanai]: [9],
    [C.c3_Kriesha]: [9],
    [C.c4_Nellycha]: [8],
    [C.c5_Bernadette]: [8],
    [C.c6_Desiree]: [8],
  },
  swimsuit: {
    [C.c1_Kristine]: [15],
    [C.c2_Shanai]: [14],
    [C.c3_Kriesha]: [13],
    [C.c4_Nellycha]: [12],
    [C.c5_Bernadette]: [12],
    [C.c6_Desiree]: [12],
  },
  gown: {
    [C.c1_Kristine]: [15],
    [C.c2_Shanai]: [12],
    [C.c3_Kriesha]: [14],
    [C.c4_Nellycha]: [13],
    [C.c5_Bernadette]: [13],
    [C.c6_Desiree]: [13],
  },
  // group 2 totals: #1=40  #2=35  #3=36  #4=33  #5=33  #6=33
};

// Cumulative (g0+g1+g2):
//   #1=100  #2=90  #3=90  #4=84  #5=81  #6=81
//   → #2/#3 tie at 90 (advancer ordering); #5/#6 tie at 81 (the top-5 cut)

// ── Q&A (rank_order): per-judge sub-criteria values ───────────────────────────
// ALL 6 are scored so the rank-order round is complete no matter which 5 the
// advancement snapshot picks (countback keeps #5, highest_single_set keeps #6).
// Beauty/Wit/Poise. Per-judge Q&A totals:
//   J1 & J2: #1=10 #2=9 #3=8 #4=7 #5=6 #6=6
//   J3     : #1=10 #3=9 #4=8 #2=7 #5=6 #6=6   (J3 flips #2 and #3)
// → rank-sums #1=3, #2=8, #3=8, #4=11, #5=#6=15.
//   • #2 vs #3 tie at 8 → majority 2:1 → #2 (a broken tie).
//   • #5 vs #6 tie at 15 → judges split evenly → SHARED place (a shared tie).
// In a top-5 snapshot only one of #5/#6 is eligible, so the shared tie only
// appears if the cut wasn't broken (tieBreak "shared" → all 6 in the round).
export const QANDA: Record<string, Record<string, number[]>> = {
  [JUDGES.J1]: {
    [C.c1_Kristine]: [3, 5, 2], // 10
    [C.c2_Shanai]: [2, 5, 2], // 9
    [C.c3_Kriesha]: [3, 4, 1], // 8
    [C.c4_Nellycha]: [2, 4, 1], // 7
    [C.c5_Bernadette]: [2, 3, 1], // 6
    [C.c6_Desiree]: [2, 3, 1], // 6
  },
  [JUDGES.J2]: {
    [C.c1_Kristine]: [3, 5, 2], // 10
    [C.c2_Shanai]: [2, 5, 2], // 9
    [C.c3_Kriesha]: [3, 4, 1], // 8
    [C.c4_Nellycha]: [2, 4, 1], // 7
    [C.c5_Bernadette]: [2, 3, 1], // 6
    [C.c6_Desiree]: [2, 3, 1], // 6
  },
  [JUDGES.J3]: {
    [C.c1_Kristine]: [3, 5, 2], // 10
    [C.c3_Kriesha]: [2, 5, 2], // 9
    [C.c4_Nellycha]: [3, 4, 1], // 8
    [C.c2_Shanai]: [2, 4, 1], // 7
    [C.c5_Bernadette]: [2, 3, 1], // 6
    [C.c6_Desiree]: [2, 3, 1], // 6
  },
};
