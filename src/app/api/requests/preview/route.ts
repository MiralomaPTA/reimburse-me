import { getAdapters } from "@/server/adapters";
import { getApprovedSession } from "@/server/auth/session";
import { pdfResponse } from "@/server/http";
import { buildPacket } from "@/server/pdf/build-packet";
import { loadReceiptFiles, ReceiptError } from "@/server/requests/receipts";
import { fixProblem } from "@/server/requests/resubmit";
import { requestInputSchema } from "@/lib/request-schema";

export const maxDuration = 60;

/**
 * Builds the unsigned packet so the teacher can check it before signing.
 * `?fix=FY27-042` previews the next version of the requester's own returned
 * request, whose receipts are already in its folder and may be used again.
 */
export async function POST(request: Request) {
  const session = await getApprovedSession();
  if (!session) return Response.json({ error: "Please sign in again" }, { status: 401 });
  const parsed = requestInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please fix the form", issues: parsed.error.issues }, { status: 400 });

  try {
    const { files, log } = await getAdapters();
    const fix = new URL(request.url).searchParams.get("fix") ?? "";
    // Only the requester's own request, while it's returned; otherwise its receipts count as used, as for any other request.
    const own = fix && !fixProblem(await log.get(fix), session.email) ? fix : "";
    const receiptFiles = await loadReceiptFiles(parsed.data, session.email, files, own);
    const packet = await buildPacket({
      requestId: "PREVIEW",
      submittedAt: new Date(),
      request: parsed.data,
      requesterEmail: session.email,
      receiptFiles,
      signature: null,
      audit: null,
    });
    return pdfResponse(packet.bytes, "preview.pdf");
  } catch (error) {
    if (error instanceof ReceiptError) return Response.json({ error: error.message }, { status: 400 });
    console.error("[preview]", error);
    return Response.json({ error: "Could not build the preview. Check that each receipt is a JPG, PNG or PDF." }, { status: 500 });
  }
}
