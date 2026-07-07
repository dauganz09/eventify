"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { finishRoundWithCarryOverAction } from "@/app/(dashboard)/tabulator/actions";

interface SetOption {
  id: string;
  name: string;
}

/**
 * "Finish round" dialog — simplified since carry-over intent is already
 * configured in the round builder.
 *
 * • carryOverScores = false → single confirmation, no carry-over.
 * • carryOverScores = true  → set-picker (all pre-checked) so the tabulator
 *   can still choose exactly which sets contribute to the carry-over.
 */
export function FinishRoundDialog({
  groupId,
  groupName,
  sets,
  carryOverScores,
  trigger,
}: {
  groupId: string;
  groupName: string;
  sets: SetOption[];
  carryOverScores: boolean;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  // Start with all sets checked when carry-over is on.
  const [picked, setPicked] = useState<Set<string>>(new Set(sets.map((s) => s.id)));
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) setPicked(new Set(sets.map((s) => s.id)));
  }

  function togglePicked(id: string, checked: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function submit() {
    const carryOverSetIds = carryOverScores ? Array.from(picked) : [];
    startTransition(async () => {
      try {
        await finishRoundWithCarryOverAction({ groupId, carryOverSetIds });
        toast.success(
          carryOverSetIds.length > 0
            ? `Finished ${groupName} — carrying ${carryOverSetIds.length} set${carryOverSetIds.length === 1 ? "" : "s"} forward.`
            : `Finished ${groupName}.`,
        );
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to finish round.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Finish {groupName}?</DialogTitle>
          <DialogDescription>
            {carryOverScores
              ? "Choose which sets to carry forward into the next round. Deselect any sets you want to exclude."
              : "This round will be locked. It is not configured to carry scores forward."}
          </DialogDescription>
        </DialogHeader>

        {/* Set picker — only shown when carry-over is enabled */}
        {carryOverScores && sets.length > 0 && (
          <div className="max-h-60 overflow-auto rounded-md border border-border">
            {sets.map((set) => (
              <label
                key={set.id}
                className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 text-sm last:border-b-0 hover:bg-muted/40"
              >
                <input
                  type="checkbox"
                  checked={picked.has(set.id)}
                  onChange={(e) => togglePicked(set.id, e.target.checked)}
                  className="size-4 accent-primary"
                />
                <span className="font-medium">{set.name}</span>
              </label>
            ))}
          </div>
        )}

        {carryOverScores && sets.length === 0 && (
          <p className="text-sm text-muted-foreground py-1">
            No sets in this round to carry forward.
          </p>
        )}

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" disabled={pending}>
                Cancel
              </Button>
            }
          />
          <Button
            onClick={submit}
            disabled={pending || (carryOverScores && picked.size === 0)}
            className="gap-1.5"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {carryOverScores
              ? `Finish & carry ${picked.size} set${picked.size === 1 ? "" : "s"}`
              : "Finish round"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
