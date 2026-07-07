import { cookies } from "next/headers";
import { db } from "@/db";
import { getJudgeSession, JUDGE_SESSION_COOKIE } from "@/lib/auth/judge-session";
import { getAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { subscribe, type RealtimePayload } from "@/lib/realtime/bus";

// EventEmitter-backed bus needs the Node runtime (not edge), and the stream
// must never be cached or statically rendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream for one event's realtime channel.
 *
 * Consumers: the judge workspace (round lifecycle + reminders) and, optionally,
 * the tabulator console. Access is granted to a judge whose session belongs to
 * this event, or to a dashboard user with `score.review` on the org.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;

  const cookieStore = await cookies();
  const judgeToken = cookieStore.get(JUDGE_SESSION_COOKIE)?.value;

  let authorized = false;
  if (judgeToken) {
    const session = await getJudgeSession(db, judgeToken);
    if (session && session.eventId === eventId) authorized = true;
  }
  if (!authorized) {
    const context = await getAuthContext();
    if (context && hasPermission(context.authorization, "score.review")) {
      authorized = true;
    }
  }
  if (!authorized) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function send(payload: RealtimePayload) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      }

      // Initial comment opens the stream; tells the client we're live.
      controller.enqueue(encoder.encode(": connected\n\n"));

      const unsubscribe = subscribe(eventId, send);

      // Heartbeat keeps proxies from closing an idle connection.
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 25_000);

      // Clean up when the client disconnects.
      _request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
