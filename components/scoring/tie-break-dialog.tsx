"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, Loader2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { saveTieBreakAction } from "@/app/(dashboard)/tabulator/actions";

export interface TieBreakContestant {
  id: string;
  displayNumber: string | null;
  displayName: string;
}

function contestantLabel(c: TieBreakContestant) {
  return c.displayNumber ? `${c.displayNumber}. ${c.displayName}` : c.displayName;
}

/**
 * Lets the tabulator break a tie by hand: pick the order themselves, or type
 * in what the judges decided after polling them live. Order is set with
 * up/down buttons (no drag-and-drop dependency in this repo) starting from
 * the tied contestants' current display order.
 */
export function TieBreakDialog({
  eventId,
  scope,
  contextId,
  contestants,
  rankLabel,
  trigger,
}: {
  eventId: string;
  scope: "standings" | "advancement" | "rank_order";
  contextId: string | null;
  /** The tied contestants, in their current (tied) display order. */
  contestants: TieBreakContestant[];
  /** e.g. "rank 5" or "rank sum 8" — shown in the dialog title. */
  rankLabel: string;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [order, setOrder] = useState<string[]>(contestants.map((c) => c.id));
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  // Base UI DialogTrigger clones the trigger via `render` and assigns unstable
  // ids during SSR — defer the dialog until after hydration so server HTML
  // matches the client's first paint.
  useEffect(() => setMounted(true), []);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setOrder(contestants.map((c) => c.id));
      setNote("");
    }
  }

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
        await saveTieBreakAction({
          eventId,
          scope,
          contextId,
          tiedContestantIds: contestants.map((c) => c.id),
          order,
          note: note.trim() || undefined,
        });
        toast.success("Tie broken.");
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to break the tie.");
      }
    });
  }

  const byId = new Map(contestants.map((c) => [c.id, c]));

  if (!mounted) return trigger;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Break the tie at {rankLabel}</DialogTitle>
          <DialogDescription>
            Set the order yourself, or poll the judges live and enter what they decided.
            Top of the list places first.
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
                <span className="flex-1 font-medium">{contestantLabel(contestant)}</span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-7"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-7"
                    disabled={index === order.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder='How was this decided? e.g. "Judges’ show of hands, 2–1."'
          rows={2}
        />

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" disabled={pending}>
                Cancel
              </Button>
            }
          />
          <Button onClick={submit} disabled={pending} className="gap-1.5">
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Save order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
