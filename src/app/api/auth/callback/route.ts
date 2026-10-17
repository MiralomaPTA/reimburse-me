import { cookies } from "next/headers";
import { getAdapters } from "@/server/adapters";
import { completeSignIn } from "@/server/auth/access";
import { seeOther } from "@/server/http";
import { createSessionToken } from "@/server/auth/tokens";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/session";
import { safeNextPath } from "@/lib/next-path";

/**
 * The sign-in page POSTs the token here (a click, not a GET), so link
 * scanners that prefetch URLs in email do not consume the sign-in.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const { users, mailer } = await getAdapters();
  const result = await completeSignIn(token, { users, mailer });
  // Relative Location headers: the browser resolves them against whatever host
  // and port it is actually using, so no APP_URL or Host reasoning is needed.
  if (!result.ok) return seeOther(result.reason === "not-approved" ? "/?unapproved=1" : "/?expired=1");

  const session = await createSessionToken({ email: result.email, method: "email-link", signedInAt: new Date().toISOString() });
  (await cookies()).set(SESSION_COOKIE, session, sessionCookieOptions);
  return seeOther(safeNextPath(form.get("next")) ?? "/requests/new");
}
