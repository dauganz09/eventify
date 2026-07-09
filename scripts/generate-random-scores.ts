/**
 * Generates random submitted scores for an event so you can test print reports.
 *
 * Respects each criterion's min/max/step, only assigns scores to judges who are
 * assigned to that set/round (same rules as the tabulator), and skips archived
 * contestants. When a round group has a qualifier snapshot, only those
 * contestants are scored for sets in that group.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/generate-random-scores.ts
 *   npx tsx --env-file=.env scripts/generate-random-scores.ts --event-id=<uuid>
 *   npx tsx --env-file=.env scripts/generate-random-scores.ts --sets=active
 *   npx tsx --env-file=.env scripts/generate-random-scores.ts --keep-existing
 *   npx tsx --env-file=.env scripts/generate-random-scores.ts --seed=42
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  contestants,
  criteria,
  events,
  judgeAssignments,
  judges,
  roundGroups,
  rounds,
  scoreRecords,
} from "@/db/schema";

type Insert = typeof scoreRecords.$inferInsert;

interface CriterionRow {
  id: string;
  roundId: string;
  minValue: string | null;
  maxValue: string | null;
  stepValue: string | null;
  isRequired: boolean;
}

interface SetRow {
  id: string;
  name: string;
  roundGroupId: string | null;
  status: string;
  isManualEntry: boolean;
}

interface GroupRow {
  id: string;
  qualifiedContestantIds: string[] | null;
}

interface AssignmentRow {
  judgeId: string;
  roundId: string | null;
  roundGroupId: string | null;
}

function parseArgs(argv: string[]) {
  let eventId: string | undefined;
  let sets: "all" | "active" = "all";
  let keepExisting = false;
  let seed: number | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--event-id=")) eventId = arg.slice("--event-id=".length);
    else if (arg === "--keep-existing") keepExisting = true;
    else if (arg.startsWith("--sets=")) {
      const value = arg.slice("--sets=".length);
      if (value === "all" || value === "active") sets = value;
      else throw new Error(`Invalid --sets value: ${value} (use "all" or "active")`);
    } else if (arg.startsWith("--seed=")) {
      seed = Number(arg.slice("--seed=".length));
      if (!Number.isFinite(seed)) throw new Error(`Invalid --seed value: ${arg}`);
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npx tsx --env-file=.env scripts/generate-random-scores.ts [options]

Options:
  --event-id=<uuid>   Event to score (default: first active, non-deleted event)
  --sets=all|active   Score all sets or only active ones (default: all)
  --keep-existing     Do not wipe existing scores for this event first
  --seed=<number>     Reproducible random values
  --help              Show this help text
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { eventId, sets, keepExisting, seed };
}

function createRng(seed?: number) {
  if (seed === undefined) return Math.random;
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomScore(
  criterion: Pick<CriterionRow, "minValue" | "maxValue" | "stepValue">,
  rng: () => number,
) {
  const min = criterion.minValue != null ? Number(criterion.minValue) : 0;
  const max = criterion.maxValue != null ? Number(criterion.maxValue) : 10;
  const step =
    criterion.stepValue != null && Number(criterion.stepValue) > 0
      ? Number(criterion.stepValue)
      : 1;
  const steps = Math.max(0, Math.floor((max - min) / step + 1e-9));
  const pick = Math.floor(rng() * (steps + 1));
  return Math.round((min + pick * step) * 1000) / 1000;
}

function judgesForSet(
  setRow: SetRow,
  roundRows: SetRow[],
  assignmentRows: AssignmentRow[],
  activeJudgeIds: string[],
  systemJudgeId: string | null,
): string[] {
  if (setRow.isManualEntry && systemJudgeId) return [systemJudgeId];

  const groupId = setRow.roundGroupId;
  const ids = new Set<string>();
  for (const assignment of assignmentRows) {
    const eventWide = assignment.roundId === null && assignment.roundGroupId === null;
    const matchesSet = assignment.roundId === setRow.id;
    const matchesRound =
      assignment.roundGroupId !== null && assignment.roundGroupId === groupId;
    if (eventWide || matchesSet || matchesRound) ids.add(assignment.judgeId);
  }

  if (ids.size === 0) return activeJudgeIds;
  return Array.from(ids).filter((id) => activeJudgeIds.includes(id));
}

function contestantsForSet(
  setRow: SetRow,
  groupRows: GroupRow[],
  contestantIds: string[],
) {
  if (!setRow.roundGroupId) return contestantIds;
  const group = groupRows.find((g) => g.id === setRow.roundGroupId);
  const qualified = group?.qualifiedContestantIds ?? [];
  if (qualified.length === 0) return contestantIds;
  const allowed = new Set(qualified);
  return contestantIds.filter((id) => allowed.has(id));
}

async function resolveEventId(explicitId?: string) {
  if (explicitId) {
    const [event] = await db
      .select({ id: events.id, name: events.name, status: events.status })
      .from(events)
      .where(and(eq(events.id, explicitId), isNull(events.deletedAt)))
      .limit(1);
    if (!event) throw new Error(`Event not found: ${explicitId}`);
    return event;
  }

  const activeEvents = await db
    .select({ id: events.id, name: events.name, status: events.status })
    .from(events)
    .where(and(eq(events.status, "active"), isNull(events.deletedAt)))
    .orderBy(asc(events.updatedAt));

  if (activeEvents.length === 0) {
    throw new Error(
      'No active event found. Pass --event-id=<uuid> or set an event to "active" in the builder.',
    );
  }

  if (activeEvents.length > 1) {
    console.log(
      `Multiple active events found; using "${activeEvents[0].name}" (${activeEvents[0].id}).`,
    );
    console.log("Pass --event-id=<uuid> to target a specific event.");
  }

  return activeEvents[0];
}

async function main() {
  const { eventId: explicitEventId, sets, keepExisting, seed } = parseArgs(process.argv.slice(2));
  const rng = createRng(seed);
  const event = await resolveEventId(explicitEventId);

  const [
    [eventRow],
    groupRows,
    setRows,
    criteriaRows,
    contestantRows,
    judgeRows,
    assignmentRows,
  ] = await Promise.all([
    db
      .select({ organizationId: events.organizationId })
      .from(events)
      .where(eq(events.id, event.id))
      .limit(1),
    db
      .select({
        id: roundGroups.id,
        qualifiedContestantIds: roundGroups.qualifiedContestantIds,
      })
      .from(roundGroups)
      .where(eq(roundGroups.eventId, event.id)),
    db
      .select({
        id: rounds.id,
        name: rounds.name,
        roundGroupId: rounds.roundGroupId,
        status: rounds.status,
        isManualEntry: rounds.isManualEntry,
      })
      .from(rounds)
      .where(eq(rounds.eventId, event.id))
      .orderBy(asc(rounds.position)),
    db
      .select({
        id: criteria.id,
        roundId: criteria.roundId,
        minValue: criteria.minValue,
        maxValue: criteria.maxValue,
        stepValue: criteria.stepValue,
        isRequired: criteria.isRequired,
      })
      .from(criteria)
      .where(eq(criteria.eventId, event.id)),
    db
      .select({ id: contestants.id })
      .from(contestants)
      .where(and(eq(contestants.eventId, event.id), isNull(contestants.archivedAt))),
    db
      .select({
        id: judges.id,
        isActive: judges.isActive,
        isSystem: judges.isSystem,
      })
      .from(judges)
      .where(eq(judges.eventId, event.id)),
    db
      .select({
        judgeId: judgeAssignments.judgeId,
        roundId: judgeAssignments.roundId,
        roundGroupId: judgeAssignments.roundGroupId,
      })
      .from(judgeAssignments)
      .where(eq(judgeAssignments.eventId, event.id)),
  ]);

  if (!eventRow) throw new Error(`Event row missing: ${event.id}`);

  const activeJudgeIds = judgeRows
    .filter((judge) => judge.isActive && !judge.isSystem)
    .map((judge) => judge.id);
  const systemJudgeId = judgeRows.find((judge) => judge.isSystem)?.id ?? null;
  const contestantIds = contestantRows.map((row) => row.id);

  if (contestantIds.length === 0) {
    throw new Error("Event has no active contestants.");
  }
  if (activeJudgeIds.length === 0 && !systemJudgeId) {
    throw new Error("Event has no active judges.");
  }

  const targetSets = setRows.filter((setRow) => sets === "all" || setRow.status === "active");
  if (targetSets.length === 0) {
    throw new Error(`No ${sets === "active" ? "active " : ""}sets found for this event.`);
  }

  const criteriaBySet = new Map<string, CriterionRow[]>();
  for (const criterion of criteriaRows) {
    const bucket = criteriaBySet.get(criterion.roundId) ?? [];
    bucket.push(criterion);
    criteriaBySet.set(criterion.roundId, bucket);
  }

  const now = new Date();
  const rows: Insert[] = [];
  const summary: Array<{ set: string; judges: number; contestants: number; criteria: number }> = [];

  for (const setRow of targetSets) {
    const setCriteria = (criteriaBySet.get(setRow.id) ?? []).filter((c) => c.isRequired);
    if (setCriteria.length === 0) continue;

    const setJudgeIds = judgesForSet(
      setRow,
      setRows,
      assignmentRows,
      activeJudgeIds,
      systemJudgeId,
    );
    if (setJudgeIds.length === 0) {
      console.warn(`Skipping "${setRow.name}": no assigned judges.`);
      continue;
    }

    const setContestantIds = contestantsForSet(setRow, groupRows, contestantIds);
    if (setContestantIds.length === 0) {
      console.warn(`Skipping "${setRow.name}": no eligible contestants.`);
      continue;
    }

    for (const judgeId of setJudgeIds) {
      for (const contestantId of setContestantIds) {
        for (const criterion of setCriteria) {
          rows.push({
            organizationId: eventRow.organizationId,
            eventId: event.id,
            roundId: setRow.id,
            contestantId,
            judgeId,
            criterionId: criterion.id,
            value: randomScore(criterion, rng).toString(),
            status: "submitted",
            revision: 1,
            submittedAt: now,
          });
        }
      }
    }

    summary.push({
      set: setRow.name,
      judges: setJudgeIds.length,
      contestants: setContestantIds.length,
      criteria: setCriteria.length,
    });
  }

  if (rows.length === 0) {
    throw new Error("Nothing to insert — check that sets have criteria and judge assignments.");
  }

  await db.transaction(async (tx) => {
    if (!keepExisting) {
      await tx.delete(scoreRecords).where(eq(scoreRecords.eventId, event.id));
    }

    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(scoreRecords).values(rows.slice(i, i + 500));
    }
  });

  console.log(`Generated ${rows.length} random scores for "${event.name}" (${event.id}).`);
  if (!keepExisting) console.log("Existing scores for this event were cleared first.");
  console.log("");
  for (const line of summary) {
    console.log(
      `  ${line.set}: ${line.judges} judge(s) × ${line.contestants} contestant(s) × ${line.criteria} criterion/criteria`,
    );
  }
  console.log("");
  console.log("Open the tabulator print view to review reports.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
