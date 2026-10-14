import { clientIp } from "@/server/auth/rate-limit";
import { getSession } from "@/server/auth/session";
import { ReceiptError } from "@/server/requests/receipts";
import { submitRequest } from "@/server/requests/submit";
import { submitSchema } from "@/lib/request-schema";

export const maxDuration = 60;

/** Signs and submits a request: builds the PDF, stores it, logs it, emails AP and the requester. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Please sign in again" }, { status: 401 });
  const parsed = submitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please fix the form", issues: parsed.error.issues }, { status: 400 });

  try {
    const result = await submitRequest({
      request: parsed.data.request,
      signature: parsed.data.signature,
      session,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent") ?? "",
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof ReceiptError) return Response.json({ error: error.message }, { status: 400 });
    console.error("[submit]", error);
    return Response.json({ error: "Something went wrong while submitting. Nothing was sent; please try again." }, { status: 500 });
  }
}
