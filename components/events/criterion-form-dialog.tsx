"use client";

import { useTransition, useState } from "react";
import { toast } from "sonner";
import { saveCriterionAction } from "@/app/(dashboard)/events/[eventId]/builder/actions";
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
import type { CriterionRow } from "./criteria-accordion";

type RoundGroup = { id: string; name: string };
type Round = { id: string; name: string; roundGroupId: string | null };

export function CriterionFormDialog({
  eventId,
  roundGroups,
  rounds,
  totalCriteria,
  criterion,
  defaultRoundId,
  trigger,
}: {
  eventId: string;
  roundGroups: RoundGroup[];
  rounds: Round[];
  totalCriteria: number;
  /** When provided the dialog opens in edit mode */
  criterion?: CriterionRow & { roundId?: string | null };
  /** Pre-select this round when opening in add mode */
  defaultRoundId?: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const isEdit = !!criterion;

  // Group rounds by their round group for the select
  const roundsByGroup = new Map<string | null, Round[]>();
  for (const round of rounds) {
    const key = round.roundGroupId ?? null;
    const bucket = roundsByGroup.get(key) ?? [];
    bucket.push(round);
    roundsByGroup.set(key, bucket);
  }
  const ungroupedRounds = roundsByGroup.get(null) ?? [];

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await saveCriterionAction(eventId, formData);
        toast.success(isEdit ? "Criterion updated." : "Criterion added.");
        setOpen(false);
      } catch {
        toast.error(isEdit ? "Failed to update criterion." : "Failed to add criterion.");
      }
    });
  }

  return (
    <>
      {/* Trigger — rendered by caller */}
      <span onClick={() => setOpen(true)} style={{ display: "contents" }}>
        {trigger}
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? `Edit criterion` : "Add criterion"}
            </DialogTitle>
          </DialogHeader>

          <form
            onSubmit={handleSubmit}
            className="grid gap-4 sm:grid-cols-2"
            // key resets defaultValues when dialog reopens with different criterion
            key={criterion?.id ?? "new"}
          >
            {/* Hidden fields */}
            {isEdit && (
              <input type="hidden" name="criterionId" value={criterion.id} />
            )}

            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="cd-name">Name</Label>
              <Input
                id="cd-name"
                name="name"
                required
                defaultValue={criterion?.name ?? ""}
              />
            </div>

            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="cd-description">Description</Label>
              <Textarea
                id="cd-description"
                name="description"
                defaultValue={criterion?.description ?? ""}
              />
            </div>

            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="cd-roundId">Set / round</Label>
              <select
                className={nativeSelectClassName}
                id="cd-roundId"
                name="roundId"
                defaultValue={criterion?.roundId ?? defaultRoundId ?? ""}
              >
                <option value="">— No round (event-wide) —</option>

                {roundGroups.map((group) => {
                  const groupRounds = roundsByGroup.get(group.id) ?? [];
                  return (
                    <optgroup key={group.id} label={group.name}>
                      {groupRounds.map((round) => (
                        <option key={round.id} value={round.id}>
                          {round.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}

                {ungroupedRounds.length > 0 && (
                  <optgroup label="Ungrouped sets">
                    {ungroupedRounds.map((round) => (
                      <option key={round.id} value={round.id}>
                        {round.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cd-inputType">Input type</Label>
              <select
                className={nativeSelectClassName}
                id="cd-inputType"
                name="inputType"
                defaultValue={criterion?.inputType ?? "decimal"}
              >
                <option value="decimal">Decimal</option>
                <option value="numeric">Numeric</option>
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cd-weight">Weight (%)</Label>
              <Input
                id="cd-weight"
                name="weight"
                type="number"
                min={0}
                max={100}
                step="1"
                defaultValue={criterion?.weight ?? 100}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cd-minValue">Min value</Label>
              <Input
                id="cd-minValue"
                name="minValue"
                type="number"
                step="any"
                defaultValue={criterion?.minValue ?? ""}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cd-maxValue">Max value</Label>
              <Input
                id="cd-maxValue"
                name="maxValue"
                type="number"
                step="any"
                defaultValue={criterion?.maxValue ?? ""}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cd-stepValue">Step</Label>
              <Input
                id="cd-stepValue"
                name="stepValue"
                type="number"
                step="any"
                defaultValue={criterion?.stepValue ?? "0.5"}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cd-position">Position</Label>
              <Input
                id="cd-position"
                name="position"
                type="number"
                min={0}
                defaultValue={criterion?.position ?? totalCriteria}
              />
            </div>

            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                className="size-4 rounded border border-input"
                id="cd-isRequired"
                name="isRequired"
                type="checkbox"
                defaultChecked={criterion?.isRequired ?? true}
              />
              <Label htmlFor="cd-isRequired">Required</Label>
            </div>

            <DialogFooter className="sm:col-span-2" showCloseButton>
              <Button type="submit" disabled={isPending}>
                {isPending
                  ? isEdit
                    ? "Saving…"
                    : "Adding…"
                  : isEdit
                    ? "Save changes"
                    : "Add criterion"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
