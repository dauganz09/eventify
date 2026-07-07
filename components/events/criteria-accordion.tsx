"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { deleteCriterionAction } from "@/app/(dashboard)/events/[eventId]/builder/actions";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { CriterionFormDialog } from "./criterion-form-dialog";

export type CriterionRow = {
  id: string;
  name: string;
  description?: string | null;
  inputType: string;
  minValue: string | null;
  maxValue: string | null;
  stepValue?: string | null;
  weight: string;
  position: number;
  isRequired: boolean;
  /** actual DB roundId — null for event-wide */
  roundId: string | null;
};

export type CriteriaSection = {
  /** Accordion key — actual round id, or "__event_wide__" */
  roundId: string;
  /** null when section is event-wide */
  dbRoundId: string | null;
  roundName: string;
  /** undefined when round has no group */
  groupName?: string;
  criteria: CriterionRow[];
};

type RoundGroup = { id: string; name: string };
type Round = { id: string; name: string; roundGroupId: string | null };

export function CriteriaAccordion({
  eventId,
  sections,
  roundGroups,
  rounds,
  totalCriteria,
}: {
  eventId: string;
  sections: CriteriaSection[];
  roundGroups: RoundGroup[];
  rounds: Round[];
  totalCriteria: number;
}) {
  // Group sections by groupName for rendering group headers
  type GroupedSection = {
    groupName: string | undefined;
    items: CriteriaSection[];
  };

  const groups: GroupedSection[] = [];
  for (const section of sections) {
    const last = groups[groups.length - 1];
    if (last && last.groupName === section.groupName) {
      last.items.push(section);
    } else {
      groups.push({ groupName: section.groupName, items: [section] });
    }
  }

  return (
    <div className="grid gap-6">
      {/* Global "Add criterion" button when no sections exist */}
      {sections.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No criteria yet. Add your first criterion below.
          </p>
          <CriterionFormDialog
            eventId={eventId}
            roundGroups={roundGroups}
            rounds={rounds}
            totalCriteria={totalCriteria}
            trigger={
              <Button variant="secondary" size="sm">
                <PlusIcon className="size-4" />
                Add criterion
              </Button>
            }
          />
        </div>
      ) : (
        groups.map((group, gi) => (
          <div key={gi} className="grid gap-2">
            {group.groupName && (
              <h3 className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {group.groupName}
              </h3>
            )}
            <div className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border">
              <Accordion defaultValue={[]} multiple>
                {group.items.map((section) => {
                  const totalWeight = section.criteria.reduce(
                    (sum, c) => sum + Number(c.weight),
                    0,
                  );
                  return (
                    <AccordionItem
                      key={section.roundId}
                      value={section.roundId}
                      className="px-4"
                    >
                      <AccordionTrigger className="py-3">
                        <span className="flex items-center gap-3">
                          <span className="font-medium text-foreground">
                            {section.roundName}
                          </span>
                          {section.criteria.length > 0 ? (
                            <span className="text-xs font-normal text-muted-foreground">
                              {section.criteria.length}{" "}
                              {section.criteria.length === 1 ? "criterion" : "criteria"}{" "}
                              · {totalWeight}% weight
                            </span>
                          ) : (
                            <span className="text-xs font-normal text-muted-foreground">
                              No criteria yet
                            </span>
                          )}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="grid gap-3 pb-2">
                          <CriteriaSectionTable
                            criteria={section.criteria}
                            eventId={eventId}
                            roundGroups={roundGroups}
                            rounds={rounds}
                            totalCriteria={totalCriteria}
                          />

                          {/* Per-section "Add criterion" button */}
                          <div>
                            <CriterionFormDialog
                              eventId={eventId}
                              roundGroups={roundGroups}
                              rounds={rounds}
                              totalCriteria={totalCriteria}
                              defaultRoundId={section.dbRoundId ?? undefined}
                              trigger={
                                <Button size="sm" variant="outline">
                                  <PlusIcon className="size-3.5" />
                                  Add criterion to {section.roundName}
                                </Button>
                              }
                            />
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function CriteriaSectionTable({
  criteria,
  eventId,
  roundGroups,
  rounds,
  totalCriteria,
}: {
  criteria: CriterionRow[];
  eventId: string;
  roundGroups: { id: string; name: string }[];
  rounds: { id: string; name: string; roundGroupId: string | null }[];
  totalCriteria: number;
}) {
  const columns: ColumnDef<CriterionRow, unknown>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: "inputType",
      header: "Type",
      filterFn: "equals",
    },
    {
      id: "range",
      header: "Range",
      cell: ({ row }) =>
        `${row.original.minValue ?? "—"} – ${row.original.maxValue ?? "—"}`,
    },
    {
      accessorKey: "weight",
      header: "Weight",
      cell: ({ row }) => `${row.original.weight}%`,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <CriterionFormDialog
            eventId={eventId}
            roundGroups={roundGroups}
            rounds={rounds}
            totalCriteria={totalCriteria}
            criterion={row.original}
            trigger={<Button size="sm" variant="ghost">Edit</Button>}
          />
          <DeleteCriterionButton
            eventId={eventId}
            criterionId={row.original.id}
            criterionName={row.original.name}
          />
        </div>
      ),
    },
  ];

  // Unique input types for filter
  const inputTypes = [...new Set(criteria.map((c) => c.inputType))];

  return (
    <DataTable
      columns={columns}
      data={criteria}
      searchColumn="name"
      searchPlaceholder="Search criteria…"
      filters={
        inputTypes.length > 1
          ? [{ columnId: "inputType", label: "All types", options: inputTypes.map((t) => ({ label: t, value: t })) }]
          : []
      }
      pageSize={5}
      emptyMessage="No criteria match your search."
    />
  );
}

function DeleteCriterionButton({
  eventId,
  criterionId,
  criterionName,
}: {
  eventId: string;
  criterionId: string;
  criterionName: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-destructive hover:text-destructive"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          try {
            await deleteCriterionAction(eventId, criterionId);
            toast.success(`"${criterionName}" deleted.`);
          } catch {
            toast.error("Failed to delete criterion.");
          }
        });
      }}
    >
      {isPending ? "Deleting…" : "Delete"}
    </Button>
  );
}
