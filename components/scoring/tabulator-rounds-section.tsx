"use client";

import { CheckCircle2, Power } from "lucide-react";
import { FinishRoundDialog } from "@/components/scoring/finish-round-dialog";
import { useTabulatorLiveSnapshot } from "@/components/scoring/tabulator-live-context";
import {
  setRoundStatusAction,
  setSetStatusAction,
} from "@/app/(dashboard)/tabulator/actions";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { GroupSummary, SetSummary } from "@/lib/scoring/tabulator-service";

const LIFECYCLE_BTN =
  "inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50";

function mergeSetProgress(set: SetSummary, live: ReturnType<typeof useTabulatorLiveSnapshot>) {
  const progress = live?.setProgress.find((item) => item.id === set.id);
  if (!progress) return set;
  return {
    ...set,
    submitted: progress.submitted,
    expected: progress.expected,
    completionPct: progress.completionPct,
  };
}

function StatusBadge({ status }: { status: "idle" | "active" | "finished" }) {
  if (status === "active") return <Badge variant="success">Active</Badge>;
  if (status === "finished") return <Badge variant="default">Finished</Badge>;
  return <Badge variant="secondary">Inactive</Badge>;
}

function StatusForm({
  action,
  idName,
  id,
  target,
  children,
  disabled,
  title,
}: {
  action: (formData: FormData) => void | Promise<void>;
  idName: "groupId" | "setId";
  id: string;
  target: "active" | "idle" | "finished";
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name={idName} value={id} />
      <input type="hidden" name="status" value={target} />
      <button type="submit" className={LIFECYCLE_BTN} disabled={disabled} title={title}>
        {children}
      </button>
    </form>
  );
}

function LifecycleControls({
  action,
  idName,
  id,
  status,
  label,
  canActivate,
  finishSlot,
}: {
  action: (formData: FormData) => void | Promise<void>;
  idName: "groupId" | "setId";
  id: string;
  status: "idle" | "active" | "finished";
  label: string;
  canActivate: boolean;
  finishSlot?: React.ReactNode;
}) {
  if (status === "active") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <StatusForm action={action} idName={idName} id={id} target="idle">
          <Power className="size-4" />
          Deactivate {label}
        </StatusForm>
        {finishSlot ?? (
          <StatusForm action={action} idName={idName} id={id} target="finished">
            <CheckCircle2 className="size-4" />
            Finish {label}
          </StatusForm>
        )}
      </div>
    );
  }

  return (
    <StatusForm
      action={action}
      idName={idName}
      id={id}
      target="active"
      disabled={!canActivate}
      title={canActivate ? undefined : `Deactivate or finish the active ${label} first`}
    >
      <Power className="size-4" />
      {status === "finished" ? `Reactivate ${label}` : `Activate ${label}`}
    </StatusForm>
  );
}

function SetRow({
  set,
  canAdjust,
  canActivate,
  live,
}: {
  set: SetSummary;
  canAdjust: boolean;
  canActivate: boolean;
  live: ReturnType<typeof useTabulatorLiveSnapshot>;
}) {
  const merged = mergeSetProgress(set, live);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border px-3 py-2">
      <span className="font-medium">{merged.name}</span>
      {merged.isManualEntry && (
        <Badge className="bg-primary/10 text-primary">Manual entry</Badge>
      )}
      <StatusBadge status={merged.status} />
      {merged.carryOver && merged.status === "finished" && (
        <Badge variant="secondary">Carries forward</Badge>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Progress className="h-1.5 w-24" value={merged.completionPct} />
        <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {merged.submitted}/{merged.expected} · {merged.completionPct}%
        </span>
      </div>

      {canAdjust && (
        <LifecycleControls
          action={setSetStatusAction}
          idName="setId"
          id={merged.id}
          status={merged.status}
          label="set"
          canActivate={canActivate}
        />
      )}
    </div>
  );
}

export function TabulatorRoundsSection({
  groups,
  ungroupedSets,
  canAdjust,
  anyRoundActive,
  anySetActive,
  activeGroupId,
}: {
  groups: GroupSummary[];
  ungroupedSets: SetSummary[];
  canAdjust: boolean;
  anyRoundActive: boolean;
  anySetActive: boolean;
  activeGroupId: string | null;
}) {
  const live = useTabulatorLiveSnapshot();

  if (groups.length === 0 && ungroupedSets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No rounds or sets configured for this event yet.
      </p>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <div key={group.id} className="rounded-lg border border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 p-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">{group.name}</span>
              <StatusBadge status={group.status} />
              {group.sets.some((s) => s.carryOver) && (
                <Badge variant="secondary">Carry-over</Badge>
              )}
            </div>
            {canAdjust && (
              <LifecycleControls
                action={setRoundStatusAction}
                idName="groupId"
                id={group.id}
                status={group.status}
                label="round"
                canActivate={!anyRoundActive}
                finishSlot={
                  group.status === "active" ? (
                    <FinishRoundDialog
                      groupId={group.id}
                      groupName={group.name}
                      sets={group.sets.map((s) => ({ id: s.id, name: s.name }))}
                      carryOverScores={group.carryOver}
                      trigger={
                        <button
                          type="button"
                          className={LIFECYCLE_BTN}
                        >
                          <CheckCircle2 className="size-4" />
                          Finish round
                        </button>
                      }
                    />
                  ) : undefined
                }
              />
            )}
          </div>
          <div className="grid gap-2 p-3">
            {group.sets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sets in this round.</p>
            ) : (
              group.sets.map((setItem) => (
                <SetRow
                  key={setItem.id}
                  set={setItem}
                  canAdjust={canAdjust}
                  canActivate={
                    !anySetActive &&
                    (activeGroupId === null || activeGroupId === setItem.groupId)
                  }
                  live={live}
                />
              ))
            )}
          </div>
        </div>
      ))}

      {ungroupedSets.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm font-medium text-muted-foreground">Ungrouped sets</p>
          {ungroupedSets.map((setItem) => (
            <SetRow
              key={setItem.id}
              set={setItem}
              canAdjust={canAdjust}
              canActivate={!anySetActive && !anyRoundActive}
              live={live}
            />
          ))}
        </div>
      )}
    </>
  );
}
