/**
 * Shared ranking + tie-breaking used by both the live tabulator console and the
 * printable report, so standings are computed identically everywhere.
 *
 * Tie-break methods (configured per event in `events.config.tieBreak`):
 *  - "shared"             — contestants with equal scores share a rank (default).
 *  - "countback"          — compare set scores from the LAST set backward;
 *                           whoever scored higher in a later set ranks higher.
 *  - "highest_single_set" — the higher single best-set score wins the tie.
 *
 * With "countback"/"highest_single_set", a tie is only *shared* when contestants
 * remain exactly equal after the tie-break comparison too.
 */

export type TieBreak = "shared" | "countback" | "highest_single_set";

export const TIE_BREAKS: readonly TieBreak[] = [
  "shared",
  "countback",
  "highest_single_set",
];

export function parseTieBreak(value: unknown): TieBreak {
  return TIE_BREAKS.includes(value as TieBreak) ? (value as TieBreak) : "shared";
}

export const TIE_BREAK_LABELS: Record<TieBreak, string> = {
  shared: "Share the rank (no tie-break)",
  countback: "Countback — higher score in a later set wins",
  highest_single_set: "Highest single set score wins",
};

// ── Round score mode ─────────────────────────────────────────────────────────
// How a round's total is derived from its set totals (configured per event in
// `events.config.roundScoreMode`):
//  - "average" — mean of the scored sets (default, back-compatible).
//  - "sum"     — points-based: set totals add up (e.g. 10 + 10 + 10 = 30).

export type RoundScoreMode = "average" | "sum";

export const ROUND_SCORE_MODES: readonly RoundScoreMode[] = ["average", "sum"];

export function parseRoundScoreMode(value: unknown): RoundScoreMode {
  return ROUND_SCORE_MODES.includes(value as RoundScoreMode)
    ? (value as RoundScoreMode)
    : "average";
}

export const ROUND_SCORE_MODE_LABELS: Record<RoundScoreMode, string> = {
  average: "Average of sets",
  sum: "Sum of sets (points-based)",
};

// ── Winner method (per round group) ──────────────────────────────────────────

export type ScoringMethod = "points" | "rank_order";

export function parseScoringMethod(value: unknown): ScoringMethod {
  return value === "rank_order" ? "rank_order" : "points";
}

export interface RankInput {
  id: string;
  /** Primary ranking value (overall, desc). */
  primary: number;
  /**
   * This contestant's per-set scores ordered LAST set → first set (i.e. highest
   * set position first). Used by "countback".
   */
  setScoresByRecency: number[];
}

/**
 * Returns a map of id → rank (1 = best). Ranks are dense competition ranks:
 * tied entries share a rank and the next distinct entry skips accordingly.
 */
export function rankWithTieBreak(
  rows: RankInput[],
  tieBreak: TieBreak,
): Map<string, number> {
  const compare = (a: RankInput, b: RankInput): number => {
    if (b.primary !== a.primary) return b.primary - a.primary;
    if (tieBreak === "countback") {
      const len = Math.max(a.setScoresByRecency.length, b.setScoresByRecency.length);
      for (let i = 0; i < len; i += 1) {
        const av = a.setScoresByRecency[i] ?? 0;
        const bv = b.setScoresByRecency[i] ?? 0;
        if (bv !== av) return bv - av;
      }
    } else if (tieBreak === "highest_single_set") {
      const aSorted = [...a.setScoresByRecency].sort((x, y) => y - x);
      const bSorted = [...b.setScoresByRecency].sort((x, y) => y - x);
      const len = Math.max(aSorted.length, bSorted.length);
      for (let i = 0; i < len; i += 1) {
        const av = aSorted[i] ?? 0;
        const bv = bSorted[i] ?? 0;
        if (bv !== av) return bv - av;
      }
    }
    return 0;
  };

  const sorted = [...rows].sort(compare);
  const ranks = new Map<string, number>();
  let prev: RankInput | null = null;
  let prevRank = 0;
  sorted.forEach((row, index) => {
    const rank = prev && compare(prev, row) === 0 ? prevRank : index + 1;
    ranks.set(row.id, rank);
    prev = row;
    prevRank = rank;
  });
  return ranks;
}

// ── Manual tie-break overrides ───────────────────────────────────────────────
// A tabulator can resolve a tie that survives the automatic methods above by
// hand. Overrides are keyed by the exact set of tied contestant ids, so if the
// tie's composition later changes (a score edit adds/removes a contestant from
// the cluster), the stored order silently stops applying — the automatic
// result reappears rather than misapplying stale data.

/** Order-independent key identifying a specific set of tied contestant ids. */
export function tieKeyFor(ids: string[]): string {
  return [...ids].sort().join(",");
}

/**
 * Splits any rank/placement shared by 2+ ids into sequential ranks, in the
 * order given by a matching manual override. Ranks with no matching override
 * (or an override that isn't an exact permutation of the tied ids) are left
 * untouched.
 */
export function applyManualOverrides(
  ranks: Map<string, number>,
  overridesByTieKey: Map<string, string[]>,
): Map<string, number> {
  const idsByRank = new Map<number, string[]>();
  for (const [id, rank] of ranks.entries()) {
    const group = idsByRank.get(rank);
    if (group) group.push(id);
    else idsByRank.set(rank, [id]);
  }

  const result = new Map(ranks);
  for (const [rank, ids] of idsByRank.entries()) {
    if (ids.length < 2) continue;
    const order = overridesByTieKey.get(tieKeyFor(ids));
    if (!order) continue;
    const isExactPermutation =
      order.length === ids.length && ids.every((id) => order.includes(id));
    if (!isExactPermutation) continue;
    order.forEach((id, index) => result.set(id, rank + index));
  }
  return result;
}

// ── Rank-order scoring ───────────────────────────────────────────────────────
// Pageant-style final: each judge's totals are converted to ranks (1 = that
// judge's highest total), ranks are summed across judges, and the LOWEST
// rank-sum places first. Rank-sum ties are broken by judges' majority: the
// contestant ranked higher by more judges (head-to-head) places above; if the
// judges split evenly, the contestants share the placement.

export interface RankOrderResult {
  contestantId: string;
  /** judgeId -> rank this judge gave (1 = best). */
  ranksByJudge: Record<string, number>;
  /** judgeId -> the score this judge gave that produced their rank (null = not
   *  scored by that judge). Explains *why* a judge ranked a contestant as they did. */
  scoresByJudge: Record<string, number | null>;
  rankSum: number;
  /** Final placement (1 = winner). Tied contestants share a placement. */
  placement: number;
}

export function computeRankOrder(
  /** judgeId -> contestantId -> that judge's total for the contestant. */
  perJudgeTotals: Map<string, Map<string, number>>,
): RankOrderResult[] {
  const contestantIds = new Set<string>();
  for (const totals of perJudgeTotals.values()) {
    for (const contestantId of totals.keys()) contestantIds.add(contestantId);
  }

  // Per-judge ranks. A contestant a judge did not score ranks after everyone
  // that judge did score (shared last), so a missing score never helps.
  const ranksByJudge = new Map<string, Map<string, number>>();
  for (const [judgeId, totals] of perJudgeTotals.entries()) {
    const rankMap = rankWithTieBreak(
      Array.from(contestantIds).map((id) => ({
        id,
        primary: totals.get(id) ?? Number.NEGATIVE_INFINITY,
        setScoresByRecency: [],
      })),
      "shared",
    );
    ranksByJudge.set(judgeId, rankMap);
  }

  const rows = Array.from(contestantIds).map((contestantId) => {
    const byJudge: Record<string, number> = {};
    const scoreByJudge: Record<string, number | null> = {};
    let rankSum = 0;
    for (const [judgeId, rankMap] of ranksByJudge.entries()) {
      const rank = rankMap.get(contestantId) ?? contestantIds.size;
      byJudge[judgeId] = rank;
      scoreByJudge[judgeId] = perJudgeTotals.get(judgeId)?.get(contestantId) ?? null;
      rankSum += rank;
    }
    return { contestantId, ranksByJudge: byJudge, scoresByJudge: scoreByJudge, rankSum };
  });

  // Head-to-head: negative when more judges rank a strictly above b (a wins).
  const majority = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
    let aWins = 0;
    let bWins = 0;
    for (const judgeId of ranksByJudge.keys()) {
      const ra = a.ranksByJudge[judgeId];
      const rb = b.ranksByJudge[judgeId];
      if (ra < rb) aWins += 1;
      else if (rb < ra) bWins += 1;
    }
    return bWins - aWins;
  };

  const compare = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
    if (a.rankSum !== b.rankSum) return a.rankSum - b.rankSum;
    return majority(a, b);
  };

  const sorted = [...rows].sort(compare);
  const results: RankOrderResult[] = [];
  let prev: (typeof rows)[number] | null = null;
  let prevPlacement = 0;
  sorted.forEach((row, index) => {
    const placement = prev && compare(prev, row) === 0 ? prevPlacement : index + 1;
    results.push({ ...row, placement });
    prev = row;
    prevPlacement = placement;
  });
  return results;
}

// ── Judge-vote ballot resolution ─────────────────────────────────────────────
// Aggregates judges' individual rankings of a tied cluster into one order, via
// Borda count (sum each judge's rank position per contestant; lowest total
// wins) — the same "lowest wins" idea rankSum/computeRankOrder already uses.
// Generalizes to any tie size with no pairwise-majority-cycle handling needed.

export interface BallotResolution {
  /** Full order, best -> worst. Null when the aggregate itself stayed tied —
   *  the vote didn't produce a definitive answer; falls back to a manual break. */
  order: string[] | null;
  /** contestantId -> summed rank position across ballots (lower = better). */
  tally: Record<string, number>;
}

export function resolveBallots(
  tiedContestantIds: string[],
  ballots: Array<{ orderedContestantIds: string[] }>,
): BallotResolution {
  const tally: Record<string, number> = {};
  for (const id of tiedContestantIds) tally[id] = 0;

  for (const ballot of ballots) {
    ballot.orderedContestantIds.forEach((id, index) => {
      if (id in tally) tally[id] += index + 1;
    });
  }

  const sorted = [...tiedContestantIds].sort((a, b) => tally[a] - tally[b]);
  const hasTie = sorted.some((id, index) => index > 0 && tally[id] === tally[sorted[index - 1]]);

  return { order: hasTie ? null : sorted, tally };
}
