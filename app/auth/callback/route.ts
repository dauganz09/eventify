import { NextResponse } from "next/server";

// OAuth callback is not used in local mode.
export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/login`);
}
