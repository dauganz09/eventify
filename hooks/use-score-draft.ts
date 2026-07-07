"use client";

import { useMemo, useState } from "react";
import { useOfflineOutbox } from "@/hooks/use-offline-outbox";
import { randomUUID } from "@/lib/utils";
import type { ScoreOperationInput } from "@/lib/validation/domain";

export interface ScoreDraftParams {
  eventId: string;
  roundId: string;
  contestantId: string;
  criterionId: string;
  judgeId: string;
  initialValue?: number;
}

export function useScoreDraft(params: ScoreDraftParams) {
  const [value, setValue] = useState(params.initialValue ?? 0);
  const [comment, setComment] = useState("");
  const [syncState, setSyncState] = useState<"idle" | "saved-locally" | "queued">(
    "idle",
  );
  const [deviceId] = useState(() => getDeviceId());
  const outbox = useOfflineOutbox();

  const basePayload = useMemo(
    () => ({
      eventId: params.eventId,
      roundId: params.roundId,
      contestantId: params.contestantId,
      criterionId: params.criterionId,
      judgeId: params.judgeId,
      deviceId,
    }),
    [
      params.contestantId,
      params.criterionId,
      deviceId,
      params.eventId,
      params.judgeId,
      params.roundId,
    ],
  );

  async function saveDraft() {
    await enqueueOperation("draft_saved");
    setSyncState("saved-locally");
  }

  async function submitScore() {
    await enqueueOperation("submitted");
    setSyncState("queued");
  }

  async function enqueueOperation(operation: "draft_saved" | "submitted") {
    const payload: ScoreOperationInput = {
      ...basePayload,
      idempotencyKey: randomUUID(),
      value,
      comment,
      clientCreatedAt: new Date().toISOString(),
      operation,
    };

    await outbox.enqueue(payload);
  }

  return {
    comment,
    isOnline: outbox.isOnline,
    pendingCount: outbox.pendingCount,
    saveDraft,
    setComment,
    setValue,
    submitScore,
    syncState,
    value,
  };
}

function getDeviceId() {
  if (typeof window === "undefined") return "server-render";

  const storageKey = "tabulate-pro-device-id";
  const existingDeviceId = window.localStorage.getItem(storageKey);
  if (existingDeviceId) return existingDeviceId;

  const deviceId = randomUUID();
  window.localStorage.setItem(storageKey, deviceId);
  return deviceId;
}
