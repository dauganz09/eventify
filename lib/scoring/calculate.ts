import type {
  AggregationRule,
  ContestantResult,
  CriterionConfig,
  ScoreBreakdownItem,
  SubmittedScore,
} from "@/lib/scoring/types";

export function validateScoreValue(score: number, criterion: CriterionConfig) {
  if (Number.isNaN(score)) return "Score must be a number.";
  if (criterion.minValue !== undefined && score < criterion.minValue) {
    return `Score must be at least ${criterion.minValue}.`;
  }
  if (criterion.maxValue !== undefined && score > criterion.maxValue) {
    return `Score must be at most ${criterion.maxValue}.`;
  }
  return null;
}

export function calculateContestantResults(params: {
  criteria: CriterionConfig[];
  scores: SubmittedScore[];
  aggregationRule: AggregationRule;
}) {
  const criteriaById = new Map(params.criteria.map((criterion) => [criterion.id, criterion]));
  const scoresByContestant = groupBy(params.scores, (score) => score.contestantId);

  const unrankedResults = Array.from(scoresByContestant.entries()).map(
    ([contestantId, scores]) => {
      const breakdown = calculateBreakdown(scores, criteriaById, params.aggregationRule);
      const total = roundScore(
        breakdown.reduce((sum, item) => sum + item.weightedTotal, 0),
      );

      return {
        contestantId,
        total,
        rank: 0,
        breakdown,
      };
    },
  );

  return rankResults(unrankedResults);
}

function calculateBreakdown(
  scores: SubmittedScore[],
  criteriaById: Map<string, CriterionConfig>,
  aggregationRule: AggregationRule,
) {
  const scoresByCriterion = groupBy(scores, (score) => score.criterionId);

  return Array.from(scoresByCriterion.entries()).map(([criterionId, criterionScores]) => {
    const criterion = criteriaById.get(criterionId);
    const values = criterionScores.map((score) => score.value);
    const rawTotal = aggregateValues(values, aggregationRule);
    const weightedTotal = roundScore(rawTotal * ((criterion?.weight ?? 100) / 100));

    return {
      criterionId,
      rawTotal,
      weightedTotal,
      count: values.length,
    } satisfies ScoreBreakdownItem;
  });
}

function aggregateValues(values: number[], aggregationRule: AggregationRule) {
  const usableValues = selectUsableValues(values, aggregationRule);
  if (usableValues.length === 0) return 0;

  if (aggregationRule === "sum" || aggregationRule === "weighted_sum") {
    return roundScore(usableValues.reduce((sum, value) => sum + value, 0));
  }

  return roundScore(
    usableValues.reduce((sum, value) => sum + value, 0) / usableValues.length,
  );
}

function selectUsableValues(values: number[], aggregationRule: AggregationRule) {
  const sortedValues = [...values].sort((a, b) => a - b);

  if (aggregationRule === "drop_high" && sortedValues.length > 1) {
    return sortedValues.slice(0, -1);
  }

  if (aggregationRule === "drop_low" && sortedValues.length > 1) {
    return sortedValues.slice(1);
  }

  if (aggregationRule === "drop_high_low" && sortedValues.length > 2) {
    return sortedValues.slice(1, -1);
  }

  return sortedValues;
}

function rankResults(results: Omit<ContestantResult, "rank">[]) {
  const sortedResults = [...results].sort((a, b) => b.total - a.total);
  let previousTotal: number | null = null;
  let previousRank = 0;

  return sortedResults.map((result, index) => {
    const rank = previousTotal === result.total ? previousRank : index + 1;
    previousTotal = result.total;
    previousRank = rank;

    return { ...result, rank };
  });
}

function roundScore(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function groupBy<TItem, TKey>(
  items: TItem[],
  getKey: (item: TItem) => TKey,
) {
  return items.reduce((groups, item) => {
    const key = getKey(item);
    const currentItems = groups.get(key) ?? [];
    currentItems.push(item);
    groups.set(key, currentItems);
    return groups;
  }, new Map<TKey, TItem[]>());
}
