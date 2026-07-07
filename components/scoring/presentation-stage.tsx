"use client";

import { useCallback, useEffect, useState } from "react";
import { Crown, Eye, EyeOff, Maximize, RotateCcw, Trophy } from "lucide-react";
import { setPresentationRevealAction } from "@/app/(dashboard)/tabulator/actions";
import { EventLogo } from "@/components/events/event-logo";

export interface PresentEntry {
  rank: number;
  contestantId: string;
  displayNumber: string | null;
  displayName: string;
  value: number;
  photoUrl: string | null;
}

/**
 * Full-screen results reveal for a projector. Placements are unveiled from LAST
 * place upward, building suspense toward the winner. The operator's controls
 * broadcast each step over the realtime bus so a second screen (e.g. the actual
 * projector) mirrors the reveal in sync.
 */
export function PresentationStage({
  eventId,
  eventName,
  eventLogoUrl,
  entries,
  canControl,
}: {
  eventId: string;
  eventName: string;
  eventLogoUrl: string | null;
  entries: PresentEntry[];
  canControl: boolean;
}) {
  // Entries sorted best → worst.
  const byRank = [...entries].sort((a, b) => a.rank - b.rank);
  const total = byRank.length;

  // `revealed` = how many placements are shown, counting from last place up.
  const [revealed, setRevealed] = useState(0);

  // Sync from the bus (so a mirror screen follows the operator).
  useEffect(() => {
    const source = new EventSource(`/api/realtime/${eventId}`);
    source.onmessage = (event) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const payload = data as { type?: string; revealed?: number } | null;
      if (payload?.type === "present.reveal" && typeof payload.revealed === "number") {
        setRevealed(Math.min(total, Math.max(0, payload.revealed)));
      }
    };
    return () => source.close();
  }, [eventId, total]);

  const broadcast = useCallback(
    (next: number) => {
      setRevealed(next);
      if (canControl) {
        void setPresentationRevealAction({ eventId, revealed: next }).catch(() => {});
      }
    },
    [canControl, eventId],
  );

  const revealNext = useCallback(
    () => broadcast(Math.min(total, revealed + 1)),
    [broadcast, revealed, total],
  );
  const hideLast = useCallback(
    () => broadcast(Math.max(0, revealed - 1)),
    [broadcast, revealed],
  );
  const revealAll = useCallback(() => broadcast(total), [broadcast, total]);
  const reset = useCallback(() => broadcast(0), [broadcast]);

  // Keyboard control for the operator: → reveal, ← hide, F fullscreen.
  useEffect(() => {
    if (!canControl) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        revealNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        hideLast();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canControl, revealNext, hideLast]);

  function goFullscreen() {
    document.documentElement.requestFullscreen?.();
  }

  // The revealed slice: the lowest `revealed` placements (worst ranks first as
  // they're announced), displayed best-at-top once shown.
  const firstRevealedIndex = total - revealed; // index into byRank
  const nextToReveal = firstRevealedIndex - 1 >= 0 ? byRank[firstRevealedIndex - 1] : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-3">
          {eventLogoUrl ? (
            <EventLogo
              src={eventLogoUrl}
              alt={eventName}
              className="size-10 border-white/20 bg-white/10 p-1"
            />
          ) : (
            <Trophy className="size-7 text-amber-400" />
          )}
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">
              Official Results
            </p>
            <h1 className="text-2xl font-bold">{eventName}</h1>
          </div>
        </div>
        <div className="text-right text-sm text-white/60">
          {revealed} of {total} revealed
        </div>
      </div>

      {/* Stage */}
      <div className="flex-1 overflow-auto px-4 pb-32 sm:px-8">
        {total === 0 ? (
          <div className="flex h-full items-center justify-center text-white/50">
            No ranked contestants yet.
          </div>
        ) : (
          <ol className="mx-auto flex max-w-3xl flex-col gap-3">
            {byRank.map((entry, index) => {
              const isRevealed = index >= firstRevealedIndex;
              return (
                <PlacementRow
                  key={entry.contestantId}
                  entry={entry}
                  revealed={isRevealed}
                />
              );
            })}
          </ol>
        )}
      </div>

      {/* Controls (operator only) */}
      {canControl && (
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-3 border-t border-white/10 bg-black/40 px-6 py-4 backdrop-blur">
          {nextToReveal && (
            <span className="mr-2 text-sm text-white/60">
              Next: {nextToReveal.rank === 1 ? "🏆 Champion" : `Place ${nextToReveal.rank}`}
            </span>
          )}
          <button
            type="button"
            onClick={hideLast}
            disabled={revealed === 0}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/20 px-4 text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            <EyeOff className="size-4" />
            Hide
          </button>
          <button
            type="button"
            onClick={revealNext}
            disabled={revealed >= total}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-amber-500 px-5 text-sm font-semibold text-amber-950 transition-colors hover:bg-amber-400 disabled:opacity-40"
          >
            <Eye className="size-4" />
            Reveal next
          </button>
          <button
            type="button"
            onClick={revealAll}
            disabled={revealed >= total}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/20 px-4 text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            Reveal all
          </button>
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/20 px-4 text-sm font-medium transition-colors hover:bg-white/10"
          >
            <RotateCcw className="size-4" />
            Reset
          </button>
          <button
            type="button"
            onClick={goFullscreen}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/20 px-4 text-sm font-medium transition-colors hover:bg-white/10"
          >
            <Maximize className="size-4" />
            Fullscreen
          </button>
        </div>
      )}
    </div>
  );
}

function PlacementRow({
  entry,
  revealed,
}: {
  entry: PresentEntry;
  revealed: boolean;
}) {
  const isWinner = entry.rank === 1;
  const medal =
    entry.rank === 1
      ? "from-amber-400/30 to-amber-500/10 border-amber-400/60"
      : entry.rank === 2
        ? "from-zinc-300/20 to-zinc-400/5 border-zinc-300/50"
        : entry.rank === 3
          ? "from-amber-700/25 to-amber-800/10 border-amber-600/50"
          : "from-white/5 to-white/0 border-white/10";

  if (!revealed) {
    return (
      <li className="flex items-center gap-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-4 opacity-60">
        <span className="text-2xl font-black tabular-nums text-white/30">
          {entry.rank}
        </span>
        <div className="h-10 w-10 rounded-full bg-white/10" />
        <span className="text-lg font-medium text-white/30">— to be revealed —</span>
      </li>
    );
  }

  return (
    <li
      className={`flex items-center gap-4 rounded-2xl border bg-gradient-to-r px-5 py-4 shadow-lg duration-500 animate-in fade-in slide-in-from-bottom-4 ${medal} ${
        isWinner ? "py-6 ring-2 ring-amber-400/50" : ""
      }`}
    >
      <span
        className={`flex shrink-0 items-center gap-1 tabular-nums ${
          isWinner ? "text-4xl font-black text-amber-300" : "text-3xl font-black text-white/80"
        }`}
      >
        {entry.rank <= 3 && (
          <Crown
            className={
              entry.rank === 1
                ? "size-6 text-amber-400"
                : entry.rank === 2
                  ? "size-5 text-zinc-300"
                  : "size-5 text-amber-600"
            }
          />
        )}
        {entry.rank}
      </span>

      {entry.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.photoUrl}
          alt={entry.displayName}
          className={`shrink-0 rounded-full object-cover ${isWinner ? "size-16" : "size-12"}`}
        />
      ) : (
        <span
          className={`flex shrink-0 items-center justify-center rounded-full bg-white/10 font-bold ${
            isWinner ? "size-16 text-xl" : "size-12"
          }`}
        >
          {entry.displayNumber ?? "?"}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className={`truncate font-bold ${isWinner ? "text-3xl" : "text-xl"}`}>
          {entry.displayName}
        </p>
        {entry.displayNumber && (
          <p className="text-sm text-white/50">#{entry.displayNumber}</p>
        )}
      </div>

      <span
        className={`shrink-0 tabular-nums font-semibold ${
          isWinner ? "text-3xl text-amber-300" : "text-xl text-white/70"
        }`}
      >
        {entry.value.toFixed(2)}
      </span>
    </li>
  );
}
