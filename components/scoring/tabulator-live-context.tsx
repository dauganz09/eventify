"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { registerTabulatorSnapshotRefresh } from "@/lib/realtime/tabulator-bridge";
import type { TabulatorLiveSnapshot } from "@/lib/scoring/tabulator-snapshot-service";

const TabulatorLiveSnapshotContext = createContext<TabulatorLiveSnapshot | null>(null);

export function TabulatorLiveProvider({
  eventId,
  focusSetId,
  initialSnapshot,
  children,
}: {
  eventId: string;
  focusSetId: string | null;
  initialSnapshot: TabulatorLiveSnapshot;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<TabulatorLiveSnapshot>(initialSnapshot);
  const inFlightRef = useRef(false);

  const refreshSnapshot = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      const params = new URLSearchParams();
      if (focusSetId) params.set("set", focusSetId);

      const query = params.toString();
      const response = await fetch(
        `/api/tabulator/${eventId}/snapshot${query ? `?${query}` : ""}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;

      const next = (await response.json()) as TabulatorLiveSnapshot;
      setSnapshot(next);
    } finally {
      inFlightRef.current = false;
    }
  }, [eventId, focusSetId]);

  useEffect(() => registerTabulatorSnapshotRefresh(refreshSnapshot), [refreshSnapshot]);

  return (
    <TabulatorLiveSnapshotContext.Provider value={snapshot}>
      {children}
    </TabulatorLiveSnapshotContext.Provider>
  );
}

export function useTabulatorLiveSnapshot(): TabulatorLiveSnapshot | null {
  return useContext(TabulatorLiveSnapshotContext);
}
