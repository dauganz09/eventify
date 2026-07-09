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
import { useSearchParams } from "next/navigation";
import { registerTabulatorSnapshotRefresh } from "@/lib/realtime/tabulator-bridge";
import type { TabulatorLiveSnapshot } from "@/lib/scoring/tabulator-snapshot-service";

const TabulatorLiveSnapshotContext = createContext<TabulatorLiveSnapshot | null>(null);

export function TabulatorLiveProvider({
  eventId,
  focusSetId: serverFocusSetId,
  initialSnapshot,
  children,
}: {
  eventId: string;
  focusSetId: string | null;
  initialSnapshot: TabulatorLiveSnapshot;
  children: ReactNode;
}) {
  const searchParams = useSearchParams();
  const urlFocusSetId = searchParams.get("set");
  const validSetIds = new Set(initialSnapshot.setColumns.map((set) => set.id));
  const validUrlFocusSetId =
    urlFocusSetId && validSetIds.has(urlFocusSetId) ? urlFocusSetId : null;
  const focusSetId = validUrlFocusSetId ?? serverFocusSetId;

  const [snapshot, setSnapshot] = useState<TabulatorLiveSnapshot>(initialSnapshot);
  const inFlightRef = useRef(false);
  const prevFocusSetIdRef = useRef(focusSetId);

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

  // Full server re-render (activate/deactivate, router.refresh from realtime).
  useEffect(() => {
    setSnapshot(initialSnapshot);
    prevFocusSetIdRef.current = focusSetId;
  }, [initialSnapshot]);

  // Focus set changed via ?set= without a full page reload.
  useEffect(() => {
    if (prevFocusSetIdRef.current === focusSetId) return;
    prevFocusSetIdRef.current = focusSetId;
    void refreshSnapshot();
  }, [focusSetId, refreshSnapshot]);

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
