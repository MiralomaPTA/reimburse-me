import { z } from "zod";
import { getAdapters } from "@/server/adapters";
import { requestSignIn } from "@/server/auth/access";
import { linkBase } from "@/server/auth/links";
import { clientIp, rateLimited } from "@/server/auth/rate-limit";

const bodySchema = z.object({ email: z.email().max(254), next: z.string().max(200).optional() });

/**
 * Asks for a sign-in link. Approved addresses get one; unknown addresses get
 * a pending row and the approver gets a note. The response says which, so the
 * page can tell the teacher what to expect.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address" }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();

  const ip = clientIp(request);
  if (rateLimited(`ip:${ip}`, 20, 15 * 60_000) || rateLimited(`email:${email}`, 5, 15 * 60_000)) {
    return Response.json({ error: "Too many sign-in links requested. Try again in a few minutes." }, { status: 429 });
  }

  const { users, mailer } = await getAdapters();
  try {
    const status = await requestSignIn({ email, linkBase: linkBase(request), next: parsed.data.next }, { users, mailer });
    return Response.json({ ok: true, status });
  } catch (error) {
    console.error("[auth] sign-in request failed:", error);
    return Response.json({ error: "We couldn't send the email. Please try again." }, { status: 502 });
  }
}
