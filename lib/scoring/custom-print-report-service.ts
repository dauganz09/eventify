import { createHash } from "crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { db } from "@/db";
import { customPrintReports, events } from "@/db/schema";
import {
  parseTieBreak,
  rankWithTieBreak,
  type RoundScoreMode,
  type TieBreak,
} from "@/lib/scoring/ranking";
import {
  getEventResultsReport,
  type JudgeReport,
  type RankedRow,
  type ResultsReport,
  type SetReport,
} from "@/lib/scoring/print-report-service";

export interface CustomPrintReport {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  setIds: string[];
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomPrintReportSetLabel {
  id: string;
  label: string;
}

export interface CustomPrintReportResults {
  definition: CustomPrintReport;
  event: ResultsReport["event"];
  generatedAt: string;
  contestants: number;
  /** Human-readable labels for the combined sets, in selection order. */
  setLabels: CustomPrintReportSetLabel[];
  /** Per-set rankings for the selected sets only. */
  sets: SetReport[];
  /** Combined ranking across the selected sets. */
  ranking: RankedRow[];
  roundScoreMode: RoundScoreMode;
  verificationCode: string;
  judges: JudgeReport[];
}

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function allSetsFromReport(report: ResultsReport): SetReport[] {
  return [...report.rounds.flatMap((round) => round.sets), ...report.ungroupedSets];
}

function setLabelInReport(report: ResultsReport, setId: string): string {
  for (const round of report.rounds) {
    const set = round.sets.find((s) => s.id === setId);
    if (set) return `${round.name} · ${set.name}`;
  }
  const ungrouped = report.ungroupedSets.find((s) => s.id === setId);
  if (ungrouped) return ungrouped.name;
  return setId;
}

function judgeTotalsAcrossSetsFromReport(
  allSets: SetReport[],
  setIds: string[],
  contestantId: string,
  roundScoreMode: RoundScoreMode,
): Record<string, number> {
  const acc = new Map<string, { sum: number; count: number }>();
  for (const setId of setIds) {
    const set = allSets.find((s) => s.id === setId);
    const row = set?.ranking.find((r) => r.contestantId === contestantId);
    if (!row) continue;
    for (const [judgeId, total] of Object.entries(row.scoresByJudge)) {
      const cur = acc.get(judgeId) ?? { sum: 0, count: 0 };
      cur.sum += total;
      cur.count += 1;
      acc.set(judgeId, cur);
    }
  }
  const out: Record<string, number> = {};
  for (const [judgeId, { sum, count }] of acc.entries()) {
    out[judgeId] = round4(roundScoreMode === "sum" ? sum : sum / count);
  }
  return out;
}

export function buildCombinedRankingFromReport(
  report: ResultsReport,
  setIds: string[],
  tieBreak: TieBreak,
): RankedRow[] {
  const allSets = allSetsFromReport(report);
  const orderedSetIds = setIds.filter((id) => allSets.some((s) => s.id === id));
  if (orderedSetIds.length === 0) return [];

  const contestantMap = new Map<
    string,
    { displayNumber: string | null; displayName: string }
  >();
  for (const set of allSets) {
    for (const row of set.ranking) {
      contestantMap.set(row.contestantId, {
        displayNumber: row.displayNumber,
        displayName: row.displayName,
      });
    }
  }
  for (const row of report.overall) {
    contestantMap.set(row.contestantId, {
      displayNumber: row.displayNumber,
      displayName: row.displayName,
    });
  }

  const rows = Array.from(contestantMap.entries()).map(([id, info]) => {
    let sum = 0;
    let scoredCount = 0;
    const setScoresByRecency: number[] = [];
    for (const setId of [...orderedSetIds].reverse()) {
      const set = allSets.find((s) => s.id === setId);
      const row = set?.ranking.find((r) => r.contestantId === id);
      const value = row?.value;
      if (value !== undefined) {
        sum += value;
        scoredCount += 1;
      }
      setScoresByRecency.push(value ?? 0);
    }
    const value =
      scoredCount === 0
        ? 0
        : round4(report.roundScoreMode === "sum" ? sum : sum / scoredCount);
    return { id, ...info, value, scoredCount, setScoresByRecency };
  });

  const scored = rows.filter((r) => r.scoredCount > 0);
  const rankMap = rankWithTieBreak(
    scored.map((r) => ({
      id: r.id,
      primary: r.value,
      setScoresByRecency: r.setScoresByRecency,
    })),
    tieBreak,
  );

  return scored
    .map((r) => ({
      rank: rankMap.get(r.id) ?? 0,
      contestantId: r.id,
      displayNumber: r.displayNumber,
      displayName: r.displayName,
      value: r.value,
      scoredCount: r.scoredCount,
      scoresByJudge: judgeTotalsAcrossSetsFromReport(
        allSets,
        orderedSetIds,
        r.id,
        report.roundScoreMode,
      ),
    }))
    .sort((a, b) => a.rank - b.rank || b.value - a.value);
}

function dedupeJudges(judges: JudgeReport[]): JudgeReport[] {
  const seen = new Set<string>();
  const out: JudgeReport[] = [];
  for (const judge of judges) {
    if (seen.has(judge.id)) continue;
    seen.add(judge.id);
    out.push(judge);
  }
  return out;
}

function mapCustomPrintReport(row: typeof customPrintReports.$inferSelect): CustomPrintReport {
  return {
    id: row.id,
    eventId: row.eventId,
    name: row.name,
    description: row.description,
    setIds: row.setIds,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listCustomPrintReports(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
}): Promise<CustomPrintReport[]> {
  const { database, organizationId, eventId } = params;
  await assertEventInOrg(database, eventId, organizationId);

  const rows = await database
    .select()
    .from(customPrintReports)
    .where(eq(customPrintReports.eventId, eventId))
    .orderBy(asc(customPrintReports.position), asc(customPrintReports.createdAt));

  return rows.map(mapCustomPrintReport);
}

export async function getCustomPrintReport(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  reportId: string;
}): Promise<CustomPrintReport | null> {
  const { database, organizationId, eventId, reportId } = params;
  await assertEventInOrg(database, eventId, organizationId);

  const [row] = await database
    .select()
    .from(customPrintReports)
    .where(
      and(
        eq(customPrintReports.id, reportId),
        eq(customPrintReports.eventId, eventId),
      ),
    )
    .limit(1);

  return row ? mapCustomPrintReport(row) : null;
}

export async function getCustomPrintReportResults(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  reportId: string;
}): Promise<CustomPrintReportResults> {
  const { database, organizationId, eventId, reportId } = params;

  const definition = await getCustomPrintReport({
    database,
    organizationId,
    eventId,
    reportId,
  });
  if (!definition) throw new Error("Custom report not found.");
  if (definition.setIds.length === 0) throw new Error("Custom report has no sets.");

  const [eventRow] = await database
    .select({ config: events.config })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  const tieBreak = parseTieBreak(
    (eventRow?.config as Record<string, unknown> | null)?.tieBreak,
  );

  const fullReport = await getEventResultsReport({
    database,
    organizationId,
    eventId,
  });

  const allSets = allSetsFromReport(fullReport);
  const selectedSets = definition.setIds
    .map((id) => allSets.find((s) => s.id === id))
    .filter((s): s is SetReport => s !== undefined);

  const ranking = buildCombinedRankingFromReport(
    fullReport,
    definition.setIds,
    tieBreak,
  );

  const judges = dedupeJudges(selectedSets.flatMap((set) => set.judges));

  const verificationCode = createHash("sha256")
    .update(
      JSON.stringify([
        definition.id,
        definition.setIds,
        ranking.map((r) => [r.contestantId, r.rank, r.value]),
      ]),
    )
    .digest("hex")
    .slice(0, 12)
    .toUpperCase()
    .replace(/(.{4})(.{4})(.{4})/, "$1-$2-$3");

  return {
    definition,
    event: fullReport.event,
    generatedAt: new Date().toISOString(),
    contestants: fullReport.contestants,
    setLabels: definition.setIds.map((id) => ({
      id,
      label: setLabelInReport(fullReport, id),
    })),
    sets: selectedSets,
    ranking,
    roundScoreMode: fullReport.roundScoreMode,
    verificationCode,
    judges,
  };
}

export async function createCustomPrintReport(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  name: string;
  description?: string | null;
  setIds: string[];
}): Promise<CustomPrintReport> {
  const { database, organizationId, eventId, name, description, setIds } = params;
  await assertEventInOrg(database, eventId, organizationId);
  await assertSetsBelongToEvent(database, eventId, setIds);

  const existing = await database
    .select({ position: customPrintReports.position })
    .from(customPrintReports)
    .where(eq(customPrintReports.eventId, eventId))
    .orderBy(asc(customPrintReports.position));

  const nextPosition =
    existing.length > 0 ? Math.max(...existing.map((r) => r.position)) + 1 : 0;

  const [row] = await database
    .insert(customPrintReports)
    .values({
      eventId,
      name,
      description: description ?? null,
      setIds,
      position: nextPosition,
    })
    .returning();

  return mapCustomPrintReport(row);
}

export async function updateCustomPrintReport(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  reportId: string;
  name: string;
  description?: string | null;
  setIds: string[];
}): Promise<CustomPrintReport> {
  const { database, organizationId, eventId, reportId, name, description, setIds } =
    params;
  await assertEventInOrg(database, eventId, organizationId);
  await assertSetsBelongToEvent(database, eventId, setIds);

  const [row] = await database
    .update(customPrintReports)
    .set({
      name,
      description: description ?? null,
      setIds,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(customPrintReports.id, reportId),
        eq(customPrintReports.eventId, eventId),
      ),
    )
    .returning();

  if (!row) throw new Error("Custom report not found.");
  return mapCustomPrintReport(row);
}

export async function deleteCustomPrintReport(params: {
  database: typeof db;
  organizationId: string;
  eventId: string;
  reportId: string;
}): Promise<void> {
  const { database, organizationId, eventId, reportId } = params;
  await assertEventInOrg(database, eventId, organizationId);

  const [row] = await database
    .delete(customPrintReports)
    .where(
      and(
        eq(customPrintReports.id, reportId),
        eq(customPrintReports.eventId, eventId),
      ),
    )
    .returning({ id: customPrintReports.id });

  if (!row) throw new Error("Custom report not found.");
}

async function assertEventInOrg(
  database: typeof db,
  eventId: string,
  organizationId: string,
) {
  const [row] = await database
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.id, eventId),
        eq(events.organizationId, organizationId),
        isNull(events.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Event not found.");
}

async function assertSetsBelongToEvent(
  database: typeof db,
  eventId: string,
  setIds: string[],
) {
  if (setIds.length === 0) throw new Error("Select at least one set.");
  const unique = new Set(setIds);
  if (unique.size !== setIds.length) throw new Error("Duplicate sets are not allowed.");

  const { rounds } = await import("@/db/schema");
  const rows = await database
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.eventId, eventId));

  const validIds = new Set(rows.map((r) => r.id));
  for (const setId of setIds) {
    if (!validIds.has(setId)) throw new Error("One or more sets are invalid for this event.");
  }
}
