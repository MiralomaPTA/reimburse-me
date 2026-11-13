import { z } from "zod";
import { getAdapters } from "@/server/adapters";
import { linkBase } from "@/server/auth/links";
import { clientIp } from "@/server/auth/rate-limit";
import { ChairError, signAsChair } from "@/server/requests/chair";
import { signatureSchema } from "@/lib/request-schema";

export const maxDuration = 60;

const signSchema = z.object({
  requestId: z.string().min(1).max(40),
  token: z.string().min(1).max(4000),
  name: z.string().trim().min(2, "Enter your full name").max(80),
  signature: signatureSchema,
  consent: z.literal(true, { message: "Tick the box to sign electronically" }),
  note: z.string().trim().max(500).default(""),
});

/** An event chair signs the VP/Chairman line. The emailed link's token is the only authorization. */
export async function POST(request: Request) {
  const parsed = signSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Please fix the form" }, { status: 400 });
  const { requestId, token, name, signature, note } = parsed.data;
  try {
    const result = await signAsChair(
      { requestId, token, name, signature, note, ip: clientIp(request), userAgent: request.headers.get("user-agent") ?? "", linkBase: linkBase(request) },
      await getAdapters(),
    );
    return Response.json(result);
  } catch (error) {
    if (error instanceof ChairError) return Response.json({ error: error.message }, { status: 409 });
    console.error("[chair sign]", error);
    return Response.json({ error: "Something went wrong while signing. Nothing was sent; please try again." }, { status: 500 });
  }
}
