import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "rm_session";

/**
 * Optimistic check: send visitors without a session cookie to the sign-in
 * page. Pages and handlers still verify the cookie's signature themselves.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    const url = new URL("/", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/requests/:path*"],
};
