import { and, asc, eq, isNull } from "drizzle-orm";
import type { db } from "@/db";
import {
  contestants,
  criteria,
  events,
  judgeAssignments,
  judges,
  roundGroups,
  rounds as roundsTable,
  scoreRecords,
} from "@/db/schema";

export interface JudgeCriterionColumn {
  id: string;
  name: string;
  weight: number;
}

export interface JudgeContestantRow {
  contestantId: string;
  displayName: string;
  displayNumber: string | null;
  /** criterionId → raw score */
  scores: Record<string, number | null>;
  /** Weighted sum across scored criteria (null when nothing scored). */
  total: number | null;
}

export interface JudgeSetReport {
  setId: string;
  setName: string;
  criteria: JudgeCriterionColumn[];
  rows: JudgeContestantRow[];
}

export interface JudgeRoundReport {
  roundId: string;
  roundName: string;
  sets: JudgeSetReport[];
}

export interface JudgeScoresReport {
  event: { id: string; name: string; logoUrl: string | null };
  judge: { id: string; displayName: string };
  generatedAt: string;
  rounds: JudgeRoundReport[];
  ungroupedSets: JudgeSetReport[];
}

export interface JudgeScoresReportPicker {
  event: { id: string; name: string; logoUrl: string | null };
  judges: { id: string; displayName: string }[];
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function loadEventJudges(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
}) {
  const [eventRow] = await params.database
    .select({ id: events.id, name: events.name, logoUrl: events.logoUrl })
    .from(events)
    .where(
      and(eq(events.id, params.eventId), eq(events.organizationId, params.organizationId)),
    )
    .limit(1);
  if (!eventRow) throw new Error("Event not found.");

  const judgeRows = await params.database
    .select({ id: judges.id, displayName: judges.displayName })
    .from(judges)
    .where(
      and(
        eq(judges.eventId, params.eventId),
        eq(judges.isActive, true),
        eq(judges.isSystem, false),
      ),
    )
    .orderBy(asc(judges.displayName));

  return { eventRow, judgeRows };
}

/** Judges available for the per-judge scores print picker. */
export async function getJudgeScoresReportPicker(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
}): Promise<JudgeScoresReportPicker> {
  const { eventRow, judgeRows } = await loadEventJudges(params);
  return {
    event: {
      id: eventRow.id,
      name: eventRow.name,
      logoUrl: eventRow.logoUrl,
    },
    judges: judgeRows.map((j) => ({ id: j.id, displayName: j.displayName })),
  };
}

/**
 * All scores one judge submitted, scoped to the sets / rounds they are assigned
 * to (event-wide, round-group, or set-level assignment).
 */
export async function getJudgeScoresReport(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  judgeId: string;
}): Promise<JudgeScoresReport> {
  const { database, organizationId, eventId, judgeId } = params;
  const { eventRow, judgeRows } = await loadEventJudges({
    database,
    organizationId,
    eventId,
  });

  const judge = judgeRows.find((j) => j.id === judgeId);
  if (!judge) throw new Error("Judge not found.");

  const [groupRows, roundRows, contestantRows, criteriaRows, assignmentRows, scoreRows] =
    await Promise.all([
      database
        .select({
          id: roundGroups.id,
          name: roundGroups.name,
          position: roundGroups.position,
          qualifiedContestantIds: roundGroups.qualifiedContestantIds,
          advanceCount: roundGroups.advanceCount,
        })
        .from(roundGroups)
        .where(eq(roundGroups.eventId, eventId))
        .orderBy(asc(roundGroups.position), asc(roundGroups.createdAt)),

      database
        .select({
          id: roundsTable.id,
          name: roundsTable.name,
          position: roundsTable.position,
          roundGroupId: roundsTable.roundGroupId,
          isManualEntry: roundsTable.isManualEntry,
        })
        .from(roundsTable)
        .where(eq(roundsTable.eventId, eventId))
        .orderBy(asc(roundsTable.position), asc(roundsTable.createdAt)),

      database
        .select({
          id: contestants.id,
          displayName: contestants.displayName,
          displayNumber: contestants.displayNumber,
        })
        .from(contestants)
        .where(and(eq(contestants.eventId, eventId), isNull(contestants.archivedAt)))
        .orderBy(asc(contestants.position), asc(contestants.displayName)),

      database
        .select({
          id: criteria.id,
          roundId: criteria.roundId,
          name: criteria.name,
          weight: criteria.weight,
          position: criteria.position,
        })
        .from(criteria)
        .where(eq(criteria.eventId, eventId))
        .orderBy(asc(criteria.position), asc(criteria.name)),

      database
        .select({
          judgeId: judgeAssignments.judgeId,
          roundId: judgeAssignments.roundId,
          roundGroupId: judgeAssignments.roundGroupId,
        })
        .from(judgeAssignments)
        .where(eq(judgeAssignments.eventId, eventId)),

      database
        .select({
          roundId: scoreRecords.roundId,
          contestantId: scoreRecords.contestantId,
          criterionId: scoreRecords.criterionId,
          value: scoreRecords.value,
        })
        .from(scoreRecords)
        .where(
          and(
            eq(scoreRecords.eventId, eventId),
            eq(scoreRecords.judgeId, judgeId),
            eq(scoreRecords.status, "submitted"),
          ),
        ),
    ]);

  const activeJudgeIds = new Set(judgeRows.map((j) => j.id));

  function judgesForSet(setId: string): string[] {
    const setRow = roundRows.find((r) => r.id === setId);
    if (setRow?.isManualEntry) return [];
    const groupId = setRow?.roundGroupId ?? null;
    const assigned = new Set<string>();
    for (const a of assignmentRows) {
      const eventWide = a.roundId === null && a.roundGroupId === null;
      const matchesRound = a.roundGroupId !== null && a.roundGroupId === groupId;
      if (eventWide || a.roundId === setId || matchesRound) assigned.add(a.judgeId);
    }
    const pool = assigned.size === 0 ? activeJudgeIds : assigned;
    return Array.from(pool).filter((id) => activeJudgeIds.has(id));
  }

  function isJudgeAssignedToSet(setId: string) {
    return judgesForSet(setId).includes(judgeId);
  }

  function contestantsForSet(setId: string) {
    const setRow = roundRows.find((r) => r.id === setId);
    if (!setRow?.roundGroupId) return contestantRows;
    const group = groupRows.find((g) => g.id === setRow.roundGroupId);
    const qualified = group?.qualifiedContestantIds ?? [];
    if (qualified.length === 0) return contestantRows;
    const allowed = new Set(qualified);
    return contestantRows.filter((c) => allowed.has(c.id));
  }

  const scoreIndex = new Map<string, Map<string, number>>();
  for (const row of scoreRows) {
    if (row.value === null) continue;
    const byCriterion = scoreIndex.get(row.roundId) ?? new Map<string, number>();
    byCriterion.set(`${row.contestantId}::${row.criterionId}`, Number(row.value));
    scoreIndex.set(row.roundId, byCriterion);
  }

  function buildSetReport(setRow: (typeof roundRows)[number]): JudgeSetReport | null {
    if (!isJudgeAssignedToSet(setRow.id)) return null;

    const setCriteria = criteriaRows
      .filter((c) => c.roundId === setRow.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        weight: Number(c.weight ?? 100),
      }));

    const byCriterion = scoreIndex.get(setRow.id);
    const scopedContestants = contestantsForSet(setRow.id);

    const rows: JudgeContestantRow[] = scopedContestants.map((contestant) => {
      const scores: Record<string, number | null> = {};
      let total = 0;
      let scoredCount = 0;

      for (const crit of setCriteria) {
        const raw = byCriterion?.get(`${contestant.id}::${crit.id}`) ?? null;
        scores[crit.id] = raw;
        if (raw !== null) {
          total += raw * (crit.weight / 100);
          scoredCount += 1;
        }
      }

      return {
        contestantId: contestant.id,
        displayName: contestant.displayName,
        displayNumber: contestant.displayNumber,
        scores,
        total: scoredCount > 0 ? round2(total) : null,
      };
    });

    const hasAnyScore = rows.some((r) => r.total !== null);
    if (!hasAnyScore && setCriteria.length === 0) return null;

    return {
      setId: setRow.id,
      setName: setRow.name,
      criteria: setCriteria,
      rows,
    };
  }

  const setByGroup = new Map<string | null, typeof roundRows>();
  for (const r of roundRows) {
    const key = r.roundGroupId ?? null;
    const bucket = setByGroup.get(key) ?? [];
    bucket.push(r);
    setByGroup.set(key, bucket);
  }

  const roundReports: JudgeRoundReport[] = groupRows
    .map((group) => ({
      roundId: group.id,
      roundName: group.name,
      sets: (setByGroup.get(group.id) ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map(buildSetReport)
        .filter((set): set is JudgeSetReport => set !== null),
    }))
    .filter((round) => round.sets.length > 0);

  const ungroupedSets = (setByGroup.get(null) ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(buildSetReport)
    .filter((set): set is JudgeSetReport => set !== null);

  return {
    event: {
      id: eventRow.id,
      name: eventRow.name,
      logoUrl: eventRow.logoUrl,
    },
    judge: { id: judge.id, displayName: judge.displayName },
    generatedAt: new Date().toISOString(),
    rounds: roundReports,
    ungroupedSets,
  };
}
