import { redirect } from "next/navigation";
import { getApprovedSession, requireApprovedSession, type ApprovedSession } from "@/server/auth/session";
import { isAp } from "@/server/auth/roles";

/**
 * The AP pages and their routes check the role on every request, from the
 * Users tab, so changing a role in the Sheet takes effect at once.
 */

/** For pages: sends anyone signed out to sign in, and anyone who isn't AP to their own requests. */
export async function requireApSession(nextPath: string): Promise<ApprovedSession> {
  const session = await requireApprovedSession(nextPath);
  if (!isAp(session.user)) redirect("/requests");
  return session;
}

/** For route handlers: the signed-in AP member, or null. */
export async function getApSession(): Promise<ApprovedSession | null> {
  const session = await getApprovedSession();
  return session && isAp(session.user) ? session : null;
}
