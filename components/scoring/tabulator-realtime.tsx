"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps the tabulator console live. Subscribes to the event's SSE channel and
 * refreshes the server component when scores or the run-of-show change.
 *
 * Refreshes are debounced so a burst of judge submissions coalesces into one
 * re-render (and therefore one smooth ranking animation), instead of thrashing.
 */
export function TabulatorRealtime({ eventId }: { eventId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource(`/api/realtime/${eventId}`);

    function scheduleRefresh() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 400);
    }

    // Refresh on every (re)connect so the tabulator never stays stale after a
    // network blip or server restart — even if no new event fires.
    source.onopen = () => scheduleRefresh();

    source.onmessage = (event) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const type = (data as { type?: string } | null)?.type;
      if (
        type === "results.updated" ||
        type === "round.changed" ||
        type === "judge.session.changed" ||
        type === "judge.session.revoked" ||
        type === "judge.finalized" ||
        type === "judge.unlock_requested" ||
        type === "judge.unlock_rejected"
      ) {
        scheduleRefresh();
      }
    };

    return () => {
      if (timer.current) clearTimeout(timer.current);
      source.close();
    };
  }, [eventId, router]);

  return null;
}
