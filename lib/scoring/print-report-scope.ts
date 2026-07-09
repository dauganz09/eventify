import type { ScopeOption } from "@/components/scoring/print-scope-selector";
import type { ResultsReport, RoundReport, SetReport } from "@/lib/scoring/print-report-service";

export type PrintScope =
  | { kind: "all" }
  | { kind: "overall" }
  | { kind: "round"; id: string }
  | { kind: "set"; id: string };

export function parsePrintScope(raw: string | null | undefined): PrintScope {
  if (!raw || raw === "all") return { kind: "all" };
  if (raw === "overall") return { kind: "overall" };
  if (raw.startsWith("round-")) return { kind: "round", id: raw.slice(6) };
  if (raw.startsWith("set-")) return { kind: "set", id: raw.slice(4) };
  return { kind: "all" };
}

export function printScopeToValue(scope: PrintScope): string {
  if (scope.kind === "all") return "all";
  if (scope.kind === "overall") return "overall";
  if (scope.kind === "round") return `round-${scope.id}`;
  return `set-${scope.id}`;
}

export function buildPrintScopeOptions(report: ResultsReport): ScopeOption[] {
  const options: ScopeOption[] = [
    { value: "all", label: "Final Results", group: "general" },
    { value: "overall", label: "Cumulative rankings", group: "general" },
  ];
  for (const round of report.rounds) {
    options.push({
      value: `round-${round.id}`,
      label: round.name,
      group: "rounds",
    });
    for (const set of round.sets) {
      options.push({
        value: `set-${set.id}`,
        label: `${round.name} · ${set.name}`,
        group: "sets",
      });
    }
  }
  for (const set of report.ungroupedSets) {
    options.push({ value: `set-${set.id}`, label: set.name, group: "sets" });
  }
  return options;
}

export interface PrintScopeView {
  scopeTitle: string;
  renderOverall: boolean;
  renderRounds: RoundReport[];
  renderUngrouped: SetReport[];
  renderSingleSet: { round: RoundReport | null; set: SetReport } | null;
}

function findRound(report: ResultsReport, id: string): RoundReport | undefined {
  return report.rounds.find((r) => r.id === id);
}

function findSet(
  report: ResultsReport,
  id: string,
): { round: RoundReport | null; set: SetReport } | undefined {
  for (const round of report.rounds) {
    const set = round.sets.find((s) => s.id === id);
    if (set) return { round, set };
  }
  const ungrouped = report.ungroupedSets.find((s) => s.id === id);
  if (ungrouped) return { round: null, set: ungrouped };
  return undefined;
}

export function resolvePrintScopeView(
  report: ResultsReport,
  scope: PrintScope,
): PrintScopeView {
  let renderOverall = false;
  let renderRounds: RoundReport[] = [];
  const renderUngrouped: SetReport[] = [];
  let renderSingleSet: { round: RoundReport | null; set: SetReport } | null = null;
  let scopeTitle = "Final Results";

  if (scope.kind === "all") {
    const rankOrderRounds = report.rounds.filter(
      (r) => r.isRankOrder && r.rankOrder && r.rankOrder.rows.length > 0,
    );
    if (rankOrderRounds.length > 0) {
      renderRounds = rankOrderRounds;
    } else {
      renderOverall = report.overall.length > 0;
    }
  } else if (scope.kind === "overall") {
    renderOverall = true;
    scopeTitle = "Cumulative Rankings";
  } else if (scope.kind === "round") {
    const round = findRound(report, scope.id);
    if (round) {
      renderRounds = [{ ...round, sets: [] }];
      scopeTitle = `${round.name} — Round Ranking`;
    } else {
      return resolvePrintScopeView(report, { kind: "all" });
    }
  } else if (scope.kind === "set") {
    const found = findSet(report, scope.id);
    if (found) {
      renderSingleSet = found;
      scopeTitle = found.round
        ? `${found.round.name} — ${found.set.name}`
        : found.set.name;
    } else {
      return resolvePrintScopeView(report, { kind: "all" });
    }
  }

  return {
    scopeTitle,
    renderOverall,
    renderRounds,
    renderUngrouped,
    renderSingleSet,
  };
}
