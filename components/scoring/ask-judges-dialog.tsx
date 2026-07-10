"use client";

import { useState, useTransition } from "react";
import { Loader2, Users } from "lucide-react";
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
import { openTieBreakVoteAction } from "@/app/(dashboard)/tabulator/actions";

/**
 * Confirms and opens a live "ask the judges" vote for a tie — the judge-vote
 * counterpart to the manual TieBreakDialog. Every eligible judge's device
 * gets a blocking prompt; it resolves automatically once they've all voted.
 */
export function AskJudgesDialog({
  eventId,
  scope,
  contextId,
  tiedContestantIds,
  rankLabel,
  trigger,
}: {
  eventId: string;
  scope: "standings" | "advancement" | "rank_order";
  contextId: string | null;
  tiedContestantIds: string[];
  /** e.g. "rank 5" or "rank sum 8" — shown in the confirmation and pushed to judges. */
  rankLabel: string;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      try {
        await openTieBreakVoteAction({
          eventId,
          scope,
          contextId,
          tiedContestantIds,
          rankLabel,
        });
        toast.success("Judges have been asked to vote.");
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to start the vote.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Ask judges to break the tie at {rankLabel}?</DialogTitle>
          <DialogDescription>
            Every eligible judge gets a prompt on their device to rank the tied contestants. It
            resolves automatically once they&rsquo;ve all voted — you can also resolve it early
            or cancel at any time while it&rsquo;s open.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" disabled={pending}>
                Cancel
              </Button>
            }
          />
          <Button onClick={submit} disabled={pending} className="gap-1.5">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Users className="size-4" />}
            Ask judges
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
