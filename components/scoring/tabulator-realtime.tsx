"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { requestTabulatorSnapshotRefresh } from "@/lib/realtime/tabulator-bridge";

const SCORE_DEBOUNCE_MS = 1_000;
const FULL_REFRESH_DEBOUNCE_MS = 900;

/**
 * Long-lived SSE subscription for the tabulator console. Lives outside the live
 * snapshot provider so score state updates never recreate this connection.
 */
export function TabulatorRealtime({ eventId }: { eventId: string }) {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const scoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource(`/api/realtime/${eventId}`);

    function scheduleSnapshotRefresh() {
      if (scoreTimer.current) clearTimeout(scoreTimer.current);
      scoreTimer.current = setTimeout(() => {
        scoreTimer.current = null;
        requestTabulatorSnapshotRefresh();
      }, SCORE_DEBOUNCE_MS);
    }

    function scheduleFullRefresh() {
      if (fullTimer.current) clearTimeout(fullTimer.current);
      // Long enough that a router.refresh() triggered right after a fresh page
      // load can't land mid-hydration (a real source of "hydration failed"
      // errors in dev mode — a full refresh reconciles a new server tree
      // against whatever the client has, which is unsafe to do before the
      // initial hydration pass has actually finished).
      fullTimer.current = setTimeout(() => {
        fullTimer.current = null;
        routerRef.current.refresh();
      }, FULL_REFRESH_DEBOUNCE_MS);
    }

    source.onmessage = (event) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const type = (data as { type?: string } | null)?.type;

      if (type === "results.updated") {
        scheduleSnapshotRefresh();
        return;
      }

      if (
        type === "round.changed" ||
        type === "judge.session.changed" ||
        type === "judge.session.revoked" ||
        type === "judge.finalized" ||
        type === "judge.unlock_requested" ||
        type === "judge.unlock_rejected"
      ) {
        scheduleFullRefresh();
      }
    };

    return () => {
      if (scoreTimer.current) clearTimeout(scoreTimer.current);
      if (fullTimer.current) clearTimeout(fullTimer.current);
      source.close();
    };
  }, [eventId]);

  return null;
}
