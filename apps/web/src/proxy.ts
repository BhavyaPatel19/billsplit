import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "./lib/csp";

// Cheap first line of defence: anonymous visitors (no session cookie) are sent to /login before
// a protected page renders. The real check happens server-side in the (app) layout.
const SESSION_COOKIE = "billsplit.session_token";
const PROTECTED = ["/dashboard", "/groups", "/settings"];

const dev = process.env.NODE_ENV !== "production";
const receiptsOrigin = process.env.RECEIPTS_ORIGIN ?? (dev ? "http://localhost:9000" : undefined);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSession =
    request.cookies.has(SESSION_COOKIE) || request.cookies.has(`__Secure-${SESSION_COOKIE}`);
  if (isProtected && !hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  // A fresh nonce per request; Next.js reads it from the request's CSP header and puts it on
  // its own scripts.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({ nonce, dev, receiptsOrigin });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  // Every page, but not the API (proxied to Hono), static files or prefetches.
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
