"use client";

import { useState, useTransition } from "react";
import { Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { clearRoundScoresAction } from "@/app/(dashboard)/tabulator/actions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CONFIRM_WORD = "CLEAR";

/**
 * Destructive confirmation for clearing scores in one round group. Requires
 * typing CLEAR so scores can't be wiped by an accidental click.
 */
export function ClearRoundScoresDialog({
  groupId,
  groupName,
  scoreRecords,
  hasData,
  isActive,
  trigger,
}: {
  groupId: string;
  groupName: string;
  scoreRecords: number;
  hasData: boolean;
  isActive: boolean;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setConfirmText("");
  }

  function submit() {
    startTransition(async () => {
      try {
        const result = await clearRoundScoresAction(groupId);
        toast.success(
          result.scoreRecords > 0
            ? `Cleared ${result.scoreRecords} score${result.scoreRecords === 1 ? "" : "s"} from ${groupName}.`
            : `${groupName} had no scores to clear.`,
        );
        setOpen(false);
        setConfirmText("");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to clear round scores.",
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-5 text-destructive" />
            Clear scores for {groupName}?
          </DialogTitle>
          <DialogDescription>
            This permanently removes every score, judge submission, and unlock
            request for this round, resets the round and its sets to idle, and
            clears any qualifier snapshot. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {isActive && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
            This round is currently active. Clearing scores will deactivate it.
          </p>
        )}

        {hasData ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
            <span className="font-semibold tabular-nums">{scoreRecords}</span>{" "}
            score record{scoreRecords === 1 ? "" : "s"} will be deleted.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            This round has no scores yet — running this still resets it to idle.
          </p>
        )}

        <div className="grid gap-2">
          <Label htmlFor={`confirm-clear-${groupId}`}>
            Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span>{" "}
            to confirm
          </Label>
          <Input
            id={`confirm-clear-${groupId}`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
            placeholder={CONFIRM_WORD}
          />
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" disabled={pending}>
                Cancel
              </Button>
            }
          />
          <Button
            variant="destructive"
            onClick={submit}
            disabled={pending || confirmText.trim() !== CONFIRM_WORD}
            className="gap-1.5"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            Clear round scores
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
