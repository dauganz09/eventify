"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import {
  deleteScoringRuleAction,
  saveScoringRuleAction,
} from "@/app/(dashboard)/events/[eventId]/builder/actions";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { nativeSelectClassName } from "@/lib/events/format";

const AGGREGATION_OPTIONS = [
  { value: "sum", label: "Sum" },
  { value: "average", label: "Average" },
  { value: "weighted_sum", label: "Weighted sum" },
  { value: "drop_high", label: "Drop high" },
  { value: "drop_low", label: "Drop low" },
  { value: "drop_high_low", label: "Drop high and low" },
] as const;

function aggregationLabel(value: string) {
  return AGGREGATION_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export type ScoringRuleRow = {
  id: string;
  name: string;
  roundId: string | null;
  aggregation: string;
};

export type RoundOption = {
  id: string;
  name: string;
};

export function ScoringRulesManager({
  eventId,
  rules,
  rounds,
}: {
  eventId: string;
  rules: ScoringRuleRow[];
  rounds: RoundOption[];
}) {
  const roundNameById = new Map(rounds.map((r) => [r.id, r.name]));

  type EnrichedRule = ScoringRuleRow & { roundLabel: string; aggregationLabel: string };
  const enriched: EnrichedRule[] = rules.map((r) => ({
    ...r,
    roundLabel: r.roundId ? (roundNameById.get(r.roundId) ?? "Unknown") : "Event-wide",
    aggregationLabel: aggregationLabel(r.aggregation),
  }));

  const columns: ColumnDef<EnrichedRule, unknown>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: "roundLabel",
      header: "Round",
      filterFn: "equals",
    },
    {
      accessorKey: "aggregationLabel",
      header: "Aggregation",
      filterFn: "equals",
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <ScoringRuleFormDialog
            eventId={eventId}
            rounds={rounds}
            rule={row.original}
            trigger={<Button size="sm" variant="ghost">Edit</Button>}
          />
          <DeleteRuleButton
            eventId={eventId}
            ruleId={row.original.id}
            ruleName={row.original.name}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Scoring rules</h2>
          <p className="text-sm text-muted-foreground">
            Configure how judge scores are aggregated.
          </p>
        </div>
        <ScoringRuleFormDialog
          eventId={eventId}
          rounds={rounds}
          trigger={
            <Button>
              <PlusIcon className="size-4" />
              Add rule
            </Button>
          }
        />
      </div>

      <DataTable
        columns={columns}
        data={enriched}
        searchColumn="name"
        searchPlaceholder="Search by rule name…"
        filters={[
          {
            columnId: "aggregationLabel",
            label: "All aggregations",
            options: AGGREGATION_OPTIONS.map((o) => ({ label: o.label, value: o.label })),
          },
          ...(rounds.length > 0
            ? [
                {
                  columnId: "roundLabel",
                  label: "All rounds",
                  options: [
                    { label: "Event-wide", value: "Event-wide" },
                    ...rounds.map((r) => ({ label: r.name, value: r.name })),
                  ],
                },
              ]
            : []),
        ]}
        emptyMessage="No scoring rules found."
      />
    </div>
  );
}

// ── Form dialog ───────────────────────────────────────────────────────────────

function ScoringRuleFormDialog({
  eventId,
  rounds,
  rule,
  trigger,
}: {
  eventId: string;
  rounds: RoundOption[];
  rule?: ScoringRuleRow;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isEdit = !!rule;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await saveScoringRuleAction(eventId, formData);
        toast.success(isEdit ? "Rule updated." : "Rule added.");
        setOpen(false);
      } catch {
        toast.error(isEdit ? "Failed to update rule." : "Failed to add rule.");
      }
    });
  }

  return (
    <>
      <span onClick={() => setOpen(true)} style={{ display: "contents" }}>
        {trigger}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit scoring rule" : "Add scoring rule"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" key={rule?.id ?? "new"}>
            {isEdit && <input type="hidden" name="ruleId" value={rule.id} />}
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="rd-name">Rule name</Label>
              <Input id="rd-name" name="name" required defaultValue={rule?.name ?? ""} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rd-roundId">Round</Label>
              <select className={nativeSelectClassName} id="rd-roundId" name="roundId" defaultValue={rule?.roundId ?? ""}>
                <option value="">Event-wide</option>
                {rounds.map((round) => (
                  <option key={round.id} value={round.id}>{round.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rd-aggregation">Aggregation</Label>
              <select className={nativeSelectClassName} id="rd-aggregation" name="aggregation" defaultValue={rule?.aggregation ?? "weighted_sum"}>
                {AGGREGATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <DialogFooter className="sm:col-span-2" showCloseButton>
              <Button type="submit" disabled={isPending}>
                {isPending ? (isEdit ? "Saving…" : "Adding…") : (isEdit ? "Save changes" : "Add rule")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Action buttons ────────────────────────────────────────────────────────────

function DeleteRuleButton({ eventId, ruleId, ruleName }: { eventId: string; ruleId: string; ruleName: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={isPending}
      onClick={() => startTransition(async () => {
        try {
          await deleteScoringRuleAction(eventId, ruleId);
          toast.success(`"${ruleName}" deleted.`);
        } catch {
          toast.error("Failed to delete scoring rule.");
        }
      })}>
      {isPending ? "Deleting…" : "Delete"}
    </Button>
  );
}
