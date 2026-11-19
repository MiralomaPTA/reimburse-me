import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAdapters } from "@/server/adapters";
import { linkBase } from "@/server/auth/links";
import { clientIp } from "@/server/auth/rate-limit";
import { getApprovedSession } from "@/server/auth/session";
import { MailingError } from "@/server/requests/mailing";
import { ReceiptError } from "@/server/requests/receipts";
import { ResubmitError, resubmitRequest } from "@/server/requests/resubmit";
import { FundingError } from "@/server/requests/stipends";
import { EventError } from "@/server/requests/submit";
import { submitSchema } from "@/lib/request-schema";

export const maxDuration = 60;

/** The version the form was filled in from, so a second tab can't sign over a version signed since. */
const resubmitSchema = submitSchema.extend({ version: z.number().int().positive() });

/** "Fix and re-sign": signs a returned request again as its next version, and sends it on the way a new request goes. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/requests/[id]/resubmit">) {
  const session = await getApprovedSession();
  if (!session) return Response.json({ error: "Please sign in again" }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = resubmitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please fix the form", issues: parsed.error.issues }, { status: 400 });

  try {
    const result = await resubmitRequest(
      {
        requestId: id,
        version: parsed.data.version,
        request: parsed.data.request,
        signature: parsed.data.signature,
        session,
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent") ?? "",
        linkBase: linkBase(request),
      },
      await getAdapters(),
    );
    return Response.json(result);
  } catch (error) {
    if (error instanceof ResubmitError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof ReceiptError || error instanceof FundingError || error instanceof EventError || error instanceof MailingError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("[resubmit]", error);
    return Response.json({ error: "Something went wrong while submitting. Nothing was sent; please try again." }, { status: 500 });
  }
}
