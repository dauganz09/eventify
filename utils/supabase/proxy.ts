import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/local-session";

// Organizer routes — require a user session, redirect to /admin/login if missing
const userProtectedPrefixes = ["/events", "/tabulator", "/settings"];

// Judge routes — guarded by the (judge) layout, not the proxy
const judgeOwnedPrefixes = ["/judge"];

// Always public — never block these regardless of cookies
const publicPrefixes = [
  "/admin/login",
  "/judge/login",
  "/login",           // redirects to /judge/login — must stay reachable
  "/api/auth",
];

function isPublicPath(pathname: string) {
  return publicPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isUserProtectedPath(pathname: string) {
  if (pathname === "/") return true;
  return userProtectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function updateSession(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const pathname = request.nextUrl.pathname;

  // Public paths are always reachable
  if (isPublicPath(pathname)) {
    // Redirect already-logged-in organizers away from admin login
    if (token && pathname === "/admin/login") {
      const next = request.nextUrl.clone();
      next.pathname = "/";
      next.search = "";
      return NextResponse.redirect(next);
    }
    return NextResponse.next({ request: { headers: request.headers } });
  }

  // Judge workspace — let the (judge) layout handle its own session check
  if (judgeOwnedPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next({ request: { headers: request.headers } });
  }

  // Organizer-only routes — redirect to admin login if no user session
  // Exception: "/" redirects to judge login (public entry point)
  if (!token && isUserProtectedPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    if (pathname === "/") {
      loginUrl.pathname = "/judge/login";
      loginUrl.search = "";
    } else {
      loginUrl.pathname = "/admin/login";
      loginUrl.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next({ request: { headers: request.headers } });
}
