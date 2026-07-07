"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronRight, Lock, PlusIcon, Unlock } from "lucide-react";
import {
  deleteRoundAction,
  deleteRoundGroupAction,
  saveRoundAction,
  saveRoundGroupAction,
  toggleRoundLockAction,
} from "@/app/(dashboard)/events/[eventId]/builder/actions";
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
import { nativeSelectClassName } from "@/lib/events/format";

export type RoundGroupRow = {
  id: string;
  name: string;
  description: string | null;
  position: number;
  carryOverScores: boolean;
  carryOverWeight: number;
  advanceCount: number | null;
  advanceDisplayOrder: string;
  scoringMethod: string;
};

export type RoundRow = {
  id: string;
  name: string;
  description: string | null;
  position: number;
  isLocked: boolean;
  isManualEntry: boolean;
  roundGroupId: string | null;
};

export function RoundsManager({
  eventId,
  roundScoreMode = "average",
  scoredRoundIds = [],
  roundGroups,
  rounds,
}: {
  eventId: string;
  /** "average" | "sum" — in sum (points-based) mode rounds carry full weight. */
  roundScoreMode?: string;
  /** Sets with recorded scores — deletion is locked for them (tamper guard). */
  scoredRoundIds?: string[];
  roundGroups: RoundGroupRow[];
  rounds: RoundRow[];
}) {
  const scoredSet = new Set(scoredRoundIds);
  const roundsByGroup = new Map<string | null, RoundRow[]>();
  for (const round of rounds) {
    const key = round.roundGroupId ?? null;
    const bucket = roundsByGroup.get(key) ?? [];
    bucket.push(round);
    roundsByGroup.set(key, bucket);
  }
  const ungroupedRounds = roundsByGroup.get(null) ?? [];

  return (
    <div className="grid gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Rounds</h2>
          <p className="text-sm text-muted-foreground">
            Manage round groups and scoring sets for this event.
          </p>
        </div>
        <RoundGroupFormDialog
          eventId={eventId}
          roundScoreMode={roundScoreMode}
          totalGroups={roundGroups.length}
          allGroups={roundGroups}
          trigger={
            <Button>
              <PlusIcon className="size-4" />
              Add round group
            </Button>
          }
        />
      </div>

      {/* Empty state */}
      {roundGroups.length === 0 && ungroupedRounds.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No rounds yet. Create a round group first, then add sets inside it.
          </p>
          <RoundGroupFormDialog
            eventId={eventId}
            roundScoreMode={roundScoreMode}
            totalGroups={roundGroups.length}
            allGroups={roundGroups}
            trigger={
              <Button variant="secondary" size="sm">
                <PlusIcon className="size-4" />
                Add round group
              </Button>
            }
          />
        </div>
      )}

      {/* Round groups */}
      {roundGroups.map((group) => {
        const groupRounds = roundsByGroup.get(group.id) ?? [];
        return (
          <div
            key={group.id}
            className="rounded-lg border border-border bg-card overflow-hidden"
          >
            {/* Group header */}
            <div className="flex items-start justify-between gap-4 border-b border-border bg-muted/30 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">{group.name}</p>
                  {group.carryOverScores && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {roundScoreMode === "sum"
                        ? "Carries over (full points)"
                        : `Carries over · ${group.carryOverWeight}%`}
                    </span>
                  )}
                  {group.advanceCount !== null && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Top {group.advanceCount} only
                    </span>
                  )}
                  {group.scoringMethod === "rank_order" && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Rank order
                    </span>
                  )}
                </div>
                {group.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {group.description}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <RoundGroupFormDialog
                  eventId={eventId}
                  roundScoreMode={roundScoreMode}
                  totalGroups={roundGroups.length}
                  allGroups={roundGroups}
                  group={group}
                  trigger={<Button size="sm" variant="ghost">Edit</Button>}
                />
                <DeleteRoundGroupButton
                  eventId={eventId}
                  groupId={group.id}
                  groupName={group.name}
                  hasScores={groupRounds.some((round) => scoredSet.has(round.id))}
                />
              </div>
            </div>

            {/* Sets inside group */}
            <div className="divide-y divide-border">
              {groupRounds.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  No sets yet in this group.
                </p>
              ) : (
                groupRounds.map((round) => (
                  <RoundRow
                    key={round.id}
                    eventId={eventId}
                    round={round}
                    roundGroups={roundGroups}
                    totalRounds={rounds.length}
                    hasScores={scoredSet.has(round.id)}
                  />
                ))
              )}
            </div>

            {/* Add set button */}
            <div className="border-t border-border px-4 py-2">
              <RoundFormDialog
                eventId={eventId}
                roundGroups={roundGroups}
                totalRounds={rounds.length}
                defaultGroupId={group.id}
                trigger={
                  <Button size="sm" variant="ghost">
                    <PlusIcon className="size-3.5" />
                    Add set to {group.name}
                  </Button>
                }
              />
            </div>
          </div>
        );
      })}

      {/* Ungrouped rounds */}
      {ungroupedRounds.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="border-b border-border bg-muted/30 px-4 py-3">
            <p className="text-sm font-medium text-muted-foreground">Ungrouped sets</p>
          </div>
          <div className="divide-y divide-border">
            {ungroupedRounds.map((round) => (
              <RoundRow
                key={round.id}
                eventId={eventId}
                round={round}
                roundGroups={roundGroups}
                totalRounds={rounds.length}
                hasScores={scoredSet.has(round.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Standalone "Add set" (only when groups exist) */}
      {roundGroups.length > 0 && (
        <div className="flex justify-end">
          <RoundFormDialog
            eventId={eventId}
            roundGroups={roundGroups}
            totalRounds={rounds.length}
            trigger={
              <Button variant="outline">
                <PlusIcon className="size-4" />
                Add set
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}

// ── Round row ────────────────────────────────────────────────────────────────

function RoundRow({
  eventId,
  round,
  roundGroups,
  totalRounds,
  hasScores = false,
}: {
  eventId: string;
  round: RoundRow;
  roundGroups: RoundGroupRow[];
  totalRounds: number;
  hasScores?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="flex items-center gap-2 text-sm">
        <ChevronRight className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{round.name}</span>
        {round.isManualEntry && (
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
            Manual entry
          </span>
        )}
        {round.isLocked && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            Locked
          </span>
        )}
        {hasScores && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
            Has scores
          </span>
        )}
      </div>
      <div className="flex gap-1">
        <RoundFormDialog
          eventId={eventId}
          roundGroups={roundGroups}
          totalRounds={totalRounds}
          round={round}
          trigger={<Button size="sm" variant="ghost">Edit</Button>}
        />
        <ToggleLockButton eventId={eventId} round={round} />
        <DeleteRoundButton
          eventId={eventId}
          roundId={round.id}
          roundName={round.name}
          hasScores={hasScores}
        />
      </div>
    </div>
  );
}

// ── Round group form dialog ──────────────────────────────────────────────────

function RoundGroupFormDialog({
  eventId,
  roundScoreMode = "average",
  totalGroups,
  allGroups = [],
  group,
  trigger,
}: {
  eventId: string;
  roundScoreMode?: string;
  totalGroups: number;
  allGroups?: RoundGroupRow[];
  group?: RoundGroupRow;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [carryOver, setCarryOver] = useState(group?.carryOverScores ?? false);
  const [weightInput, setWeightInput] = useState(String(group?.carryOverWeight ?? 100));
  const [restrictAdvance, setRestrictAdvance] = useState(group?.advanceCount != null);
  const isEdit = !!group;

  // Sum of carry-over weights from all OTHER groups that have carryOverScores enabled.
  const otherWeightsSum = allGroups
    .filter((g) => g.carryOverScores && g.id !== group?.id)
    .reduce((sum, g) => sum + g.carryOverWeight, 0);

  // In "sum" (points-based) mode every round carries its full points — no
  // weight allocation, so the over-100% checks don't apply.
  const pointsBased = roundScoreMode === "sum";
  const enteredWeight = Number(weightInput);
  const totalWeight = otherWeightsSum + (carryOver ? (isNaN(enteredWeight) ? 0 : enteredWeight) : 0);
  const remaining = 100 - otherWeightsSum;
  // Only OVER-allocating past 100% blocks the save. A running total below 100%
  // is fine — you finish allocating it across the other rounds, and the
  // readiness check confirms the total is exactly 100% before activation.
  const weightError =
    !pointsBased && carryOver && !isNaN(enteredWeight) && totalWeight > 100
      ? `Total exceeds 100% (currently ${totalWeight}%). This round can be at most ${remaining}%.`
      : null;
  const weightInfo =
    !pointsBased && carryOver && !isNaN(enteredWeight) && !weightError && totalWeight !== 100
      ? `All rounds total ${totalWeight}% so far — they must reach 100% before you can activate the event.`
      : null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await saveRoundGroupAction(eventId, formData);
        toast.success(isEdit ? "Round group updated." : "Round group added.");
        setOpen(false);
      } catch {
        toast.error(
          isEdit ? "Failed to update round group." : "Failed to add round group.",
        );
      }
    });
  }

  function resetState() {
    setCarryOver(group?.carryOverScores ?? false);
    setWeightInput(String(group?.carryOverWeight ?? 100));
    setRestrictAdvance(group?.advanceCount != null);
  }

  return (
    <>
      <span onClick={() => { setOpen(true); resetState(); }} style={{ display: "contents" }}>
        {trigger}
      </span>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetState(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Edit round group" : "Add round group"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="grid gap-4" key={group?.id ?? "new"}>
            {isEdit && (
              <input type="hidden" name="roundGroupId" value={group.id} />
            )}
            <div className="grid gap-2">
              <Label htmlFor="rg-name">Group name</Label>
              <Input
                id="rg-name"
                name="name"
                required
                placeholder="e.g. Preliminary Round"
                defaultValue={group?.name ?? ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rg-description">Description</Label>
              <Textarea
                id="rg-description"
                name="description"
                defaultValue={group?.description ?? ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rg-position">Position</Label>
              <Input
                id="rg-position"
                name="position"
                type="number"
                min={0}
                defaultValue={group?.position ?? totalGroups}
              />
            </div>

            {/* Carry-over configuration */}
            <div className="rounded-lg border border-border p-3 grid gap-3">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  name="carryOverScores"
                  checked={carryOver}
                  onChange={(e) => setCarryOver(e.target.checked)}
                  className="size-4 rounded border-border"
                />
                <span className="text-sm font-medium">Carry scores forward to the next round</span>
              </label>
              {carryOver && pointsBased && (
                <div className="grid gap-1.5 pl-6">
                  {/* Points-based events always carry a round's full points. */}
                  <input type="hidden" name="carryOverWeight" value="100" />
                  <p className="text-xs text-muted-foreground">
                    Points-based scoring: this round carries its full points
                    into the overall total (e.g. a 30-point round adds up to 30
                    points).
                  </p>
                </div>
              )}
              {carryOver && !pointsBased && (
                <div className="grid gap-1.5 pl-6">
                  <Label htmlFor="rg-weight" className="text-sm">
                    Round weight (%)
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="rg-weight"
                      name="carryOverWeight"
                      type="number"
                      min={0}
                      max={100}
                      value={weightInput}
                      onChange={(e) => setWeightInput(e.target.value)}
                      className={`w-24 ${weightError ? "border-destructive ring-destructive" : ""}`}
                    />
                    <span className="text-sm text-muted-foreground">
                      / 100%
                    </span>
                  </div>
                  {otherWeightsSum > 0 && !weightError && (
                    <p className="text-xs text-muted-foreground">
                      Other rounds use {otherWeightsSum}% — {remaining}% left to allocate.
                    </p>
                  )}
                  {weightError ? (
                    <p className="text-xs text-destructive font-medium">{weightError}</p>
                  ) : weightInfo ? (
                    <p className="text-xs text-amber-600 dark:text-amber-500 font-medium">{weightInfo}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      How much this round contributes to the final score (0–100).
                      All rounds combined must total 100%.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Advancement: restrict this round to the top N qualifiers */}
            <div className="rounded-lg border border-border p-3 grid gap-3">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={restrictAdvance}
                  onChange={(e) => setRestrictAdvance(e.target.checked)}
                  className="size-4 rounded border-border"
                />
                <span className="text-sm font-medium">
                  Only the top contestants from previous rounds advance
                </span>
              </label>
              {restrictAdvance ? (
                <div className="grid gap-3 pl-6">
                  <div className="grid gap-1.5">
                    <Label htmlFor="rg-advanceCount" className="text-sm">
                      How many advance
                    </Label>
                    <Input
                      id="rg-advanceCount"
                      name="advanceCount"
                      type="number"
                      min={1}
                      className="w-24"
                      defaultValue={group?.advanceCount ?? 5}
                    />
                    <p className="text-xs text-muted-foreground">
                      The qualifiers are locked in when this round is opened for
                      scoring, based on the finished rounds&rsquo; standings.
                    </p>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="rg-advanceDisplayOrder" className="text-sm">
                      Judge panel order
                    </Label>
                    <select
                      className={nativeSelectClassName}
                      id="rg-advanceDisplayOrder"
                      name="advanceDisplayOrder"
                      defaultValue={group?.advanceDisplayOrder ?? "number"}
                    >
                      <option value="number">
                        By contestant number (hides current standings)
                      </option>
                      <option value="rank">By current rank (best first)</option>
                    </select>
                  </div>
                </div>
              ) : (
                // An empty value clears the restriction on save.
                <input type="hidden" name="advanceCount" value="" />
              )}
            </div>

            {/* Winner method */}
            <div className="grid gap-2">
              <Label htmlFor="rg-scoringMethod">Winner method</Label>
              <select
                className={nativeSelectClassName}
                id="rg-scoringMethod"
                name="scoringMethod"
                defaultValue={group?.scoringMethod ?? "points"}
              >
                <option value="points">Points — highest total wins</option>
                <option value="rank_order">
                  Rank order — judges&rsquo; ranks summed, lowest wins
                </option>
              </select>
              <p className="text-xs text-muted-foreground">
                Rank order is the classic pageant final: each judge&rsquo;s
                scores become ranks, and the candidate with the lowest combined
                rank wins.
              </p>
            </div>

            <DialogFooter showCloseButton>
              <Button type="submit" disabled={isPending || !!weightError}>
                {isPending
                  ? isEdit ? "Saving…" : "Adding…"
                  : isEdit ? "Save changes" : "Add round group"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Round (set) form dialog ──────────────────────────────────────────────────

function RoundFormDialog({
  eventId,
  roundGroups,
  totalRounds,
  round,
  defaultGroupId,
  trigger,
}: {
  eventId: string;
  roundGroups: RoundGroupRow[];
  totalRounds: number;
  round?: RoundRow;
  defaultGroupId?: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isEdit = !!round;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await saveRoundAction(eventId, formData);
        toast.success(isEdit ? "Set updated." : "Set added.");
        setOpen(false);
      } catch {
        toast.error(isEdit ? "Failed to update set." : "Failed to add set.");
      }
    });
  }

  return (
    <>
      <span onClick={() => setOpen(true)} style={{ display: "contents" }}>
        {trigger}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit set" : "Add set"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="grid gap-4" key={round?.id ?? "new"}>
            {isEdit && (
              <input type="hidden" name="roundId" value={round.id} />
            )}
            <div className="grid gap-2">
              <Label htmlFor="rs-group">Round group</Label>
              <select
                className={nativeSelectClassName}
                id="rs-group"
                name="roundGroupId"
                defaultValue={round?.roundGroupId ?? defaultGroupId ?? ""}
              >
                <option value="">— No group (standalone) —</option>
                {roundGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rs-name">Set name</Label>
              <Input
                id="rs-name"
                name="name"
                required
                placeholder="e.g. Long Gown"
                defaultValue={round?.name ?? ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rs-description">Description</Label>
              <Textarea
                id="rs-description"
                name="description"
                defaultValue={round?.description ?? ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rs-position">Position</Label>
              <Input
                id="rs-position"
                name="position"
                type="number"
                min={0}
                defaultValue={round?.position ?? totalRounds}
              />
            </div>
            <div className="rounded-lg border border-border p-3">
              <label className="flex cursor-pointer select-none items-start gap-2.5">
                <input
                  type="checkbox"
                  name="isManualEntry"
                  defaultChecked={round?.isManualEntry ?? false}
                  className="mt-0.5 size-4 rounded border-border"
                />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">Manual entry</span>
                  <span className="text-xs text-muted-foreground">
                    For categories scored before the event (e.g. Talent,
                    Photogenic). Judges don&rsquo;t score this — the tabulator
                    types each candidate&rsquo;s final score. Add its criteria
                    in the Criteria step, and set carry-over on the round group
                    if it should count toward the overall.
                  </span>
                </span>
              </label>
            </div>
            <DialogFooter showCloseButton>
              <Button type="submit" disabled={isPending}>
                {isPending
                  ? isEdit ? "Saving…" : "Adding…"
                  : isEdit ? "Save changes" : "Add set"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Action buttons ────────────────────────────────────────────────────────────

function ToggleLockButton({
  eventId,
  round,
}: {
  eventId: string;
  round: RoundRow;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          try {
            await toggleRoundLockAction(eventId, round.id, !round.isLocked);
            toast.success(
              round.isLocked
                ? `"${round.name}" unlocked.`
                : `"${round.name}" locked.`,
            );
          } catch {
            toast.error("Failed to update lock status.");
          }
        });
      }}
    >
      {round.isLocked ? (
        <>
          <Unlock className="size-3.5" />
          {isPending ? "Unlocking…" : "Unlock"}
        </>
      ) : (
        <>
          <Lock className="size-3.5" />
          {isPending ? "Locking…" : "Lock"}
        </>
      )}
    </Button>
  );
}

function DeleteRoundGroupButton({
  eventId,
  groupId,
  groupName,
  hasScores = false,
}: {
  eventId: string;
  groupId: string;
  groupName: string;
  hasScores?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  if (hasScores) {
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled
        title="This round has recorded scores — deletion is locked to protect the score history."
      >
        <Lock className="size-3.5" />
        Delete
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-destructive hover:text-destructive"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          try {
            await deleteRoundGroupAction(eventId, groupId);
            toast.success(`"${groupName}" deleted.`);
          } catch (error) {
            toast.error(
              error instanceof Error && error.message
                ? error.message
                : "Failed to delete round group.",
            );
          }
        });
      }}
    >
      {isPending ? "Deleting…" : "Delete"}
    </Button>
  );
}

function DeleteRoundButton({
  eventId,
  roundId,
  roundName,
  hasScores = false,
}: {
  eventId: string;
  roundId: string;
  roundName: string;
  hasScores?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  if (hasScores) {
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled
        title="This set has recorded scores — deletion is locked to protect the score history."
      >
        <Lock className="size-3.5" />
        Delete
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-destructive hover:text-destructive"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          try {
            await deleteRoundAction(eventId, roundId);
            toast.success(`"${roundName}" deleted.`);
          } catch (error) {
            toast.error(
              error instanceof Error && error.message
                ? error.message
                : "Failed to delete set.",
            );
          }
        });
      }}
    >
      {isPending ? "Deleting…" : "Delete"}
    </Button>
  );
}
