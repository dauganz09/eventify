"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function Portrait({
  contestant,
  className,
}: {
  contestant: { displayName: string; photoUrl: string | null };
  className?: string;
}) {
  if (contestant.photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={contestant.photoUrl}
        alt=""
        className={cn("size-full object-cover", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex size-full items-center justify-center bg-muted font-semibold text-muted-foreground",
        className,
      )}
    >
      {initials(contestant.displayName)}
    </span>
  );
}

/**
 * A blocking prompt pushed to a judge's device when the tabulator asks the
 * panel to break a tie live. No escape hatch on purpose — it stays up until
 * the judge votes (or the tabulator cancels/resolves the vote, which makes
 * the parent's `vote` prop go null and this unmounts).
 *
 * Ranking is tap-to-pick: tapping a card assigns it the next open rank;
 * tapping a ranked card again un-ranks it and everything after re-flows —
 * faster and less fiddly on a phone/tablet than drag or up/down reordering.
 */
export function JudgeTieBreakDialog({ vote }: { vote: JudgeTieBreakVote }) {
  const [order, setOrder] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [pending, startTransition] = useTransition();

  const total = vote.contestants.length;
  const complete = order.length === total;

  function toggle(id: string) {
    setOrder((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
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

  return (
    <Dialog open onOpenChange={() => {}} disablePointerDismissal>
      <DialogContent
        className="flex max-h-[97dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        showCloseButton={false}
      >
        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <CheckCircle2 className="size-10 text-emerald-500" />
            <p className="font-medium">Vote submitted</p>
            <p className="text-sm text-muted-foreground">
              Waiting on the other judges — this closes on its own once everyone&rsquo;s voted.
            </p>
          </div>
        ) : (
          <>
            <DialogHeader className="shrink-0 gap-1 border-b border-border px-5 py-4 text-left">
              <DialogTitle className="text-lg">Tie at {vote.rankLabel}</DialogTitle>
              <DialogDescription>
                Deciding {SCOPE_COPY[vote.scope]}. Tap the contestants in the order you&rsquo;d
                rank them — first tap gets {vote.rankLabel}.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {vote.contestants.map((contestant) => {
                  const rankIndex = order.indexOf(contestant.id);
                  const ranked = rankIndex !== -1;
                  return (
                    <button
                      key={contestant.id}
                      type="button"
                      onClick={() => toggle(contestant.id)}
                      className={cn(
                        "group relative overflow-hidden rounded-2xl border-2 text-left transition-all active:scale-[0.97]",
                        ranked
                          ? "border-primary shadow-md shadow-primary/20"
                          : "border-border hover:border-primary/40",
                      )}
                    >
                      <div className="relative aspect-[4/5] w-full overflow-hidden bg-muted">
                        <Portrait contestant={contestant} className="text-xl" />
                        <div
                          className={cn(
                            "absolute inset-0 transition-colors",
                            ranked ? "bg-primary/15" : "bg-black/0 group-active:bg-black/10",
                          )}
                        />
                        {contestant.displayNumber && (
                          <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-sm">
                            #{contestant.displayNumber}
                          </span>
                        )}
                        <span
                          className={cn(
                            "absolute bottom-2 left-2 flex size-11 items-center justify-center rounded-full border-2 text-xl font-extrabold transition-all",
                            ranked
                              ? "scale-100 border-primary-foreground/80 bg-primary text-primary-foreground shadow-lg shadow-primary/50 ring-4 ring-primary/30"
                              : "scale-90 border-dashed border-white/50 bg-black/30 text-transparent backdrop-blur-sm",
                          )}
                        >
                          {ranked ? rankIndex + 1 : ""}
                        </span>
                      </div>
                      <div className="px-2.5 py-2">
                        <p className="truncate text-sm font-semibold leading-tight">
                          {contestant.displayName}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3.5">
              <span className="text-sm text-muted-foreground">
                {order.length} of {total} ranked
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOrder([])}
                  disabled={order.length === 0}
                  className="gap-1.5"
                >
                  <RotateCcw className="size-4" />
                  Clear
                </Button>
                <Button onClick={submit} disabled={!complete || pending} className="gap-1.5">
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  Submit my vote
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
