"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Layers, Save } from "lucide-react";
import { saveManualScoresAction } from "@/app/(dashboard)/tabulator/actions";
import type { ManualSet } from "@/lib/scoring/tabulator-service";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

function cellKey(contestantId: string, criterionId: string) {
  return `${contestantId}:${criterionId}`;
}

function initialValues(set: ManualSet): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of set.rows) {
    for (const criterion of set.criteria) {
      const value = row.values[criterion.id];
      map[cellKey(row.contestantId, criterion.id)] =
        value === null || value === undefined ? "" : String(value);
    }
  }
  return map;
}

export function ManualScorePanel({
  eventId,
  set,
  canAdjust,
  noCard = false,
}: {
  eventId: string;
  set: ManualSet;
  canAdjust: boolean;
  /** Render without the Card shell — used when the panel is a tab inside a
   *  parent Card. The save button and progress bar are still shown inline. */
  noCard?: boolean;
}) {
  // Baseline reflects what's saved on the server; `values` is the working copy.
  const [baseline, setBaseline] = useState(() => initialValues(set));
  const [values, setValues] = useState(() => initialValues(set));
  const [isPending, startTransition] = useTransition();

  const dirtyCount = useMemo(
    () => Object.keys(values).filter((k) => values[k] !== baseline[k]).length,
    [values, baseline],
  );

  function setCell(contestantId: string, criterionId: string, next: string) {
    setValues((prev) => ({ ...prev, [cellKey(contestantId, criterionId)]: next }));
  }

  function handleSave() {
    const scores: { contestantId: string; criterionId: string; value: number }[] = [];
    for (const row of set.rows) {
      for (const criterion of set.criteria) {
        const key = cellKey(row.contestantId, criterion.id);
        const raw = values[key];
        if (raw === baseline[key]) continue; // unchanged
        if (raw.trim() === "") continue; // blank = leave as-is (no delete)
        const value = Number(raw);
        if (!Number.isFinite(value)) continue;
        scores.push({ contestantId: row.contestantId, criterionId: criterion.id, value });
      }
    }

    if (scores.length === 0) {
      toast.info("No changes to save.");
      return;
    }

    startTransition(async () => {
      try {
        const { saved } = await saveManualScoresAction({ eventId, setId: set.id, scores });
        // Commit the working copy to the baseline so the dirty count resets.
        setBaseline({ ...values });
        toast.success(`Saved ${saved} score${saved === 1 ? "" : "s"}.`);
      } catch {
        toast.error("Failed to save scores.");
      }
    });
  }

  const toolbar = (
    <div className="flex items-center gap-3">
      <div className="hidden w-40 items-center gap-2 sm:flex">
        <Progress value={set.completionPct} className="h-1.5" />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {set.submitted}/{set.expected}
        </span>
      </div>
      {canAdjust && (
        <Button size="sm" onClick={handleSave} disabled={isPending || dirtyCount === 0}>
          <Save className="size-4" />
          {isPending
            ? "Saving…"
            : dirtyCount > 0
              ? `Save ${dirtyCount}`
              : "Save"}
        </Button>
      )}
    </div>
  );

  const table = (
    <>
      {set.criteria.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No criteria configured for this category yet. Add at least one
          criterion in the event builder&rsquo;s Criteria step.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full caption-bottom text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-3 font-medium">Candidate</th>
                {set.criteria.map((criterion) => (
                  <th
                    key={criterion.id}
                    className="px-3 py-2 text-right font-medium"
                  >
                    {criterion.name}
                    {criterion.maxValue !== null && (
                      <span className="ml-1 font-normal text-muted-foreground">
                        /{criterion.maxValue}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {set.rows.map((row) => (
                <tr key={row.contestantId} className="border-b border-border/60">
                  <td className="py-2 pr-3">
                    <span className="font-medium">
                      {row.displayNumber ? `${row.displayNumber}. ` : ""}
                      {row.displayName}
                    </span>
                  </td>
                  {set.criteria.map((criterion) => {
                    const key = cellKey(row.contestantId, criterion.id);
                    return (
                      <td key={criterion.id} className="px-3 py-1.5 text-right">
                        {canAdjust ? (
                          <input
                            type="number"
                            inputMode="decimal"
                            min={criterion.minValue ?? undefined}
                            max={criterion.maxValue ?? undefined}
                            step="any"
                            value={values[key] ?? ""}
                            onChange={(e) =>
                              setCell(row.contestantId, criterion.id, e.target.value)
                            }
                            className={`h-9 w-24 rounded-md border bg-background px-2 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring ${
                              values[key] !== baseline[key]
                                ? "border-primary"
                                : "border-input"
                            }`}
                          />
                        ) : (
                          <span className="tabular-nums">
                            {values[key] === "" ? "—" : values[key]}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  if (noCard) {
    return (
      <div>
        <div className="mb-4 flex items-center justify-end">{toolbar}</div>
        {table}
      </div>
    );
  }

  return (
    <Card id={`manual-${set.id}`} className="scroll-mt-32">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-4 text-muted-foreground" />
              {set.name}
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                Manual entry
              </span>
            </CardTitle>
            <CardDescription>
              {set.groupName ? `${set.groupName} · ` : ""}
              Enter each candidate&rsquo;s final score for this pre-event
              category.
            </CardDescription>
          </div>
          {toolbar}
        </div>
      </CardHeader>
      <CardContent>{table}</CardContent>
    </Card>
  );
}
