import { EventEmitter } from "node:events";

/**
 * In-process realtime event bus (no Supabase yet — offline-first).
 *
 * Server actions call `publishEvent(eventId, payload)`; SSE route handlers (and
 * any other server-side consumer) call `subscribe(eventId, listener)` to receive
 * those payloads and stream them to connected clients.
 *
 * This is single-instance pub/sub: it works for one Node server (the current
 * deployment target). When we move to Supabase Realtime, swap this module's
 * implementation while keeping the same publish/subscribe surface.
 */

export type RealtimePayload =
  | { type: "round.changed"; scope: "set" | "group"; id: string; status: string }
  | { type: "judge.reminder"; judgeId: string; message: string; sentAt: string }
  | { type: "judge.session.revoked"; judgeId: string }
  | { type: "judge.session.changed"; judgeId: string; signedIn: boolean }
  | { type: "judge.finalized"; judgeId: string; roundId: string; finalized: boolean }
  | { type: "judge.unlock_requested"; judgeId: string; roundId: string }
  | { type: "judge.unlock_rejected"; judgeId: string; roundId: string }
  | { type: "present.reveal"; revealed: number }
  | { type: "results.updated" }
  // Live tie-break vote lifecycle. "opened" is published once per eligible
  // judge (judgeId set, so each judge's client can self-filter) to trigger
  // their blocking dialog; "resolved"/"cancelled" are broadcast once, for
  // every judge's dialog to dismiss. A cast ballot doesn't get its own event
  // — it rides the existing `results.updated` -> live-snapshot-refresh path
  // (openTieBreakVotes is part of that snapshot), same as any other score change.
  | { type: "tie_break_vote.opened"; judgeId: string; voteId: string; rankLabel: string }
  | { type: "tie_break_vote.resolved"; voteId: string }
  | { type: "tie_break_vote.cancelled"; voteId: string };

// A module-level singleton, preserved across hot reloads in dev.
const globalForBus = globalThis as unknown as { __tabulateBus?: EventEmitter };
const emitter = globalForBus.__tabulateBus ?? new EventEmitter();
emitter.setMaxListeners(0); // many SSE connections may subscribe concurrently
globalForBus.__tabulateBus = emitter;

function channel(eventId: string) {
  return `event:${eventId}`;
}

const RESULTS_UPDATED_DEBOUNCE_MS = 400;

const globalForCoalesce = globalThis as unknown as {
  __tabulateResultsTimers?: Map<string, ReturnType<typeof setTimeout>>;
};
const resultsUpdatedTimers =
  globalForCoalesce.__tabulateResultsTimers ?? new Map();
globalForCoalesce.__tabulateResultsTimers = resultsUpdatedTimers;

export function publishEvent(eventId: string, payload: RealtimePayload) {
  emitter.emit(channel(eventId), payload);
}

/** Coalesce rapid score writes into one tabulator refresh signal per event. */
export function publishResultsUpdated(eventId: string) {
  const pending = resultsUpdatedTimers.get(eventId);
  if (pending) clearTimeout(pending);

  const timer = setTimeout(() => {
    resultsUpdatedTimers.delete(eventId);
    publishEvent(eventId, { type: "results.updated" });
  }, RESULTS_UPDATED_DEBOUNCE_MS);

  resultsUpdatedTimers.set(eventId, timer);
}

export function subscribe(
  eventId: string,
  listener: (payload: RealtimePayload) => void,
): () => void {
  const name = channel(eventId);
  emitter.on(name, listener);
  return () => emitter.off(name, listener);
}
