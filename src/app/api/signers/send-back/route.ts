import { z } from "zod";
import { getAdapters } from "@/server/adapters";
import { linkBase } from "@/server/auth/links";
import { clientIp } from "@/server/auth/rate-limit";
import { SignerError, sendBackAsSigner } from "@/server/requests/signers";

export const maxDuration = 60;

const sendBackSchema = z.object({
  requestId: z.string().min(1).max(40),
  token: z.string().min(1).max(4000),
  slot: z.union([z.literal(1), z.literal(2)]),
  version: z.number().int().positive(),
  name: z.string().trim().min(2, "Enter your full name").max(80),
  note: z.string().trim().min(1, "Say what needs to change").max(1000),
});

/** A check signer sends a mailed check back instead of signing it, with a note for the requester and AP. */
export async function POST(request: Request) {
  const parsed = sendBackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Please fix the form" }, { status: 400 });
  try {
    const result = await sendBackAsSigner({ ...parsed.data, ip: clientIp(request), userAgent: request.headers.get("user-agent") ?? "", linkBase: linkBase(request) }, await getAdapters());
    return Response.json(result);
  } catch (error) {
    if (error instanceof SignerError) return Response.json({ error: error.message, reload: error.reload }, { status: 409 });
    console.error("[signer send back]", error);
    return Response.json({ error: "Something went wrong. Nothing was sent; please try again." }, { status: 500 });
  }
}
