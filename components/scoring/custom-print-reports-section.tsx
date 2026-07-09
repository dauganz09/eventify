"use client";

import { useState, useTransition } from "react";
import { FileStack, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { deleteCustomPrintReportAction } from "@/app/(dashboard)/tabulator/custom-report-actions";
import { NewTabLink } from "@/components/scoring/new-tab-link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CustomPrintReport } from "@/lib/scoring/custom-print-report-service";
import { CustomPrintReportDialog } from "@/components/scoring/custom-print-report-dialog";

export interface CustomReportSetOption {
  id: string;
  label: string;
  group: string;
}

export function CustomPrintReportsSection({
  eventId,
  reports,
  setOptions,
  canManage,
}: {
  eventId: string;
  reports: CustomPrintReport[];
  setOptions: CustomReportSetOption[];
  canManage: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomPrintReport | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(report: CustomPrintReport) {
    setEditing(report);
    setDialogOpen(true);
  }

  return (
    <Card id="custom-reports" className="scroll-mt-32">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="grid gap-1.5">
          <CardTitle className="flex items-center gap-2">
            <FileStack className="size-5" />
            Custom print reports
          </CardTitle>
          <CardDescription>
            Combine scores from different sets or rounds into a single ranked
            report — for example, a &ldquo;Miss Eloquence&rdquo; award from two
            separate sets.
          </CardDescription>
        </div>
        {canManage && (
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            New report
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No custom reports yet.
            {canManage
              ? " Create one to rank contestants across selected sets."
              : null}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {reports.map((report) => (
              <CustomReportRow
                key={report.id}
                eventId={eventId}
                report={report}
                setOptions={setOptions}
                canManage={canManage}
                onEdit={() => openEdit(report)}
              />
            ))}
          </ul>
        )}

        {canManage && (
          <CustomPrintReportDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            eventId={eventId}
            report={editing}
            setOptions={setOptions}
          />
        )}
      </CardContent>
    </Card>
  );
}

function CustomReportRow({
  eventId,
  report,
  setOptions,
  canManage,
  onEdit,
}: {
  eventId: string;
  report: CustomPrintReport;
  setOptions: CustomReportSetOption[];
  canManage: boolean;
  onEdit: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const setLabels = report.setIds.map(
    (id) => setOptions.find((o) => o.id === id)?.label ?? id,
  );

  function onDelete() {
    if (!confirm(`Delete "${report.name}"? This cannot be undone.`)) return;
    const formData = new FormData();
    formData.set("eventId", eventId);
    formData.set("reportId", report.id);
    startTransition(async () => {
      await deleteCustomPrintReportAction(formData);
    });
  }

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 grid gap-1">
        <p className="font-medium">{report.name}</p>
        {report.description ? (
          <p className="text-sm text-muted-foreground">{report.description}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Combines: {setLabels.join(" + ")}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <NewTabLink
          href={`/tabulator/${eventId}/print/custom/${report.id}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Printer className="size-3.5" />
          Print
        </NewTabLink>
        {canManage && (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="size-3.5" />
              Edit
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
