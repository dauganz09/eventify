"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Bell,
  CheckCircle2,
  Loader2,
  Lock,
  LockOpen,
  LogOut,
  Power,
  Printer,
  Send,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  releaseJudgeSessionAction,
  releaseSetFinalizationAction,
  sendJudgeBulkReminderAction,
  sendJudgeReminderAction,
} from "@/app/(dashboard)/tabulator/actions";
import { NewTabLink } from "@/components/scoring/new-tab-link";
import { useTabulatorLiveSnapshot } from "@/components/scoring/tabulator-live-context";

interface Judge {
  id: string;
  displayName: string;
  isActive: boolean;
  submitted: number;
  signedIn: boolean;
  activeSetProgress: {
    setId: string;
    setName: string;
    done: number;
    total: number;
  } | null;
  finalizedActiveSet: boolean;
}

const PRESETS = [
  "Please finish scoring all the contestants",
  "We were about to move to the next segment",
  "We were about to move to the next round",
];

type Target =
  | { kind: "one"; judgeId: string; judgeName: string }
  | { kind: "many"; judgeIds: string[]; label: string };

/**
 * Table-format judges panel for the tabulator console.
 *
 * - Multi-select via row checkboxes + a select-all header checkbox.
 * - Toolbar buttons: "Remind selected (N)" and "Remind all active".
 * - Per-row "Remind" button still available.
 * - All three entrypoints open the same message dialog (presets + free text).
 */
export function JudgesReminderTable({
  eventId,
  judges,
  canAdjust,
  activeSetId,
}: {
  eventId: string;
  judges: Judge[];
  canAdjust: boolean;
  /** The currently active set id, for releasing a judge's submit-&-lock. */
  activeSetId: string | null;
}) {
  const live = useTabulatorLiveSnapshot();
  const resolvedJudges = live?.judges ?? judges;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<Target | null>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [releasing, setReleasing] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [, startReleaseTransition] = useTransition();

  function unlockSet(judge: Judge) {
    if (!activeSetId) return;
    setUnlocking(judge.id);
    startReleaseTransition(async () => {
      try {
        await releaseSetFinalizationAction({
          eventId,
          judgeId: judge.id,
          roundId: activeSetId,
        });
        toast.success(`Reopened scoring for ${judge.displayName}.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to unlock.");
      } finally {
        setUnlocking(null);
      }
    });
  }

  function releaseSession(judge: Judge) {
    setReleasing(judge.id);
    startReleaseTransition(async () => {
      try {
        await releaseJudgeSessionAction({ eventId, judgeId: judge.id });
        toast.success(`Released ${judge.displayName}'s session.`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to release session.",
        );
      } finally {
        setReleasing(null);
      }
    });
  }

  const activeJudges = useMemo(
    () => resolvedJudges.filter((j) => j.isActive),
    [resolvedJudges],
  );
  const activeSetName = useMemo(
    () => resolvedJudges.find((j) => j.activeSetProgress)?.activeSetProgress?.setName ?? null,
    [resolvedJudges],
  );
  const selectableIds = useMemo(() => activeJudges.map((j) => j.id), [activeJudges]);
  const allActiveSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someActiveSelected =
    selectableIds.some((id) => selected.has(id)) && !allActiveSelected;

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(() => (checked ? new Set(selectableIds) : new Set()));
  }

  function openTarget(t: Target) {
    setTarget(t);
    setMessage("");
  }

  function closeDialog() {
    setTarget(null);
    setMessage("");
  }

  function send(text: string) {
    if (!target) return;
    const body = text.trim();
    if (!body) {
      toast.error("Enter a message first.");
      return;
    }

    startTransition(async () => {
      try {
        if (target.kind === "one") {
          await sendJudgeReminderAction({
            eventId,
            judgeId: target.judgeId,
            message: body,
          });
          toast.success(`Reminder sent to ${target.judgeName}.`);
        } else {
          const { delivered } = await sendJudgeBulkReminderAction({
            eventId,
            judgeIds: target.judgeIds,
            message: body,
          });
          toast.success(
            `Reminder sent to ${delivered} judge${delivered === 1 ? "" : "s"}.`,
          );
          setSelected(new Set());
        }
        closeDialog();
      } catch {
        toast.error("Failed to send reminder.");
      }
    });
  }

  if (resolvedJudges.length === 0) {
    return <p className="text-sm text-muted-foreground">No judges added yet.</p>;
  }

  const selectedActiveIds = selectableIds.filter((id) => selected.has(id));

  return (
    <div className="grid gap-3">
      {/* Bulk action toolbar */}
      {canAdjust && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
          <div className="text-sm text-muted-foreground">
            {selected.size === 0
              ? `${activeJudges.length} active judge${activeJudges.length === 1 ? "" : "s"}`
              : `${selected.size} selected`}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={selectedActiveIds.length === 0}
              onClick={() =>
                openTarget({
                  kind: "many",
                  judgeIds: selectedActiveIds,
                  label: `${selectedActiveIds.length} selected judge${
                    selectedActiveIds.length === 1 ? "" : "s"
                  }`,
                })
              }
            >
              <Bell className="size-4" />
              Remind selected ({selectedActiveIds.length})
            </Button>
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              disabled={activeJudges.length === 0}
              onClick={() =>
                openTarget({
                  kind: "many",
                  judgeIds: activeJudges.map((j) => j.id),
                  label: `all ${activeJudges.length} active judge${
                    activeJudges.length === 1 ? "" : "s"
                  }`,
                })
              }
            >
              <Bell className="size-4" />
              Remind all active
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {canAdjust && (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all active judges"
                    checked={allActiveSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someActiveSelected;
                    }}
                    disabled={selectableIds.length === 0}
                    onChange={(e) => toggleAll(e.target.checked)}
                    className="size-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </TableHead>
              )}
              <TableHead>Judge</TableHead>
              <TableHead className="w-32">Status</TableHead>
              <TableHead className="w-32">Session</TableHead>
              <TableHead className="w-44">
                Scored
                {activeSetName && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    · {activeSetName}
                  </span>
                )}
              </TableHead>
              <TableHead className="w-28 text-right">Submitted</TableHead>
              {canAdjust && <TableHead className="w-56 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {resolvedJudges.map((judge) => {
              const checked = selected.has(judge.id);
              return (
                <TableRow key={judge.id}>
                  {canAdjust && (
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Select ${judge.displayName}`}
                        checked={checked}
                        disabled={!judge.isActive}
                        onChange={(e) => toggleOne(judge.id, e.target.checked)}
                        className="size-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {judge.isActive ? (
                        <CheckCircle2 className="size-4 text-emerald-600" />
                      ) : (
                        <Power className="size-4 text-muted-foreground" />
                      )}
                      <span className="font-medium">{judge.displayName}</span>
                      <NewTabLink
                        href={`/tabulator/${eventId}/print/judge-scores?judge=${judge.id}`}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Printer className="size-3.5" />
                        Scores
                      </NewTabLink>
                    </div>
                  </TableCell>
                  <TableCell>
                    {judge.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {judge.signedIn ? (
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                        <Wifi className="size-4" />
                        Signed in
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <WifiOff className="size-4" />
                        Signed out
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ScoredProgress progress={judge.activeSetProgress} />
                      {judge.finalizedActiveSet && (
                        <Badge variant="success" className="gap-1">
                          <Lock className="size-3" />
                          Locked
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {judge.submitted}
                  </TableCell>
                  {canAdjust && (
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {judge.finalizedActiveSet && activeSetId && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            disabled={unlocking === judge.id}
                            title="Reopen this set so the judge can edit their scores"
                            onClick={() => unlockSet(judge)}
                          >
                            {unlocking === judge.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <LockOpen className="size-4" />
                            )}
                            Unlock
                          </Button>
                        )}
                        {judge.signedIn && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5 text-destructive hover:text-destructive"
                            disabled={releasing === judge.id}
                            title="Sign this judge out of all devices so they can log in fresh"
                            onClick={() => releaseSession(judge)}
                          >
                            {releasing === judge.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <LogOut className="size-4" />
                            )}
                            Release
                          </Button>
                        )}
                        {judge.isActive ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() =>
                              openTarget({
                                kind: "one",
                                judgeId: judge.id,
                                judgeName: judge.displayName,
                              })
                            }
                          >
                            <Bell className="size-4" />
                            Remind
                          </Button>
                        ) : (
                          !judge.signedIn && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={target !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {target?.kind === "one"
                ? `Remind ${target.judgeName}`
                : `Remind ${target?.kind === "many" ? target.label : ""}`}
            </DialogTitle>
            <DialogDescription>
              Sends a realtime toast to{" "}
              {target?.kind === "one" ? "this judge's" : "each judge's"} screen.
              Not saved.
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
            <Button
              onClick={() => send(message)}
              disabled={pending}
              className="gap-1.5"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "8/10" completion on the active set, with a thin progress bar. */
function ScoredProgress({
  progress,
}: {
  progress: Judge["activeSetProgress"];
}) {
  if (!progress) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const { done, total } = progress;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const complete = total > 0 && done >= total;
  return (
    <div className="grid w-32 gap-1">
      <span
        className={`text-sm font-semibold tabular-nums ${
          complete ? "text-emerald-600" : ""
        }`}
      >
        {done}/{total}
        {complete && <span className="ml-1 font-normal">✓</span>}
      </span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${
            complete ? "bg-emerald-500" : "bg-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
