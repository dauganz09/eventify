import { NextResponse } from "next/server";
import { db } from "@/db";
import { getAuthContext } from "@/lib/auth/context";
import { createEvent, listEvents } from "@/lib/events/event-service";

export async function GET() {
  const context = await getAuthContext();

  if (!context) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const events = await listEvents({
    database: db,
    organizationId: context.organization.id,
  });

  return NextResponse.json({ events });
}

export async function POST(request: Request) {
  const context = await getAuthContext();

  if (!context) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const event = await createEvent({
    database: db,
    organizationId: context.organization.id,
    input: await request.json(),
  });

  return NextResponse.json({ event }, { status: 201 });
}
