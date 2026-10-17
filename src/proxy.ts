import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "rm_session";

/**
 * Optimistic check: send visitors without a session cookie to the sign-in
 * page. Pages and handlers still verify the cookie's signature and look the
 * address up in the Users tab themselves.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    const url = new URL("/", request.url);
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/requests/:path*"],
};
