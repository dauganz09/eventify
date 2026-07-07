"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TriangleAlert } from "lucide-react";
import type { ConflictFlag, JudgeAnalytics, CriterionAnalytics } from "@/lib/scoring/insights-service";

// ── Conflicts table ───────────────────────────────────────────────────────────

const conflictColumns: ColumnDef<ConflictFlag, unknown>[] = [
  {
    accessorKey: "setName",
    header: "Set",
    size: 130,
    filterFn: "equals",
    cell: ({ row }) => <span className="text-sm">{row.original.setName}</span>,
  },
  {
    id: "contestant",
    accessorFn: (r) => `${r.contestantNumber ? `#${r.contestantNumber} ` : ""}${r.contestantName}`,
    header: "Contestant",
    cell: ({ row }) => (
      <span className="text-sm">
        {row.original.contestantNumber && (
          <span className="mr-1 font-mono text-xs text-muted-foreground">
            #{row.original.contestantNumber}
          </span>
        )}
        {row.original.contestantName}
      </span>
    ),
  },
  {
    accessorKey: "criterionName",
    header: "Criterion",
    filterFn: "equals",
    cell: ({ row }) => <span className="text-sm">{row.original.criterionName}</span>,
  },
  {
    accessorKey: "judgeName",
    header: "Judge",
    cell: ({ row }) => <span className="text-sm">{row.original.judgeName}</span>,
  },
  {
    accessorKey: "value",
    header: () => <span className="block text-right">Score</span>,
    size: 80,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">{row.original.value}</span>
    ),
  },
  {
    accessorKey: "panelMean",
    header: () => <span className="block text-right">Panel avg</span>,
    size: 90,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums text-muted-foreground">
        {row.original.panelMean}
      </span>
    ),
  },
  {
    accessorKey: "deviation",
    header: () => <span className="block text-right">Deviation</span>,
    size: 90,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <Badge variant={row.original.deviation > 0 ? "default" : "destructive"}>
          {row.original.deviation > 0 ? "+" : ""}
          {row.original.deviation}
        </Badge>
      </div>
    ),
  },
];

// ── Judge calibration table ───────────────────────────────────────────────────

const judgeColumns: ColumnDef<JudgeAnalytics, unknown>[] = [
  {
    accessorKey: "judgeName",
    header: "Judge",
    cell: ({ row }) => <span className="font-medium">{row.original.judgeName}</span>,
  },
  {
    accessorKey: "scored",
    header: () => <span className="block text-right">Scores</span>,
    size: 80,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">{row.original.scored}</span>
    ),
  },
  {
    accessorKey: "leniency",
    header: () => <span className="block text-right">Leniency</span>,
    size: 90,
    cell: ({ row }) => {
      const v = row.original.leniency;
      return (
        <span
          className={`block text-right tabular-nums ${
            v > 0 ? "text-emerald-600" : v < 0 ? "text-rose-600" : ""
          }`}
        >
          {v > 0 ? "+" : ""}
          {v}
        </span>
      );
    },
  },
  {
    accessorKey: "agreement",
    header: () => <span className="block text-right">Agreement</span>,
    size: 100,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">{row.original.agreement}</span>
    ),
  },
  {
    accessorKey: "outliers",
    header: () => <span className="block text-right">Outliers</span>,
    size: 80,
    cell: ({ row }) => (
      <div className="flex justify-end">
        {row.original.outliers > 0 ? (
          <Badge variant="secondary">{row.original.outliers}</Badge>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </div>
    ),
  },
];

// ── Criterion consensus table ─────────────────────────────────────────────────

const criterionColumns: ColumnDef<CriterionAnalytics, unknown>[] = [
  {
    accessorKey: "criterionName",
    header: "Criterion",
    cell: ({ row }) => <span className="font-medium">{row.original.criterionName}</span>,
  },
  {
    accessorKey: "setName",
    header: "Set",
    filterFn: "equals",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">{row.original.setName}</span>
    ),
  },
  {
    accessorKey: "mean",
    header: () => <span className="block text-right">Mean</span>,
    size: 80,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">{row.original.mean}</span>
    ),
  },
  {
    accessorKey: "spread",
    header: () => <span className="block text-right">Avg spread</span>,
    size: 100,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">{row.original.spread}</span>
    ),
  },
  {
    accessorKey: "samples",
    header: () => <span className="block text-right">Samples</span>,
    size: 80,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums text-muted-foreground">
        {row.original.samples}
      </span>
    ),
  },
];

// ── Composed page component ───────────────────────────────────────────────────

interface InsightsTablesProps {
  conflicts: ConflictFlag[];
  judges: JudgeAnalytics[];
  criteria: CriterionAnalytics[];
}

export function InsightsTables({ conflicts, judges, criteria }: InsightsTablesProps) {
  const conflictSetOptions = useMemo(
    () =>
      Array.from(new Set(conflicts.map((c) => c.setName)))
        .sort()
        .map((s) => ({ label: s, value: s })),
    [conflicts],
  );

  const conflictCriterionOptions = useMemo(
    () =>
      Array.from(new Set(conflicts.map((c) => c.criterionName)))
        .sort()
        .map((s) => ({ label: s, value: s })),
    [conflicts],
  );

  const criterionSetOptions = useMemo(
    () =>
      Array.from(new Set(criteria.map((c) => c.setName)))
        .sort()
        .map((s) => ({ label: s, value: s })),
    [criteria],
  );

  return (
    <>
      {/* Conflicts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TriangleAlert className="size-5 text-amber-500" />
            Score conflicts &amp; outliers
            {conflicts.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {conflicts.length}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Judge scores that deviate sharply from the panel average for the same
            contestant &amp; criterion (panels of 3+ judges). Worth a second look.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {conflicts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No outliers detected — the panel is in good agreement.
            </p>
          ) : (
            <DataTable
              columns={conflictColumns}
              data={conflicts}
              searchColumn="contestant"
              searchPlaceholder="Search contestant…"
              filters={[
                { columnId: "setName", label: "All sets", options: conflictSetOptions },
                { columnId: "criterionName", label: "All criteria", options: conflictCriterionOptions },
              ]}
              pageSize={10}
              emptyMessage="No conflicts match your filters."
            />
          )}
        </CardContent>
      </Card>

      {/* Judge calibration */}
      <Card>
        <CardHeader>
          <CardTitle>Judge calibration</CardTitle>
          <CardDescription>
            Leniency = average gap from the panel mean (+ generous / − strict).
            Agreement = average distance from the panel (lower is more aligned).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {judges.length === 0 ? (
            <p className="text-sm text-muted-foreground">No submitted scores yet.</p>
          ) : (
            <DataTable
              columns={judgeColumns}
              data={judges}
              searchColumn="judgeName"
              searchPlaceholder="Search judge…"
              pageSize={15}
              emptyMessage="No judges match your search."
            />
          )}
        </CardContent>
      </Card>

      {/* Criterion consensus */}
      <Card>
        <CardHeader>
          <CardTitle>Criterion consensus</CardTitle>
          <CardDescription>
            Average per-contestant spread (max − min across judges). Higher spread
            means judges disagree more on that criterion.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {criteria.length === 0 ? (
            <p className="text-sm text-muted-foreground">No submitted scores yet.</p>
          ) : (
            <DataTable
              columns={criterionColumns}
              data={criteria}
              searchColumn="criterionName"
              searchPlaceholder="Search criterion…"
              filters={
                criterionSetOptions.length > 1
                  ? [{ columnId: "setName", label: "All sets", options: criterionSetOptions }]
                  : []
              }
              pageSize={15}
              emptyMessage="No criteria match your filters."
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
