import { z } from "zod";
import { getAdapters } from "@/server/adapters";
import { linkBase } from "@/server/auth/links";
import { clientIp } from "@/server/auth/rate-limit";
import { SignerError, signAsSigner } from "@/server/requests/signers";
import { signatureSchema } from "@/lib/request-schema";

export const maxDuration = 60;

const signSchema = z.object({
  requestId: z.string().min(1).max(40),
  token: z.string().min(1).max(4000),
  /** What the page showed: the line offered and the request's version. */
  slot: z.union([z.literal(1), z.literal(2)]),
  version: z.number().int().positive(),
  name: z.string().trim().min(2, "Enter your full name").max(80),
  signature: signatureSchema,
  consent: z.literal(true, { message: "Tick the box to sign electronically" }),
  note: z.string().trim().max(500).default(""),
  budgetAccount: z.string().max(200).optional(),
  paymentAccount: z.string().max(200).optional(),
});

/** A check signer signs an Authorized By line of a mailed check's FO10. The emailed link's token is the only authorization. */
export async function POST(request: Request) {
  const parsed = signSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Please fix the form" }, { status: 400 });
  const { requestId, token, slot, version, name, signature, note, budgetAccount, paymentAccount } = parsed.data;
  try {
    const input = { requestId, token, slot, version, name, signature, note, budgetAccount, paymentAccount };
    const result = await signAsSigner({ ...input, ip: clientIp(request), userAgent: request.headers.get("user-agent") ?? "", linkBase: linkBase(request) }, await getAdapters());
    return Response.json(result);
  } catch (error) {
    if (error instanceof SignerError) return Response.json({ error: error.message, reload: error.reload }, { status: 409 });
    console.error("[signer sign]", error);
    return Response.json({ error: "Something went wrong while signing. Nothing was sent; please try again." }, { status: 500 });
  }
}
