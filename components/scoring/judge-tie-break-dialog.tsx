"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface JudgeTieBreakVote {
  id: string;
  scope: "standings" | "advancement" | "rank_order";
  /** e.g. "rank 5" or "rank sum 8" — what exactly is being decided. */
  rankLabel: string;
  /** The tied contestants, in their current display order. */
  contestants: Array<{
    id: string;
    displayNumber: string | null;
    displayName: string;
    photoUrl: string | null;
  }>;
}

const SCOPE_COPY: Record<JudgeTieBreakVote["scope"], string> = {
  standings: "the final standings",
  advancement: "who advances to the next round",
  rank_order: "this round's placement",
};

function contestantLabel(c: { displayNumber: string | null; displayName: string }) {
  return c.displayNumber ? `${c.displayNumber}. ${c.displayName}` : c.displayName;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * A blocking prompt pushed to a judge's device when the tabulator asks the
 * panel to break a tie live. No escape hatch on purpose — it stays up until
 * the judge votes (or the tabulator cancels/resolves the vote, which makes
 * the parent's `vote` prop go null and this unmounts).
 */
export function JudgeTieBreakDialog({ vote }: { vote: JudgeTieBreakVote }) {
  const [order, setOrder] = useState<string[]>(vote.contestants.map((c) => c.id));
  const [submitted, setSubmitted] = useState(false);
  const [pending, startTransition] = useTransition();

  function move(index: number, direction: -1 | 1) {
    setOrder((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function submit() {
    startTransition(async () => {
      try {
        const response = await fetch("/api/judge/cast-tie-break-vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voteId: vote.id, order }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error ?? "Failed to submit your vote.");
        }
        setSubmitted(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to submit your vote.");
      }
    });
  }

  const byId = new Map(vote.contestants.map((c) => [c.id, c]));

  return (
    <Dialog open onOpenChange={() => {}} disablePointerDismissal>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="size-10 text-emerald-500" />
            <p className="font-medium">Vote submitted</p>
            <p className="text-sm text-muted-foreground">
              Waiting on the other judges — this closes on its own once everyone&rsquo;s voted.
            </p>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>The tabulator needs your vote — {vote.rankLabel}</DialogTitle>
              <DialogDescription>
                There&rsquo;s a tie at {vote.rankLabel}, deciding {SCOPE_COPY[vote.scope]}. Rank
                these contestants — top of the list places first.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-md border border-border">
              {order.map((id, index) => {
                const contestant = byId.get(id);
                if (!contestant) return null;
                return (
                  <div
                    key={id}
                    className="flex items-center gap-3 border-b border-border px-3 py-2.5 text-sm last:border-b-0"
                  >
                    <span className="w-5 font-semibold text-muted-foreground">{index + 1}</span>
                    {contestant.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={contestant.photoUrl}
                        alt=""
                        className="size-10 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                        {initials(contestant.displayName)}
                      </span>
                    )}
                    <span className="flex-1 font-medium">{contestantLabel(contestant)}</span>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-8"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-8"
                        disabled={index === order.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <DialogFooter>
              <Button onClick={submit} disabled={pending} className="w-full gap-1.5">
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                Submit my vote
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
