import { and, eq, sql } from "drizzle-orm";
import type { db } from "@/db";
import { roundGroups, rounds, scoreRecords } from "@/db/schema";
import {
  getEventTabulatorDetail,
  type EventTabulatorDetail,
  type GroupSummary,
  type JudgeSummary,
  type SetSummary,
} from "@/lib/scoring/tabulator-service";

export interface TabulatorLiveSnapshot {
  judges: JudgeSummary[];
  widgets: Pick<
    EventTabulatorDetail["widgets"],
    "progressPct" | "submitted" | "expected" | "activeJudges"
  >;
  setProgress: Array<Pick<SetSummary, "id" | "submitted" | "expected" | "completionPct">>;
  setColumns: EventTabulatorDetail["setColumns"];
  setTotals: EventTabulatorDetail["setTotals"];
  focusSetId: string | null;
  focusCriteria: EventTabulatorDetail["focusCriteria"];
  judgeColumns: EventTabulatorDetail["judgeColumns"];
  judgeMatrix: EventTabulatorDetail["judgeMatrix"];
  activeRound: EventTabulatorDetail["activeRound"];
  carriedFromRounds: EventTabulatorDetail["carriedFromRounds"];
  finalRankings: EventTabulatorDetail["finalRankings"];
  advancement: EventTabulatorDetail["advancement"];
  advancementPreview: EventTabulatorDetail["advancementPreview"];
  rankOrder: EventTabulatorDetail["rankOrder"];
  tieBreak: EventTabulatorDetail["tieBreak"];
}

async function getSubmissionCounts(
  database: typeof db,
  eventId: string,
): Promise<{
  byRound: Record<string, number>;
  byJudge: Record<string, number>;
}> {
  const [byRoundRows, byJudgeRows] = await Promise.all([
    database
      .select({
        roundId: scoreRecords.roundId,
        count: sql<number>`count(*)::int`,
      })
      .from(scoreRecords)
      .where(and(eq(scoreRecords.eventId, eventId), eq(scoreRecords.status, "submitted")))
      .groupBy(scoreRecords.roundId),
    database
      .select({
        judgeId: scoreRecords.judgeId,
        count: sql<number>`count(*)::int`,
      })
      .from(scoreRecords)
      .where(and(eq(scoreRecords.eventId, eventId), eq(scoreRecords.status, "submitted")))
      .groupBy(scoreRecords.judgeId),
  ]);

  const byRound: Record<string, number> = {};
  for (const row of byRoundRows) {
    byRound[row.roundId] = Number(row.count);
  }

  const byJudge: Record<string, number> = {};
  for (const row of byJudgeRows) {
    byJudge[row.judgeId] = Number(row.count);
  }

  return { byRound, byJudge };
}

async function resolveLiveScoreRoundIds(
  database: typeof db,
  eventId: string,
  focusSetId: string | null,
): Promise<string[]> {
  const [roundRows, groupRows] = await Promise.all([
    database
      .select({
        id: rounds.id,
        roundGroupId: rounds.roundGroupId,
        status: rounds.status,
        isManualEntry: rounds.isManualEntry,
      })
      .from(rounds)
      .where(eq(rounds.eventId, eventId)),
    database
      .select({
        id: roundGroups.id,
        status: roundGroups.status,
        scoringMethod: roundGroups.scoringMethod,
      })
      .from(roundGroups)
      .where(eq(roundGroups.eventId, eventId)),
  ]);

  const ids = new Set<string>();
  const activeGroup = groupRows.find((group) => group.status === "active");

  if (activeGroup) {
    for (const round of roundRows) {
      if (round.roundGroupId === activeGroup.id) ids.add(round.id);
    }
    // Prior finished sets feed carry-over columns and cumulative/advancement
    // preview standings while a points or rank-order round is active.
    for (const round of roundRows) {
      if (round.status === "finished") ids.add(round.id);
    }
  } else {
    for (const round of roundRows) {
      if (round.status === "active") ids.add(round.id);
    }
    for (const round of roundRows) {
      if (round.status === "finished") ids.add(round.id);
    }
  }

  for (const round of roundRows) {
    if (round.isManualEntry) ids.add(round.id);
  }

  if (focusSetId) ids.add(focusSetId);

  return [...ids];
}

function collectSetProgress(
  groups: GroupSummary[],
  ungroupedSets: SetSummary[],
): TabulatorLiveSnapshot["setProgress"] {
  const allSets = [
    ...groups.flatMap((group) => group.sets),
    ...ungroupedSets,
  ];
  return allSets.map((set) => ({
    id: set.id,
    submitted: set.submitted,
    expected: set.expected,
    completionPct: set.completionPct,
  }));
}

export function toTabulatorLiveSnapshot(
  detail: EventTabulatorDetail,
): TabulatorLiveSnapshot {
  return {
    judges: detail.judges,
    widgets: {
      progressPct: detail.widgets.progressPct,
      submitted: detail.widgets.submitted,
      expected: detail.widgets.expected,
      activeJudges: detail.widgets.activeJudges,
    },
    setProgress: collectSetProgress(detail.groups, detail.ungroupedSets),
    setColumns: detail.setColumns,
    setTotals: detail.setTotals,
    focusSetId: detail.focusSetId,
    focusCriteria: detail.focusCriteria,
    judgeColumns: detail.judgeColumns,
    judgeMatrix: detail.judgeMatrix,
    activeRound: detail.activeRound,
    carriedFromRounds: detail.carriedFromRounds,
    finalRankings: detail.finalRankings,
    advancement: detail.advancement,
    advancementPreview: detail.advancementPreview,
    rankOrder: detail.rankOrder,
    tieBreak: detail.tieBreak,
  };
}

/**
 * Lightweight loader for live tabulator updates. Scopes score value reads to
 * the active round (plus focus/manual/finished sets as needed) while keeping
 * per-set completion counts accurate via aggregate queries.
 */
export async function getEventTabulatorLiveSnapshot(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  focusSetId?: string | null;
}): Promise<TabulatorLiveSnapshot> {
  const focusSetId = params.focusSetId ?? null;
  const [counts, scoreRoundFilter] = await Promise.all([
    getSubmissionCounts(params.database, params.eventId),
    resolveLiveScoreRoundIds(params.database, params.eventId, focusSetId),
  ]);

  const detail = await getEventTabulatorDetail({
    database: params.database,
    organizationId: params.organizationId,
    eventId: params.eventId,
    focusSetId,
    scoreRoundFilter,
    submissionCountByRound: counts.byRound,
    submissionCountByJudge: counts.byJudge,
  });

  return toTabulatorLiveSnapshot(detail);
}
