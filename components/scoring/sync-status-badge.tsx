"use client";

import { useSyncExternalStore } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  UploadCloud,
  WifiOff,
} from "lucide-react";

type Tone = "amber" | "blue" | "red" | "green";

// Hydration-safe "is this running on the client yet?" flag. The badge depends
// on client-only signals (navigator.onLine, IndexedDB queue), so we render a
// neutral placeholder on the server and during hydration to avoid a mismatch,
// then swap to the live status after mount.
const subscribe = () => () => {};

const TONE_CLASSES: Record<Tone, string> = {
  amber:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-600/50 dark:bg-amber-950/40 dark:text-amber-300",
  blue:
    "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-600/50 dark:bg-sky-950/40 dark:text-sky-300",
  red:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-600/50 dark:bg-red-950/40 dark:text-red-300",
  green:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-600/50 dark:bg-emerald-950/40 dark:text-emerald-300",
};

/**
 * Live offline/sync status pill for the judge workspace. Driven entirely by the
 * offline outbox hook, so it reflects real IndexedDB queue state:
 *
 *   Offline            → "Offline — N saved locally"   (amber)
 *   Online, syncing    → "Syncing N…"                  (blue, spinner)
 *   Online, queued     → "N queued"                    (blue) / "retrying" on error (red)
 *   Online, all clear  → "All synced"                  (green, check)
 */
export function SyncStatusBadge({
  isOnline,
  isSyncing,
  pendingCount,
  conflictCount = 0,
  lastSyncError,
  className,
}: {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  /** Scores the server rejected — these will NOT be retried automatically. */
  conflictCount?: number;
  lastSyncError: string | null;
  className?: string;
}) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true, // client
    () => false, // server + during hydration
  );

  let tone: Tone;
  let icon: React.ReactNode;
  let label: string;

  if (!hydrated) {
    tone = "blue";
    icon = <Loader2 className="size-4 animate-spin" />;
    label = "Checking sync…";
  } else if (conflictCount > 0) {
    // Conflicts take highest priority — scores were rejected and won't retry.
    tone = "red";
    icon = <AlertTriangle className="size-4" />;
    label = `${conflictCount} score${conflictCount === 1 ? "" : "s"} not saved — contact tabulator`;
  } else if (!isOnline) {
    tone = "amber";
    icon = <WifiOff className="size-4" />;
    label =
      pendingCount > 0
        ? `Offline — ${pendingCount} saved locally`
        : "Offline — saved locally";
  } else if (isSyncing) {
    tone = "blue";
    icon = <Loader2 className="size-4 animate-spin" />;
    label = pendingCount > 0 ? `Syncing ${pendingCount}…` : "Syncing…";
  } else if (pendingCount > 0) {
    if (lastSyncError) {
      tone = "red";
      icon = <AlertTriangle className="size-4" />;
      label = `${pendingCount} queued — retrying`;
    } else {
      tone = "blue";
      icon = <UploadCloud className="size-4" />;
      label = `${pendingCount} queued`;
    }
  } else {
    tone = "green";
    icon = <CheckCircle2 className="size-4" />;
    label = "All synced";
  }

  return (
    <span
      role="status"
      aria-live="polite"
      title={lastSyncError ?? undefined}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${TONE_CLASSES[tone]} ${className ?? ""}`}
    >
      {icon}
      {label}
    </span>
  );
}
