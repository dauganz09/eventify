export interface CriterionConfig {
  id: string;
  name: string;
  weight: number;
  minValue?: number;
  maxValue?: number;
  isRequired: boolean;
}

export interface SubmittedScore {
  contestantId: string;
  judgeId: string;
  criterionId: string;
  value: number;
}

export interface ScoreBreakdownItem {
  criterionId: string;
  rawTotal: number;
  weightedTotal: number;
  count: number;
}

export interface ContestantResult {
  contestantId: string;
  total: number;
  rank: number;
  breakdown: ScoreBreakdownItem[];
}

export type AggregationRule =
  | "sum"
  | "average"
  | "weighted_sum"
  | "drop_high"
  | "drop_low"
  | "drop_high_low";
