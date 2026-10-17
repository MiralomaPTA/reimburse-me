import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdapters } from "@/server/adapters";
import type { UserRecord } from "@/server/adapters/types";
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

/** The address in the session cookie, or null. Says nothing about whether it is still approved. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** A session whose address is still approved in the Users tab, with that row. */
export interface ApprovedSession extends Session {
  user: UserRecord;
}

/**
 * Looks the session's address up in the Users tab, so denying or deleting a
 * row takes effect at once rather than when the 30-day cookie runs out.
 */
export async function approvedUser(session: Session): Promise<ApprovedSession | null> {
  const { users } = await getAdapters();
  const user = await users.get(session.email);
  return user?.status === "approved" ? { ...session, user } : null;
}

/** For route handlers: the approved signed-in user, or null. */
export async function getApprovedSession(): Promise<ApprovedSession | null> {
  const session = await getSession();
  return session ? approvedUser(session) : null;
}

/** For pages: redirects to the sign-in screen when there is no session or the address is no longer approved. */
export async function requireApprovedSession(nextPath?: string): Promise<ApprovedSession> {
  const session = await getSession();
  if (!session) redirect(nextPath ? `/?next=${encodeURIComponent(nextPath)}` : "/");
  const approved = await approvedUser(session);
  if (!approved) redirect("/"); // the sign-in page explains that the address is no longer approved
  return approved;
}
