import { cookies } from "next/headers";
import { createSessionToken, verifyMagicToken } from "@/server/auth/tokens";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/session";
import { config } from "@/server/config";

/**
 * The sign-in page POSTs the token here (a click, not a GET), so link
 * scanners that prefetch URLs in email do not consume the sign-in.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const next = String(form.get("next") ?? "");
  const email = await verifyMagicToken(token);
  if (!email) return Response.redirect(new URL("/?expired=1", config.appUrl), 303);

  const session = await createSessionToken({ email, method: "email-link", signedInAt: new Date().toISOString() });
  (await cookies()).set(SESSION_COOKIE, session, sessionCookieOptions);
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/requests/new";
  return Response.redirect(new URL(target, config.appUrl), 303);
}
