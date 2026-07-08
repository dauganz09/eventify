"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  Delete,
  Grid3x3,
  Loader2,
  Lock,
  LockOpen,
  LogOut,
  SlidersHorizontal,
  ListIcon,
} from "lucide-react";
import { toast } from "sonner";
import { EventLogo } from "@/components/events/event-logo";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { SyncStatusBadge } from "@/components/scoring/sync-status-badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { useOfflineOutbox } from "@/hooks/use-offline-outbox";
import { randomUUID } from "@/lib/utils";
import type { ScoreOperationInput } from "@/lib/validation/domain";

type ScoreInputMode = "slider" | "dropdown" | "keypad";
const INPUT_MODE_KEY = "tabulate-pro-score-input-mode";

// Temporarily disabled. Flip to `true` to re-enable the fast-entry keypad mode
// (hides the header toggle and ignores any saved "keypad" preference while off).
const KEYPAD_ENABLED = false;

// ── Types ──────────────────────────────────────────────────────────────────────

export type WorkspaceContestant = {
  id: string;
  displayNumber: string | null;
  displayName: string;
  category: string | null;
  photoUrl: string | null;
};

export type WorkspaceCriterion = {
  id: string;
  name: string;
  description: string | null;
  inputType: string;
  minValue: string | null;
  maxValue: string | null;
  stepValue: string | null;
  weight: string;
};

export type WorkspaceRound = {
  id: string;
  name: string;
};

export type ExistingScore = {
  contestantId: string;
  criterionId: string;
  value: string | null;
  status: string;
};

type Props = {
  judgeId: string;
  judgeName: string;
  eventId: string;
  eventName: string;
  eventLogoUrl: string | null;
  round: WorkspaceRound;
  contestants: WorkspaceContestant[];
  criteria: WorkspaceCriterion[];
  existingScores: ExistingScore[];
  /** Whether this judge has finalized ("submit & lock") the current set. */
  finalized: boolean;
  /** Pending unlock request status for the current set, if any. */
  unlockRequestStatus: "pending" | "approved" | "rejected" | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────────

function getDeviceId() {
  if (typeof window === "undefined") return "server-render";
  const storageKey = "tabulate-pro-device-id";
  const existing = window.localStorage.getItem(storageKey);
  if (existing) return existing;
  const deviceId = randomUUID();
  window.localStorage.setItem(storageKey, deviceId);
  return deviceId;
}

function criterionRange(criterion: WorkspaceCriterion) {
  // Coerce defensively: a null/blank/non-numeric bound must never yield NaN,
  // which would break the slider's thumb position and score display.
  const toNum = (raw: string | null, fallback: number) => {
    const n = Number(raw);
    return raw != null && Number.isFinite(n) ? n : fallback;
  };
  const min = toNum(criterion.minValue, 0);
  const max = toNum(criterion.maxValue, 10);
  const step = toNum(criterion.stepValue, 1);
  return { min, max, step };
}

function formatScoreTotal(value: number) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function criterionScoreTotals(
  criteria: WorkspaceCriterion[],
  values: Record<string, number>,
) {
  let current = 0;
  let max = 0;
  for (const criterion of criteria) {
    const { min, max: criterionMax } = criterionRange(criterion);
    current += values[criterion.id] ?? min;
    max += criterionMax;
  }
  return { current, max };
}

// Discrete values between min and max for the dropdown input mode.
// Capped so an absurd range/step can't produce thousands of options.
function buildOptions(min: number, max: number, step: number) {
  const safeStep = step > 0 ? step : 1;
  const rawCount = Math.floor((max - min) / safeStep);
  const useStep = rawCount > 200 ? (max - min) / 200 : safeStep;
  const options: number[] = [];
  for (let v = min; v <= max + 1e-9; v += useStep) {
    options.push(Math.round(v * 1000) / 1000);
  }
  if (options[options.length - 1] !== max) options.push(max);
  return options;
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

// ── Main component ─────────────────────────────────────────────────────────────

export function JudgeWorkspace({
  judgeId,
  judgeName,
  eventId,
  eventName,
  eventLogoUrl,
  round,
  contestants,
  criteria,
  existingScores,
  finalized,
  unlockRequestStatus: initialUnlockRequestStatus,
}: Props) {
  const router = useRouter();
  const outbox = useOfflineOutbox();
  const [deviceId] = useState(getDeviceId);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [inputMode, setInputMode] = useState<ScoreInputMode>("slider");
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [unlockRequestStatus, setUnlockRequestStatus] = useState(initialUnlockRequestStatus);
  const [requestingUnlock, setRequestingUnlock] = useState(false);
  // Reveal the compact mobile/tablet action bar only once the full header has
  // scrolled out of view, so the top isn't cluttered while the header is visible.
  const [showStickyBar, setShowStickyBar] = useState(false);
  const headerSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = headerSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyBar(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Debounced network sync for inline (direct) scoring. The score is already
  // durable in the outbox the moment it's entered, so we only coalesce the
  // round-trips — rapid slider edits don't each hit the network.
  const syncTimerRef = useRef<number | null>(null);
  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current != null) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      void outbox.syncPending();
    }, 600);
  }, [outbox]);

  // Pull fresh server data whenever a background sync pass completes cleanly.
  // Scores entered while the dev server was down queue in the outbox and only
  // reach the DB once it's back; the remount that a realtime reconnect triggers
  // wipes the optimistic "scored" state, so without this the cards sit at "not
  // scored" until a manual reload. `lastSyncedAt` advances only on a fully
  // successful drain, so refreshing on it re-fetches the committed scores and
  // flips the cards to scored automatically. Seeded from the current value so a
  // sync already reflected in the initial props doesn't force a redundant fetch.
  const lastRefreshedSyncRef = useRef(outbox.lastSyncedAt);
  useEffect(() => {
    if (!outbox.lastSyncedAt) return;
    if (outbox.lastSyncedAt === lastRefreshedSyncRef.current) return;
    lastRefreshedSyncRef.current = outbox.lastSyncedAt;
    router.refresh();
  }, [outbox.lastSyncedAt, router]);

  // Sync unlock request status whenever the server re-renders with fresh data
  // (e.g. tabulator approves/rejects, or the judge re-locks after an unlock).
  // setState in an effect is intentional here: we're syncing derived UI state
  // with a server-provided prop after router.refresh() streams new RSC data.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUnlockRequestStatus(initialUnlockRequestStatus);
  }, [initialUnlockRequestStatus]);

  async function handleRequestUnlock() {
    setRequestingUnlock(true);
    try {
      const res = await fetch("/api/judge/request-unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: round.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to send request.");
      }
      setUnlockRequestStatus("pending");
      toast.success("Unlock request sent to the tabulator.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send request.");
    } finally {
      setRequestingUnlock(false);
    }
  }

  async function handleFinalize() {
    setFinalizing(true);
    try {
      const res = await fetch("/api/judge/finalize-set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: round.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to submit.");
      }
      toast.success("Set submitted and locked.");
      setConfirmFinalize(false);
      setUnlockRequestStatus(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit.");
    } finally {
      setFinalizing(false);
    }
  }

  // Restore the judge's preferred score input style from localStorage.
  // Read on mount (not in a lazy initializer) to avoid SSR hydration mismatch.
  useEffect(() => {
    const stored = window.localStorage.getItem(INPUT_MODE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "slider" || stored === "dropdown" || (KEYPAD_ENABLED && stored === "keypad")) setInputMode(stored);
  }, []);

  function changeInputMode(mode: ScoreInputMode) {
    setInputMode(mode);
    window.localStorage.setItem(INPUT_MODE_KEY, mode);
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/judge-logout", { method: "POST" });
      router.push("/judge/login");
      router.refresh();
    } catch {
      toast.error("Failed to sign out.");
      setSigningOut(false);
    }
  }

  // Only the contestants actually shown to this judge count toward progress.
  // Advancement rounds (e.g. a top-5 Q&A) show a filtered subset, but the
  // server sends every score for the round — counting the extras would push
  // "done" past the total (e.g. 6/5 = 120%).
  const visibleContestantIds = useMemo(
    () => new Set(contestants.map((c) => c.id)),
    [contestants],
  );

  // Track which contestants are fully scored (seeded from server, updated locally)
  const initialDone = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const s of existingScores) {
      if (s.value == null) continue;
      if (!visibleContestantIds.has(s.contestantId)) continue;
      const set = map.get(s.contestantId) ?? new Set<string>();
      set.add(s.criterionId);
      map.set(s.contestantId, set);
    }
    const done = new Set<string>();
    if (criteria.length > 0) {
      for (const [contestantId, set] of map) {
        if (set.size >= criteria.length) done.add(contestantId);
      }
    }
    return done;
  }, [existingScores, criteria.length, visibleContestantIds]);

  const [doneIds, setDoneIds] = useState<Set<string>>(initialDone);

  // Mirror server scores into local state so re-opening a scored card shows the
  // submitted values rather than resetting to defaults.
  const [localScores, setLocalScores] = useState<ExistingScore[]>(existingScores);

  // Reconcile with fresh server data on every RSC refresh (e.g. realtime
  // reconnect after the server restarts). This is add-only: a router.refresh()
  // can land with server data captured *before* the outbox finished committing
  // queued scores, so we must never downgrade a locally-known score back to
  // "not scored". We union new server-confirmed done contestants into doneIds
  // and merge server values into localScores without dropping optimistic ones.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDoneIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of initialDone) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setLocalScores((prev) => {
      if (existingScores.length === 0) return prev;
      const merged = [...prev];
      let changed = false;
      for (const s of existingScores) {
        const idx = merged.findIndex(
          (p) => p.contestantId === s.contestantId && p.criterionId === s.criterionId,
        );
        if (idx < 0) {
          merged.push(s);
          changed = true;
        } else if (merged[idx].value == null && s.value != null) {
          // Fill in a value we don't have locally, but keep any optimistic
          // value already present (server may still be catching up).
          merged[idx] = s;
          changed = true;
        }
      }
      return changed ? merged : prev;
    });
  }, [initialDone, existingScores]);

  const activeContestant = contestants.find((c) => c.id === activeId) ?? null;

  function existingValuesFor(contestantId: string) {
    const values: Record<string, number> = {};
    for (const criterion of criteria) {
      const found = localScores.find(
        (s) => s.contestantId === contestantId && s.criterionId === criterion.id,
      );
      const { min } = criterionRange(criterion);
      values[criterion.id] =
        found?.value != null ? Number(found.value) : min;
    }
    return values;
  }

  async function handleSubmit(
    contestantId: string,
    values: Record<string, number>,
  ) {
    const clientCreatedAt = new Date().toISOString();
    try {
      for (const criterion of criteria) {
        const payload: ScoreOperationInput = {
          eventId,
          roundId: round.id,
          contestantId,
          criterionId: criterion.id,
          judgeId,
          deviceId,
          idempotencyKey: randomUUID(),
          value: values[criterion.id] ?? 0,
          comment: "",
          clientCreatedAt,
          operation: "submitted",
        };
        await outbox.enqueue(payload, { sync: false });
      }
      await outbox.syncPending();
      // Persist submitted values locally so re-opening the card shows them.
      setLocalScores((prev) => {
        const updated = [...prev];
        for (const criterion of criteria) {
          const idx = updated.findIndex(
            (s) => s.contestantId === contestantId && s.criterionId === criterion.id,
          );
          const next: ExistingScore = {
            contestantId,
            criterionId: criterion.id,
            value: String(values[criterion.id] ?? 0),
            status: "submitted",
          };
          if (idx >= 0) updated[idx] = next;
          else updated.push(next);
        }
        return updated;
      });
      setDoneIds((prev) => new Set(prev).add(contestantId));
      setActiveId(null);
      toast.success("Scores submitted.");
    } catch {
      toast.error("Failed to submit scores.");
    }
  }

  // "Direct scoring": a set with a single criterion is just one score per
  // contestant, so we skip the card → dialog flow and let judges enter every
  // score inline from one flat list. Sets with 2+ criteria keep the card flow.
  const isDirectScoring = criteria.length === 1;
  const directCriterion = criteria[0];

  async function handleInlineScore(contestantId: string, value: number) {
    if (!directCriterion) return;
    const clientCreatedAt = new Date().toISOString();
    try {
      const payload: ScoreOperationInput = {
        eventId,
        roundId: round.id,
        contestantId,
        criterionId: directCriterion.id,
        judgeId,
        deviceId,
        idempotencyKey: randomUUID(),
        value,
        comment: "",
        clientCreatedAt,
        operation: "submitted",
      };
      // Enqueue durably right away (so the value is captured and counted in
      // pendingCount, which gates Submit & lock), but debounce the network sync
      // so rapid slider edits don't each trigger a round-trip.
      await outbox.enqueue(payload, { sync: false });
      scheduleSync();
      setLocalScores((prev) => {
        const updated = [...prev];
        const idx = updated.findIndex(
          (s) => s.contestantId === contestantId && s.criterionId === directCriterion.id,
        );
        const next: ExistingScore = {
          contestantId,
          criterionId: directCriterion.id,
          value: String(value),
          status: "submitted",
        };
        if (idx >= 0) updated[idx] = next;
        else updated.push(next);
        return updated;
      });
      setDoneIds((prev) => new Set(prev).add(contestantId));
    } catch {
      toast.error("Failed to save score.");
    }
  }

  const completedCount = doneIds.size;
  const allScored = contestants.length > 0 && completedCount >= contestants.length;

  return (
    <div className="space-y-8">
      {/* Compact access bar (tablet/mobile only): keeps the set name and the
          primary action reachable while the judge scrolls a long list. Fixed so
          it doesn't shift the layout, and slid into view only once the header
          has scrolled away. Hidden on lg+ where the full header stays in view. */}
      <div
        className={`fixed inset-x-0 top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-2.5 shadow-sm backdrop-blur transition-transform duration-200 lg:hidden ${
          showStickyBar ? "translate-y-0" : "-translate-y-full"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
          <span className="truncate text-sm font-bold tracking-tight">
            {round.name}
          </span>
        </div>
        <div className="ml-auto shrink-0">
          {finalized ? (
            unlockRequestStatus === "pending" ? (
              <span className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-100 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
                <Loader2 className="size-3.5 animate-spin" />
                Unlock requested
              </span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleRequestUnlock}
                disabled={requestingUnlock}
              >
                {requestingUnlock ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <LockOpen className="size-4" />
                )}
                Request unlock
              </Button>
            )
          ) : (
            contestants.length > 0 && (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => setConfirmFinalize(true)}
                disabled={
                  finalizing || !allScored || outbox.pendingCount > 0 || outbox.isSyncing
                }
                title={
                  !allScored
                    ? "Score every contestant before you can lock this set"
                    : outbox.pendingCount > 0 || outbox.isSyncing
                      ? "Waiting for scores to finish syncing…"
                      : undefined
                }
              >
                <Lock className="size-4" />
                Submit &amp; lock
              </Button>
            )
          )}
        </div>
      </div>

      {/* Header */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 shadow-md">
            <span className="size-2.5 animate-pulse rounded-full bg-primary-foreground" />
            <span className="text-xl font-bold tracking-tight text-primary-foreground">
              {round.name}
            </span>
          </div>
          <span className="hidden text-sm text-muted-foreground sm:inline">
            Judging as {judgeName}
          </span>

          <div className="ml-auto flex items-center gap-2">
            {/* Score input preference — labels collapse to icons below lg */}
            <div className="flex items-center rounded-lg border p-0.5">
              <button
                type="button"
                onClick={() => changeInputMode("slider")}
                aria-pressed={inputMode === "slider"}
                title="Slider input"
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  inputMode === "slider"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <SlidersHorizontal className="size-3.5" />
                <span className="hidden lg:inline">Slider</span>
              </button>
              <button
                type="button"
                onClick={() => changeInputMode("dropdown")}
                aria-pressed={inputMode === "dropdown"}
                title="Dropdown input"
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  inputMode === "dropdown"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <ListIcon className="size-3.5" />
                <span className="hidden lg:inline">Dropdown</span>
              </button>
              {KEYPAD_ENABLED && (
                <button
                  type="button"
                  onClick={() => changeInputMode("keypad")}
                  aria-pressed={inputMode === "keypad"}
                  title="Keypad input"
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    inputMode === "keypad"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Grid3x3 className="size-3.5" />
                  <span className="hidden lg:inline">Keypad</span>
                </button>
              )}
            </div>

            <ThemeToggle size="icon-sm" />

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleSignOut}
              disabled={signingOut}
              title="Sign out"
            >
              {signingOut ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LogOut className="size-4" />
              )}
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <EventLogo src={eventLogoUrl} alt={eventName} className="size-10" />
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {eventName}
          </h1>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <SyncStatusBadge
            isOnline={outbox.isOnline}
            isSyncing={outbox.isSyncing}
            pendingCount={outbox.pendingCount}
            conflictCount={outbox.conflictCount}
            lastSyncError={outbox.lastSyncError}
          />
          <span aria-hidden>·</span>
          <span>
            {completedCount} of {contestants.length} scored
          </span>
        </div>
      </header>

      {/* Sentinel: when it scrolls out of view the compact bar slides in. */}
      <div ref={headerSentinelRef} aria-hidden className="h-px" />

      {/* Submit & lock / unlock request */}
      {finalized ? (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-500/40 dark:bg-emerald-950/40">
          <Lock className="size-5 shrink-0 text-emerald-600" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
              Scores submitted &amp; locked
            </p>
            {unlockRequestStatus === "pending" ? (
              <p className="text-sm text-emerald-700/80 dark:text-emerald-300/80">
                Unlock request sent — waiting for the tabulator to approve.
              </p>
            ) : unlockRequestStatus === "rejected" ? (
              <p className="text-sm text-red-600 dark:text-red-400">
                Unlock request was declined. Contact the tabulator directly.
              </p>
            ) : (
              <p className="text-sm text-emerald-700/80 dark:text-emerald-300/80">
                Tap any card to review your scores, or request an unlock to make changes.
              </p>
            )}
          </div>
          {unlockRequestStatus === "pending" ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
              <Loader2 className="size-3.5 animate-spin" />
              Unlock requested
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-emerald-400 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-600 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
              onClick={handleRequestUnlock}
              disabled={requestingUnlock}
            >
              {requestingUnlock ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LockOpen className="size-4" />
              )}
              Request unlock
            </Button>
          )}
        </div>
      ) : (
        contestants.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {!allScored
                ? `Score all ${contestants.length} contestants to submit & lock (${completedCount}/${contestants.length} done).`
                : outbox.pendingCount > 0 || outbox.isSyncing
                  ? "Waiting for scores to finish syncing before you can lock…"
                  : "Finished scoring? Submit & lock your scores so they can't be changed."}
            </p>
            <Button
              className="gap-1.5"
              onClick={() => setConfirmFinalize(true)}
              disabled={finalizing || !allScored || outbox.pendingCount > 0 || outbox.isSyncing}
              title={
                !allScored
                  ? "Score every contestant before you can lock this set"
                  : outbox.pendingCount > 0 || outbox.isSyncing
                    ? "Waiting for scores to finish syncing…"
                    : undefined
              }
            >
              <Lock className="size-4" />
              Submit &amp; lock
            </Button>
          </div>
        )
      )}

      {/* Contestant cards — or a flat inline list for direct (single-criterion) scoring */}
      {contestants.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
          No contestants assigned to this round.
        </div>
      ) : isDirectScoring && directCriterion ? (
        <DirectScoreList
          contestants={contestants}
          criterion={directCriterion}
          inputMode={inputMode}
          localScores={localScores}
          readonly={finalized}
          onScore={handleInlineScore}
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {contestants.map((contestant) => (
            <ContestantCard
              key={contestant.id}
              contestant={contestant}
              isDone={doneIds.has(contestant.id)}
              locked={finalized}
              onClick={() => setActiveId(contestant.id)}
            />
          ))}
        </div>
      )}

      {/* Scoring dialog */}
      <Dialog
        open={activeContestant != null}
        onOpenChange={(open) => {
          if (!open) setActiveId(null);
        }}
      >
        {activeContestant && (
          <ScoringDialog
            key={activeContestant.id}
            contestant={activeContestant}
            criteria={criteria}
            inputMode={inputMode}
            initialValues={existingValuesFor(activeContestant.id)}
            readonly={finalized}
            unlockRequestStatus={unlockRequestStatus}
            onRequestUnlock={handleRequestUnlock}
            onCancel={() => setActiveId(null)}
            onSubmit={(values) => handleSubmit(activeContestant.id, values)}
          />
        )}
      </Dialog>

      {/* Sticky progress bar — hidden when finalized or no contestants */}
      {contestants.length > 0 && !finalized && (
        <div className="sticky bottom-0 z-20 border-t bg-background/95 px-4 py-3 backdrop-blur">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
            <span className={`font-medium ${allScored ? "text-green-600 dark:text-green-400" : ""}`}>
              {allScored
                ? "All contestants scored — ready to submit"
                : `${completedCount} of ${contestants.length} scored`}
            </span>
            <div className="flex items-center gap-2">
              <SyncStatusBadge
                isOnline={outbox.isOnline}
                isSyncing={outbox.isSyncing}
                pendingCount={outbox.pendingCount}
                conflictCount={outbox.conflictCount}
                lastSyncError={outbox.lastSyncError}
              />
              <span className="tabular-nums text-muted-foreground">
                {Math.round((completedCount / contestants.length) * 100)}%
              </span>
            </div>
          </div>
          <Progress
            value={Math.round((completedCount / contestants.length) * 100)}
            className={allScored ? "[&>div]:bg-green-500" : ""}
          />
        </div>
      )}

      {/* Submit & lock confirmation */}
      <Dialog open={confirmFinalize} onOpenChange={setConfirmFinalize}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit &amp; lock {round.name}?</DialogTitle>
            <DialogDescription>
              You&apos;ve scored {completedCount} of {contestants.length} contestants.
              Once locked, you can&apos;t change these scores — only the tabulator
              can reopen them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={
                <Button variant="outline" disabled={finalizing}>
                  Keep scoring
                </Button>
              }
            />
            <Button onClick={handleFinalize} disabled={finalizing} className="gap-1.5">
              {finalizing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Lock className="size-4" />
              )}
              Submit &amp; lock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Contestant card ──────────────────────────────────────────────────────────────

function ContestantCard({
  contestant,
  isDone,
  locked,
  onClick,
}: {
  contestant: WorkspaceContestant;
  isDone: boolean;
  locked: boolean;
  onClick: () => void;
}) {
  const parts = contestant.displayName.trim().split(/\s+/);
  const firstName = parts.length > 1 ? parts[0] : "";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : contestant.displayName;

  return (
    <button
      onClick={onClick}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border-2 bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
        locked ? "opacity-80" : ""
      } ${
        isDone
          ? "border-green-500 ring-1 ring-green-500/30"
          : "border-transparent hover:border-primary/40"
      }`}
    >
      {/* Full-bleed poster: photo, giant number watermark, name overlay */}
      <div
        className="relative aspect-[3/4] w-full overflow-hidden bg-gradient-to-b from-slate-700 to-slate-900"
        style={{ containerType: "inline-size" }}
      >
        {contestant.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={contestant.photoUrl}
            alt={contestant.displayName}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-5xl font-bold text-white/20">
            {initials(contestant.displayName)}
          </div>
        )}

        {/* Contestant number — bottom-right corner */}
        {contestant.displayNumber && (
          <span
            className="pointer-events-none absolute top-0 right-0 select-none font-black leading-none text-white/65 drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]"
            style={{
              fontSize: "clamp(6rem, 48cqw, 16rem)",
              WebkitTextStroke: "1px rgba(0,0,0,0.2)",
            }}
          >
            {contestant.displayNumber}
          </span>
        )}

        {/* Bottom gradient so the name is always legible */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

        {/* Name overlay */}
        <div className="absolute inset-x-0 bottom-0 p-2">
          {firstName && (
            <span className="line-clamp-1 text-lg font-bold uppercase tracking-wide text-white/70">
              {firstName}
            </span>
          )}
          <span className="line-clamp-2 text-3xl font-black leading-tight tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
            {lastName}
          </span>
        </div>

        {/* Done badge */}
        {isDone && (
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full bg-green-500 px-2 py-1 text-xs font-semibold text-white shadow-lg">
            <CheckCircle2 className="size-4" />
            Scored
          </div>
        )}

        {/* Locked overlay — tap to review scores */}
        {locked && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <Lock className="size-5 text-white" />
            <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-900">
              Tap to review
            </span>
          </div>
        )}
      </div>
    </button>
  );
}

// ── Direct scoring (single-criterion) inline list ───────────────────────────────
// Renders every contestant as a row with the score input right beside them, so
// the judge scores the whole set from one screen — no card tap, no dialog.

function DirectScoreList({
  contestants,
  criterion,
  inputMode,
  localScores,
  readonly,
  onScore,
}: {
  contestants: WorkspaceContestant[];
  criterion: WorkspaceCriterion;
  inputMode: ScoreInputMode;
  localScores: ExistingScore[];
  readonly: boolean;
  onScore: (contestantId: string, value: number) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {contestants.map((contestant) => {
        const existing = localScores.find(
          (s) => s.contestantId === contestant.id && s.criterionId === criterion.id,
        );
        const initialValue = existing?.value != null ? Number(existing.value) : null;
        return (
          <DirectScoreRow
            key={contestant.id}
            contestant={contestant}
            criterion={criterion}
            inputMode={inputMode}
            initialValue={initialValue}
            readonly={readonly}
            onCommit={(value) => onScore(contestant.id, value)}
          />
        );
      })}
    </div>
  );
}

function DirectScoreRow({
  contestant,
  criterion,
  inputMode,
  initialValue,
  readonly,
  onCommit,
}: {
  contestant: WorkspaceContestant;
  criterion: WorkspaceCriterion;
  inputMode: ScoreInputMode;
  initialValue: number | null;
  readonly: boolean;
  onCommit: (value: number) => void;
}) {
  const { min, max, step } = criterionRange(criterion);
  // null = not yet scored (so we can show a placeholder rather than a misleading
  // "min" score the judge never chose).
  const [value, setValue] = useState<number | null>(initialValue);
  // Guard against non-finite values (e.g. a stray NaN from a touch event): treat
  // them as "not scored" so we never feed NaN to the slider or the display.
  const scored = value != null && Number.isFinite(value);
  const sliderValue = scored ? (value as number) : min;

  // Commit on release/selection: `onCommit` enqueues the score durably right
  // away (the parent coalesces the network sync), so nothing is left pending in
  // a local timer that could fire after the set is locked.

  return (
    <div className="flex flex-col gap-3 border-b border-border/60 p-4 last:border-b-0 sm:flex-row sm:items-center">
      {/* Contestant identity */}
      <div className="flex min-w-0 items-center gap-3 sm:w-64 sm:shrink-0">
        <div className="size-14 shrink-0 overflow-hidden rounded-full border bg-muted">
          {contestant.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={contestant.photoUrl}
              alt={contestant.displayName}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-base font-bold text-muted-foreground">
              {initials(contestant.displayName)}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xl font-bold leading-tight">
            {contestant.displayName}
          </p>
          {contestant.displayNumber && (
            <p className="text-base font-semibold text-muted-foreground">
              #{contestant.displayNumber}
            </p>
          )}
        </div>
      </div>

      {/* Score input beside the contestant */}
      <div className="flex flex-1 items-center gap-4">
        {readonly ? (
          <div className="flex-1 text-sm text-muted-foreground">
            {scored ? "Locked" : "Not scored"}
          </div>
        ) : inputMode === "dropdown" ? (
          <Select
            value={scored ? String(value) : undefined}
            onValueChange={(next) => {
              const v = Number(next);
              if (!Number.isFinite(v)) return;
              setValue(v);
              onCommit(v);
            }}
          >
            <SelectTrigger className="h-11 flex-1">
              <SelectValue placeholder="Select a score" />
            </SelectTrigger>
            <SelectContent>
              {buildOptions(min, max, step).map((opt) => (
                <SelectItem key={opt} value={String(opt)}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex-1">
            <Slider
              min={min}
              max={max}
              step={step}
              value={sliderValue}
              onValueChange={(next) => {
                const v = Array.isArray(next) ? next[0] : next;
                if (Number.isFinite(v)) setValue(v);
              }}
              onValueCommitted={(next) => {
                const v = Array.isArray(next) ? next[0] : next;
                if (!Number.isFinite(v)) return;
                setValue(v);
                onCommit(v);
              }}
            />
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>{min}</span>
              <span>{max}</span>
            </div>
          </div>
        )}

        {/* Live value + scored indicator */}
        <div className="flex w-16 shrink-0 items-center justify-end gap-1.5">
          {scored && !readonly && (
            <CheckCircle2 className="size-4 shrink-0 text-green-600" />
          )}
          <span
            className={`text-2xl font-bold tabular-nums ${
              scored ? "text-primary" : "text-muted-foreground/40"
            }`}
          >
            {scored ? value : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Scoring dialog ───────────────────────────────────────────────────────────────

function ScoringDialog({
  contestant,
  criteria,
  inputMode,
  initialValues,
  readonly = false,
  unlockRequestStatus = null,
  onRequestUnlock,
  onCancel,
  onSubmit,
}: {
  contestant: WorkspaceContestant;
  criteria: WorkspaceCriterion[];
  inputMode: ScoreInputMode;
  initialValues: Record<string, number>;
  readonly?: boolean;
  unlockRequestStatus?: "pending" | "approved" | "rejected" | null;
  onRequestUnlock?: () => void;
  onCancel: () => void;
  onSubmit: (values: Record<string, number>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, number>>(initialValues);
  const [phase, setPhase] = useState<"score" | "confirm">("score");
  const [submitting, setSubmitting] = useState(false);
  const showCriteriaTotals = criteria.length > 1;
  const scoreTotals = useMemo(
    () => criterionScoreTotals(criteria, values),
    [criteria, values],
  );

  async function confirmSubmit() {
    setSubmitting(true);
    await onSubmit(values);
    setSubmitting(false);
  }

  return (
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
      {/* Contestant banner */}
      <div className="flex shrink-0 items-center gap-4 border-b bg-muted/40 p-5">
        <div className="size-16 shrink-0 overflow-hidden rounded-full border-2 border-card bg-muted shadow">
          {contestant.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={contestant.photoUrl}
              alt={contestant.displayName}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-lg font-bold text-muted-foreground">
              {initials(contestant.displayName)}
            </div>
          )}
        </div>
        <div className="min-w-0">
          {contestant.category && (
            <p className="text-xs font-bold uppercase tracking-wider text-orange-500">
              {contestant.category}
            </p>
          )}
          <DialogTitle className="truncate text-xl font-bold">
            {contestant.displayName}
          </DialogTitle>
          {contestant.displayNumber && (
            <p className="text-sm text-muted-foreground">
              Contestant #{contestant.displayNumber}
            </p>
          )}
          {showCriteriaTotals && (
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
              <p className="text-muted-foreground">
                Your total:{" "}
                <span className="text-base font-bold tabular-nums text-primary">
                  {formatScoreTotal(scoreTotals.current)}
                </span>
              </p>
              <p className="text-muted-foreground">
                Max:{" "}
                <span className="font-semibold tabular-nums">
                  {formatScoreTotal(scoreTotals.max)}
                </span>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Read-only locked view */}
      {readonly ? (
        <>
          {/* Lock status banner */}
          {unlockRequestStatus === "pending" ? (
            <div className="flex shrink-0 items-center gap-2 border-b bg-amber-50 px-5 py-2.5 text-sm font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <Loader2 className="size-4 shrink-0 animate-spin" />
              Unlock requested — waiting for tabulator approval.
            </div>
          ) : unlockRequestStatus === "rejected" ? (
            <div className="flex shrink-0 items-center gap-2 border-b bg-red-50 px-5 py-2.5 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <Lock className="size-4 shrink-0" />
              Unlock request was declined. Contact the tabulator directly.
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-2 border-b bg-amber-50 px-5 py-2.5 text-sm font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <Lock className="size-4 shrink-0" />
              Scores are locked. Request an unlock to make changes.
            </div>
          )}

          {/* Score list */}
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-6">
            {criteria.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">
                No criteria configured for this round.
              </p>
            ) : (
              criteria.map((criterion) => (
                <div
                  key={criterion.id}
                  className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3"
                >
                  <div>
                    <p className="font-semibold">{criterion.name}</p>
                    {criterion.description && (
                      <p className="text-xs text-muted-foreground">{criterion.description}</p>
                    )}
                  </div>
                  <span className="text-2xl font-bold tabular-nums text-primary">
                    {values[criterion.id] ?? "—"}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 flex-col gap-2 border-t bg-muted/50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {unlockRequestStatus !== "pending" && onRequestUnlock && (
              <Button
                variant="outline"
                onClick={() => { onRequestUnlock(); onCancel(); }}
                className="h-12 w-full gap-1.5"
              >
                <LockOpen className="size-4" />
                Request unlock
              </Button>
            )}
            <Button variant="ghost" onClick={onCancel} className="h-12 w-full">
              Close
            </Button>
          </div>
        </>
      ) : phase === "score" ? (
        inputMode === "keypad" ? (
          <KeypadScorer
            criteria={criteria}
            values={values}
            setValues={setValues}
            onReview={() => setPhase("confirm")}
            onCancel={onCancel}
          />
        ) : (
        <>
          <div className="min-h-0 flex-1 space-y-7 overflow-y-auto p-6">
            {criteria.length === 0 && (
              <p className="text-center text-sm text-muted-foreground">
                No criteria configured for this round.
              </p>
            )}
            {criteria.map((criterion) => {
              const { min, max, step } = criterionRange(criterion);
              const value = values[criterion.id] ?? min;
              return (
                <div key={criterion.id} className="space-y-3">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold leading-tight">
                        {criterion.name}
                      </h3>
                      {criterion.description && (
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {criterion.description}
                        </p>
                      )}
                    </div>
                    <span className="text-2xl font-bold tabular-nums text-primary">
                      {value}
                    </span>
                  </div>
                  {inputMode === "dropdown" ? (
                    <Select
                      value={String(value)}
                      onValueChange={(next) =>
                        setValues((prev) => ({
                          ...prev,
                          [criterion.id]: Number(next),
                        }))
                      }
                    >
                      <SelectTrigger className="h-11 w-full text-base">
                        <SelectValue placeholder="Select a score" />
                      </SelectTrigger>
                      <SelectContent>
                        {buildOptions(min, max, step).map((opt) => (
                          <SelectItem key={opt} value={String(opt)}>
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <>
                      <Slider
                        min={min}
                        max={max}
                        step={step}
                        value={value}
                        onValueChange={(next) =>
                          setValues((prev) => ({
                            ...prev,
                            [criterion.id]: Array.isArray(next) ? next[0] : next,
                          }))
                        }
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{min}</span>
                        <span>{max}</span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex shrink-0 flex-row gap-3 border-t bg-muted/50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button
              variant="outline"
              onClick={onCancel}
              className="h-12 flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={() => setPhase("confirm")}
              disabled={criteria.length === 0}
              className="h-12 flex-1"
            >
              Submit scores
            </Button>
          </div>
        </>
        )
      ) : (
        <>
          <DialogHeader className="shrink-0 p-6 pb-2 text-left">
            <DialogTitle>Confirm submission</DialogTitle>
            <DialogDescription>
              Review the scores for {contestant.displayName} before submitting.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-2">
            {criteria.map((criterion) => (
              <div
                key={criterion.id}
                className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2.5"
              >
                <span className="font-medium">{criterion.name}</span>
                <span className="text-lg font-bold tabular-nums text-primary">
                  {values[criterion.id] ?? 0}
                </span>
              </div>
            ))}
            {showCriteriaTotals && (
              <div className="flex items-center justify-between rounded-lg border-2 border-primary/30 bg-primary/5 px-4 py-3">
                <span className="font-semibold">Total</span>
                <span className="text-lg font-bold tabular-nums text-primary">
                  {formatScoreTotal(scoreTotals.current)}
                  <span className="text-sm font-medium text-muted-foreground">
                    {" "}
                    / {formatScoreTotal(scoreTotals.max)}
                  </span>
                </span>
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-row gap-3 border-t bg-muted/50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button
              variant="outline"
              onClick={() => setPhase("score")}
              disabled={submitting}
              className="h-12 flex-1 gap-1.5"
            >
              <ChevronLeft className="size-4" />
              Back
            </Button>
            <Button
              onClick={confirmSubmit}
              disabled={submitting}
              className="h-12 flex-1 gap-1.5"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Confirm &amp; submit
            </Button>
          </div>
        </>
      )}
    </DialogContent>
  );
}

// ── Keypad (fast-entry) scorer ───────────────────────────────────────────────
// One criterion at a time with big tap targets. Small discrete ranges show a
// chip grid where tapping a score auto-advances to the next criterion; larger
// or decimal ranges show a number-pad with a typed entry and a Next button.
function KeypadScorer({
  criteria,
  values,
  setValues,
  onReview,
  onCancel,
}: {
  criteria: WorkspaceCriterion[];
  values: Record<string, number>;
  setValues: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  onReview: () => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [entry, setEntry] = useState("");
  const [picked, setPicked] = useState<number | null>(null);

  const criterion = criteria[index];

  if (!criterion) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="text-center text-sm text-muted-foreground">
          No criteria configured for this round.
        </p>
        <Button variant="outline" onClick={onCancel} className="h-12 w-full">
          Close
        </Button>
      </div>
    );
  }

  const { min, max, step } = criterionRange(criterion);
  const total = criteria.length;
  const stored = values[criterion.id] ?? min;
  const display = entry !== "" ? entry : String(stored);
  const allowDecimal = step % 1 !== 0;
  const options = buildOptions(min, max, step);
  const useChips = options.length <= 12;

  function clampToStep(raw: number) {
    if (Number.isNaN(raw)) return stored;
    let v = Math.min(max, Math.max(min, raw));
    if (step > 0) v = Math.round((v - min) / step) * step + min;
    return Math.round(v * 1000) / 1000;
  }

  function advanceWith(value: number) {
    setValues((prev) => ({ ...prev, [criterion.id]: value }));
    setEntry("");
    if (index + 1 < total) setIndex(index + 1);
    else onReview();
  }

  function handleNext() {
    advanceWith(clampToStep(entry !== "" ? Number(entry) : stored));
  }

  function handleBack() {
    setValues((prev) => ({
      ...prev,
      [criterion.id]: clampToStep(entry !== "" ? Number(entry) : stored),
    }));
    setEntry("");
    if (index > 0) setIndex(index - 1);
  }

  function pressKey(key: string) {
    if (key === "del") {
      setEntry((e) => e.slice(0, -1));
      return;
    }
    if (key === ".") {
      setEntry((e) => (e.includes(".") ? e : e === "" ? "0." : e + "."));
      return;
    }
    setEntry((e) => {
      const next = (e === "0" ? "" : e) + key;
      return next.length > 6 ? e : next;
    });
  }

  function pickChip(value: number) {
    // Brief highlight, then auto-advance to the next criterion.
    setPicked(value);
    setTimeout(() => {
      setPicked(null);
      advanceWith(value);
    }, 130);
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", allowDecimal ? "." : "", "0", "del"];

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {/* Progress */}
        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>
              Criterion {index + 1} of {total}
            </span>
            <span>
              Range {min}–{max}
            </span>
          </div>
          <Progress value={Math.round((index / total) * 100)} />
        </div>

        {/* Criterion + big live value */}
        <div className="mb-5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-xl font-bold leading-tight">{criterion.name}</h3>
            {criterion.description && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {criterion.description}
              </p>
            )}
          </div>
          <span className="shrink-0 text-5xl font-black leading-none tabular-nums text-primary">
            {display}
          </span>
        </div>

        {/* Input: chips for small ranges, number-pad otherwise */}
        {useChips ? (
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => pickChip(opt)}
                className={`h-14 rounded-xl border-2 text-xl font-bold tabular-nums transition-all active:scale-95 ${
                  picked === opt
                    ? "border-primary bg-primary text-primary-foreground"
                    : stored === opt && entry === ""
                      ? "border-primary/60 bg-primary/10"
                      : "border-border bg-card hover:bg-accent"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2.5">
            {keys.map((k, i) =>
              k === "" ? (
                <div key={i} />
              ) : (
                <button
                  key={i}
                  type="button"
                  onClick={() => pressKey(k)}
                  className="flex h-16 items-center justify-center rounded-xl border-2 border-border bg-card text-2xl font-bold transition-all hover:bg-accent active:scale-95"
                  aria-label={k === "del" ? "Delete" : k}
                >
                  {k === "del" ? <Delete className="size-6" /> : k}
                </button>
              ),
            )}
          </div>
        )}

        {useChips && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Tap a score to record it and jump to the next criterion.
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 gap-3 border-t bg-muted/50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {index === 0 ? (
          <Button variant="outline" onClick={onCancel} className="h-14 flex-1 text-base">
            Cancel
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={handleBack}
            className="h-14 flex-1 gap-1.5 text-base"
          >
            <ChevronLeft className="size-5" />
            Back
          </Button>
        )}
        <Button onClick={handleNext} className="h-14 flex-[1.5] gap-1.5 text-base">
          {index + 1 < total ? "Next" : "Review"}
          <ArrowRight className="size-5" />
        </Button>
      </div>
    </>
  );
}
