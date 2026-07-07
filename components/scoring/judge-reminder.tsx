"use client";

import { useState, useTransition } from "react";
import { Bell, Loader2, Send } from "lucide-react";
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
import { sendJudgeReminderAction } from "@/app/(dashboard)/tabulator/actions";

const PRESETS = [
  "Please finish scoring all the contestants",
  "We were about to move to the next segment",
  "We were about to move to the next round",
];

/** Tabulator control: send a realtime toast reminder to one judge. */
export function JudgeReminder({
  eventId,
  judgeId,
  judgeName,
}: {
  eventId: string;
  judgeId: string;
  judgeName: string;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function send(text: string) {
    const body = text.trim();
    if (!body) {
      toast.error("Enter a message first.");
      return;
    }
    startTransition(async () => {
      try {
        await sendJudgeReminderAction({ eventId, judgeId, message: body });
        toast.success(`Reminder sent to ${judgeName}.`);
        setMessage("");
        setOpen(false);
      } catch {
        toast.error("Failed to send reminder.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <Bell className="size-4" />
            Remind
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remind {judgeName}</DialogTitle>
          <DialogDescription>
            Sends a realtime toast to this judge&apos;s screen. Not saved.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => send(preset)}
              >
                {preset}
              </Button>
            ))}
          </div>

          <Textarea
            placeholder="Or type a custom message…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            rows={3}
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
          <Button onClick={() => send(message)} disabled={pending} className="gap-1.5">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
