import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import { aggregateResults, criteria, scoreRecords, scoringRules } from "@/db/schema";
import { calculateContestantResults } from "@/lib/scoring/calculate";
import type { AggregationRule, CriterionConfig, SubmittedScore } from "@/lib/scoring/types";

const AGGREGATION_RULES: readonly AggregationRule[] = [
  "sum",
  "average",
  "weighted_sum",
  "drop_high",
  "drop_low",
  "drop_high_low",
];

function toAggregationRule(value: string | null | undefined): AggregationRule {
  return AGGREGATION_RULES.includes(value as AggregationRule)
    ? (value as AggregationRule)
    : "weighted_sum";
}

/**
 * Recomputes cached standings for one set (round) after a score sync.
 * Scoped to a single round so concurrent judges don't trigger a full-event
 * recalculation on every write.
 */
export async function refreshRoundAggregateResults(params: {
  database: typeof db;
  eventId: string;
  roundId: string;
}): Promise<void> {
  const { database, eventId, roundId } = params;

  const [criteriaRows, ruleRows, scoreRows] = await Promise.all([
    database
      .select({
        id: criteria.id,
        name: criteria.name,
        roundId: criteria.roundId,
        weight: criteria.weight,
        minValue: criteria.minValue,
        maxValue: criteria.maxValue,
        isRequired: criteria.isRequired,
      })
      .from(criteria)
      .where(and(eq(criteria.eventId, eventId), eq(criteria.roundId, roundId))),
    database
      .select({ roundId: scoringRules.roundId, aggregation: scoringRules.aggregation })
      .from(scoringRules)
      .where(eq(scoringRules.eventId, eventId)),
    database
      .select({
        contestantId: scoreRecords.contestantId,
        judgeId: scoreRecords.judgeId,
        criterionId: scoreRecords.criterionId,
        value: scoreRecords.value,
      })
      .from(scoreRecords)
      .where(
        and(
          eq(scoreRecords.eventId, eventId),
          eq(scoreRecords.roundId, roundId),
          eq(scoreRecords.status, "submitted"),
        ),
      ),
  ]);

  await database.transaction(async (tx) => {
    await tx
      .delete(aggregateResults)
      .where(and(eq(aggregateResults.eventId, eventId), eq(aggregateResults.roundId, roundId)));

    const scores: SubmittedScore[] = scoreRows
      .filter((row) => row.value !== null)
      .map((row) => ({
        contestantId: row.contestantId,
        judgeId: row.judgeId,
        criterionId: row.criterionId,
        value: Number(row.value),
      }));

    if (scores.length === 0) return;

    const aggregationRule = toAggregationRule(
      ruleRows.find((rule) => rule.roundId === roundId)?.aggregation ??
        ruleRows.find((rule) => rule.roundId === null)?.aggregation,
    );

    const criteriaConfigs: CriterionConfig[] = criteriaRows.map((criterion) => ({
      id: criterion.id,
      name: criterion.name,
      weight: Number(criterion.weight ?? 1),
      minValue: criterion.minValue === null ? undefined : Number(criterion.minValue),
      maxValue: criterion.maxValue === null ? undefined : Number(criterion.maxValue),
      isRequired: criterion.isRequired,
    }));

    const results = calculateContestantResults({
      criteria: criteriaConfigs,
      scores,
      aggregationRule,
    });

    for (const result of results) {
      await tx.insert(aggregateResults).values({
        eventId,
        roundId,
        contestantId: result.contestantId,
        total: String(result.total),
        rank: result.rank,
        breakdown: { items: result.breakdown, aggregationRule },
      });
    }
  });
}

export async function refreshRoundAggregatesForSync(params: {
  database: typeof db;
  eventId: string;
  roundIds: Iterable<string>;
  operation: string;
}): Promise<void> {
  if (params.operation === "draft_saved") return;

  const uniqueRoundIds = [...new Set(params.roundIds)];
  await Promise.all(
    uniqueRoundIds.map((roundId) =>
      refreshRoundAggregateResults({
        database: params.database,
        eventId: params.eventId,
        roundId,
      }),
    ),
  );
}
