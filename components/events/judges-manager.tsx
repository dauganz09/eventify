"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import {
  deleteJudgeAction,
  saveJudgeAction,
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

export type JudgeRow = {
  id: string;
  displayName: string;
  username: string | null;
  email: string | null;
  isActive: boolean;
};

export type AssignmentRow = {
  judgeId: string;
  /** The assigned round group (null = event-wide or a legacy set assignment). */
  roundGroupId: string | null;
  /** Human-readable scope, resolved server-side. */
  label: string;
};

/** A round group option for the "Assign to round" select. */
export type RoundOption = {
  id: string;
  name: string;
};

export function JudgesManager({
  eventId,
  judges,
  assignments,
  rounds,
}: {
  eventId: string;
  judges: JudgeRow[];
  assignments: AssignmentRow[];
  rounds: RoundOption[];
}) {
  const assignmentsByJudge = new Map<string, AssignmentRow[]>();
  for (const a of assignments) {
    const bucket = assignmentsByJudge.get(a.judgeId) ?? [];
    bucket.push(a);
    assignmentsByJudge.set(a.judgeId, bucket);
  }

  // Enrich judge rows with assignment label for filtering/display
  type EnrichedJudge = JudgeRow & { assignmentLabel: string };
  const enriched: EnrichedJudge[] = judges.map((j) => {
    const judgeAssignments = assignmentsByJudge.get(j.id) ?? [];
    return {
      ...j,
      assignmentLabel:
        judgeAssignments.length === 0
          ? "None"
          : judgeAssignments.map((a) => a.label).join(", "),
    };
  });

  const columns: ColumnDef<EnrichedJudge, unknown>[] = [
    {
      accessorKey: "displayName",
      header: "Name",
      cell: ({ row }) => <span className="font-medium">{row.original.displayName}</span>,
    },
    {
      accessorKey: "username",
      header: "Username",
      cell: ({ row }) => row.original.username ?? "—",
    },
    {
      accessorKey: "isActive",
      header: "Active",
      cell: ({ row }) => (row.original.isActive ? "Yes" : "No"),
      filterFn: (row, _id, filterValue) =>
        String(row.original.isActive) === filterValue,
    },
    {
      accessorKey: "assignmentLabel",
      header: "Assignments",
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const judgeAssignments = assignmentsByJudge.get(row.original.id) ?? [];
        return (
          <div className="flex justify-end gap-1">
            <JudgeFormDialog
              eventId={eventId}
              rounds={rounds}
              judge={row.original}
              defaultRoundGroupIds={judgeAssignments
                .map((a) => a.roundGroupId)
                .filter((id): id is string => id !== null)}
              trigger={<Button size="sm" variant="ghost">Edit</Button>}
            />
            <DeleteJudgeButton
              eventId={eventId}
              judgeId={row.original.id}
              judgeName={row.original.displayName}
            />
          </div>
        );
      },
    },
  ];

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Judges</h2>
          <p className="text-sm text-muted-foreground">
            Add judges and assign them to rounds.
          </p>
        </div>
        <JudgeFormDialog
          eventId={eventId}
          rounds={rounds}
          trigger={
            <Button>
              <PlusIcon className="size-4" />
              Add judge
            </Button>
          }
        />
      </div>

      <DataTable
        columns={columns}
        data={enriched}
        searchColumn="displayName"
        searchPlaceholder="Search by name…"
        filters={[
          {
            columnId: "isActive",
            label: "All statuses",
            options: [
              { label: "Active", value: "true" },
              { label: "Inactive", value: "false" },
            ],
          },
          ...(rounds.length > 0
            ? [
                {
                  columnId: "assignmentLabel",
                  label: "All rounds",
                  options: [
                    { label: "None", value: "None" },
                    ...rounds.map((r) => ({ label: r.name, value: r.name })),
                  ],
                },
              ]
            : []),
        ]}
        emptyMessage="No judges found."
      />
    </div>
  );
}

// ── Form dialog ───────────────────────────────────────────────────────────────

function JudgeFormDialog({
  eventId,
  rounds,
  judge,
  defaultRoundGroupIds = [],
  trigger,
}: {
  eventId: string;
  rounds: RoundOption[];
  judge?: JudgeRow;
  defaultRoundGroupIds?: string[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isEdit = !!judge;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await saveJudgeAction(eventId, formData);
        toast.success(isEdit ? "Judge updated." : "Judge added.");
        setOpen(false);
      } catch {
        toast.error(isEdit ? "Failed to update judge." : "Failed to add judge.");
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
            <DialogTitle>{isEdit ? "Edit judge" : "Add judge"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" key={judge?.id ?? "new"}>
            {isEdit && <input type="hidden" name="judgeId" value={judge.id} />}
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="jd-displayName">Display name</Label>
              <Input id="jd-displayName" name="displayName" required defaultValue={judge?.displayName ?? ""} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="jd-username">Username</Label>
              <Input id="jd-username" name="username" autoCapitalize="none" autoComplete="off" required defaultValue={judge?.username ?? ""} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="jd-password">
                {isEdit ? "New password" : "Password"}
                {isEdit && <span className="ml-1 text-xs font-normal text-muted-foreground">(leave blank to keep)</span>}
              </Label>
              <Input id="jd-password" name="password" type="password" autoComplete="new-password" required={!isEdit} defaultValue="" />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label>Assign to rounds</Label>
              {rounds.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No rounds yet — this judge scores event-wide.
                </p>
              ) : (
                <div className="grid gap-2 rounded-md border border-input p-3">
                  {rounds.map((round) => (
                    <label
                      key={round.id}
                      htmlFor={`jd-round-${round.id}`}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        className="size-4 rounded border border-input"
                        id={`jd-round-${round.id}`}
                        name="roundGroupId"
                        type="checkbox"
                        value={round.id}
                        defaultChecked={defaultRoundGroupIds.includes(round.id)}
                      />
                      {round.name}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Select one or more rounds, each covering every set inside it.
                Leave all unchecked for event-wide (all rounds).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input className="size-4 rounded border border-input" id="jd-isActive" name="isActive" type="checkbox" defaultChecked={judge?.isActive ?? true} />
              <Label htmlFor="jd-isActive">Active</Label>
            </div>
            <DialogFooter className="sm:col-span-2" showCloseButton>
              <Button type="submit" disabled={isPending}>
                {isPending ? (isEdit ? "Saving…" : "Adding…") : (isEdit ? "Save changes" : "Add judge")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Action buttons ────────────────────────────────────────────────────────────


function DeleteJudgeButton({ eventId, judgeId, judgeName }: { eventId: string; judgeId: string; judgeName: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={isPending}
      onClick={() => startTransition(async () => {
        try {
          await deleteJudgeAction(eventId, judgeId);
          toast.success(`"${judgeName}" deleted.`);
        } catch {
          toast.error("Failed to delete judge.");
        }
      })}>
      {isPending ? "Deleting…" : "Delete"}
    </Button>
  );
}
