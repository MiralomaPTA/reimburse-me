import { z } from "zod";
import { getAdapters } from "@/server/adapters";
import { clientIp, rateLimited } from "@/server/auth/rate-limit";
import { createMagicToken } from "@/server/auth/tokens";
import { config } from "@/server/config";
import { signInEmail } from "@/server/email/templates";

const bodySchema = z.object({ email: z.email().max(254), next: z.string().max(200).optional() });

/** Emails a one-time sign-in link. Always answers 200 so addresses can't be probed. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address" }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();

  const ip = clientIp(request);
  if (rateLimited(`ip:${ip}`, 20, 15 * 60_000) || rateLimited(`email:${email}`, 5, 15 * 60_000)) {
    return Response.json({ error: "Too many sign-in links requested. Try again in a few minutes." }, { status: 429 });
  }

  const token = await createMagicToken(email);
  const url = new URL("/auth/callback", config.appUrl);
  url.searchParams.set("token", token);
  const next = parsed.data.next;
  if (next && next.startsWith("/") && !next.startsWith("//")) url.searchParams.set("next", next);

  const { mailer } = await getAdapters();
  const mail = signInEmail(url.toString());
  try {
    await mailer.send({ to: [email], subject: mail.subject, text: mail.text });
  } catch (error) {
    console.error("[auth] could not send sign-in link:", error);
    return Response.json({ error: "We couldn't send the email. Please try again." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
