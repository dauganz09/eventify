"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Info, X } from "lucide-react";
import { toast } from "sonner";

/**
 * Holds the judge's SSE connection for the event channel (no Supabase yet).
 *
 * - `round.changed` → refresh the server component so the workspace swaps
 *   between standby and the active set automatically.
 * - `judge.reminder` addressed to this judge → show a transient toast.
 *
 * Renders nothing; it's a side-effect-only bridge.
 */
export function JudgeRealtime({
  eventId,
  judgeId,
}: {
  eventId: string;
  judgeId: string;
}) {
  const router = useRouter();

  useEffect(() => {
    const source = new EventSource(`/api/realtime/${eventId}`);

    source.onmessage = (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (typeof payload !== "object" || payload === null) return;
      const data = payload as Record<string, unknown>;

      if (data.type === "round.changed") {
        router.refresh();
      } else if (data.type === "judge.finalized" && data.judgeId === judgeId) {
        // Our own lock state changed (e.g. tabulator released it) — re-render
        // so the workspace re-enables or disables editing.
        router.refresh();
      } else if (data.type === "judge.unlock_rejected" && data.judgeId === judgeId) {
        toast.error("Your unlock request was declined by the tabulator.");
        router.refresh();
      } else if (data.type === "judge.session.revoked" && data.judgeId === judgeId) {
        // The tabulator force-released this judge's session. Sign out locally
        // and bounce to the login screen with an explanation.
        source.close();
        void fetch("/api/auth/judge-logout", { method: "POST" }).finally(() => {
          window.location.href = "/judge/login?error=released";
        });
      } else if (data.type === "judge.reminder" && data.judgeId === judgeId) {
        const message = String(data.message ?? "Reminder from the tabulator");
        // A rich, hard-to-miss custom toast: top-right, accent color, bell icon,
        // larger text, auto-dismiss after 5s, or dismissable by hand.
        toast.custom(
          (id) => (
            <div className="flex w-[22rem] items-start gap-3 rounded-xl border-2 border-blue-400 bg-blue-50 p-4 shadow-lg dark:border-blue-500/60 dark:bg-blue-950/80">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white dark:bg-blue-500">
                <Info className="size-5" />
              </div>
              <div className="grid gap-0.5 pt-0.5">
                <p className="text-sm font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                  Reminder from the tabulator
                </p>
                <p className="text-lg font-medium leading-snug text-blue-950 dark:text-blue-50">
                  {message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toast.dismiss(id)}
                aria-label="Dismiss"
                className="-mr-1 -mt-1 ml-auto shrink-0 rounded-md p-1 text-blue-700/70 transition-colors hover:bg-blue-400/30 hover:text-blue-900 dark:text-blue-300/70 dark:hover:text-blue-100"
              >
                <X className="size-4" />
              </button>
            </div>
          ),
          { duration: 5_000, position: "top-right" },
        );
      }
    };

    // EventSource reconnects automatically on transient errors.
    return () => source.close();
  }, [eventId, judgeId, router]);

  return null;
}
