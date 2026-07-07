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
  | { type: "results.updated" };

// A module-level singleton, preserved across hot reloads in dev.
const globalForBus = globalThis as unknown as { __tabulateBus?: EventEmitter };
const emitter = globalForBus.__tabulateBus ?? new EventEmitter();
emitter.setMaxListeners(0); // many SSE connections may subscribe concurrently
globalForBus.__tabulateBus = emitter;

function channel(eventId: string) {
  return `event:${eventId}`;
}

export function publishEvent(eventId: string, payload: RealtimePayload) {
  emitter.emit(channel(eventId), payload);
}

export function subscribe(
  eventId: string,
  listener: (payload: RealtimePayload) => void,
): () => void {
  const name = channel(eventId);
  emitter.on(name, listener);
  return () => emitter.off(name, listener);
}
