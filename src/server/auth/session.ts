import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "@/server/config";
import { verifySessionToken, type Session } from "@/server/auth/tokens";

export const SESSION_COOKIE = "rm_session";

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: config.isProduction,
  path: "/",
  maxAge: config.sessionDays * 24 * 60 * 60,
};

/** Returns the signed-in user, or null. Safe to call from pages and route handlers. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** For pages: redirects to the sign-in screen when there is no valid session. */
export async function requireSession(nextPath?: string): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(nextPath ? `/?next=${encodeURIComponent(nextPath)}` : "/");
  return session;
}
