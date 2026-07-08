import { NextResponse } from "next/server";
import { db } from "@/db";
import { getAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { getEventTabulatorLiveSnapshot } from "@/lib/scoring/tabulator-snapshot-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const context = await getAuthContext();
  if (!context || !hasPermission(context.authorization, "score.review")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { eventId } = await params;
  const { searchParams } = new URL(request.url);
  const focusSetId = searchParams.get("set");

  try {
    const snapshot = await getEventTabulatorLiveSnapshot({
      database: db,
      organizationId: context.organization.id,
      eventId,
      focusSetId,
    });
    return NextResponse.json(snapshot);
  } catch {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }
}
