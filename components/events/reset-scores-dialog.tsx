"use client";

import { useState, useTransition } from "react";
import { Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { resetEventScoresAction } from "@/app/(dashboard)/events/[eventId]/builder/actions";
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

const CONFIRM_WORD = "RESET";

/**
 * Destructive confirmation for initializing an event. Requires typing RESET so
 * scores can't be wiped by an accidental click. Mirrors FinishRoundDialog.
 */
export function ResetScoresDialog({
  eventId,
  scoreRecords,
  hasData,
}: {
  eventId: string;
  scoreRecords: number;
  hasData: boolean;
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
        const result = await resetEventScoresAction(eventId);
        toast.success(
          result.scoreRecords > 0
            ? `Event initialized — cleared ${result.scoreRecords} score${result.scoreRecords === 1 ? "" : "s"}.`
            : "Event initialized — no scores to clear.",
        );
        setOpen(false);
        setConfirmText("");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to initialize event.",
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" className="gap-2">
            <RotateCcw className="size-4" />
            Initialize event
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-5 text-destructive" />
            Initialize event?
          </DialogTitle>
          <DialogDescription>
            This permanently clears all scores, score history, judge
            submissions, unlock requests, and results, and resets every round
            and set to idle. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {hasData ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
            <span className="font-semibold tabular-nums">{scoreRecords}</span>{" "}
            score record{scoreRecords === 1 ? "" : "s"} will be deleted.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            This event has no scores yet — running this resets the run-of-show to
            a clean state.
          </p>
        )}

        <div className="grid gap-2">
          <Label htmlFor="confirm-reset">
            Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span>{" "}
            to confirm
          </Label>
          <Input
            id="confirm-reset"
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
            Initialize event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
