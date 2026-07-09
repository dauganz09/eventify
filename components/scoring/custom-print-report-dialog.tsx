"use client";

import { useEffect, useState, useTransition } from "react";
import { saveCustomPrintReportAction } from "@/app/(dashboard)/tabulator/custom-report-actions";
import type { CustomReportSetOption } from "@/components/scoring/custom-print-reports-section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CustomPrintReport } from "@/lib/scoring/custom-print-report-service";

export function CustomPrintReportDialog({
  open,
  onOpenChange,
  eventId,
  report,
  setOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  report: CustomPrintReport | null;
  setOptions: CustomReportSetOption[];
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedSetIds, setSelectedSetIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setName(report?.name ?? "");
    setDescription(report?.description ?? "");
    setSelectedSetIds(report?.setIds ?? []);
    setError(null);
  }, [open, report]);

  const grouped = groupSetOptions(setOptions);

  function toggleSet(setId: string, checked: boolean) {
    setSelectedSetIds((prev) => {
      if (checked) return [...prev, setId];
      return prev.filter((id) => id !== setId);
    });
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("eventId", eventId);
    if (report) formData.set("reportId", report.id);
    formData.set("name", name.trim());
    formData.set("description", description.trim());
    for (const setId of selectedSetIds) {
      formData.append("setIds", setId);
    }

    startTransition(async () => {
      try {
        await saveCustomPrintReportAction(formData);
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save report.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {report ? "Edit custom report" : "New custom report"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="custom-report-name">Report name</Label>
            <Input
              id="custom-report-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Miss Eloquence"
              required
              maxLength={160}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="custom-report-description">Description (optional)</Label>
            <Textarea
              id="custom-report-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Combined ranking from Evening Gown and Q&A"
              rows={2}
              maxLength={2000}
            />
          </div>
          <div className="grid gap-2">
            <Label>Sets to combine</Label>
            <p className="text-xs text-muted-foreground">
              Select two or more sets. Rankings use the event&apos;s score mode
              (average or sum) and tie-break rules.
            </p>
            <div className="max-h-56 overflow-y-auto rounded-md border border-border p-3">
              {grouped.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sets in this event.</p>
              ) : (
                grouped.map((group) => (
                  <div key={group.name} className="mb-3 last:mb-0">
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {group.name}
                    </p>
                    <ul className="grid gap-2">
                      {group.options.map((option) => (
                        <li key={option.id} className="flex items-center gap-2">
                          <input
                            id={`set-${option.id}`}
                            type="checkbox"
                            className="size-4 rounded border border-input"
                            checked={selectedSetIds.includes(option.id)}
                            onChange={(e) => toggleSet(option.id, e.target.checked)}
                          />
                          <Label
                            htmlFor={`set-${option.id}`}
                            className="cursor-pointer font-normal"
                          >
                            {option.label}
                          </Label>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isPending || selectedSetIds.length === 0}>
              {isPending ? "Saving…" : report ? "Save changes" : "Create report"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function groupSetOptions(options: CustomReportSetOption[]) {
  const groups = new Map<string, CustomReportSetOption[]>();
  for (const option of options) {
    const bucket = groups.get(option.group) ?? [];
    bucket.push(option);
    groups.set(option.group, bucket);
  }
  return Array.from(groups.entries()).map(([name, groupOptions]) => ({
    name,
    options: groupOptions,
  }));
}
