import { NextResponse, type NextRequest } from "next/server";

// Cheap first line of defence: anonymous visitors (no session cookie) are sent to /login before
// a protected page renders. The real check happens server-side in the (app) layout.
const SESSION_COOKIE = "billsplit.session_token";

export function proxy(request: NextRequest) {
  const hasSession =
    request.cookies.has(SESSION_COOKIE) || request.cookies.has(`__Secure-${SESSION_COOKIE}`);
  if (!hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/groups/:path*"],
};
