import type { NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters";
import { getApprovedSession } from "@/server/auth/session";
import { pdfResponse } from "@/server/http";
import { cosignedName } from "@/server/requests/stored";

/** Serves a requester's own signed packet, co-signed by the event chair when it has been. Files are never public links. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/requests/[id]/pdf">) {
  const session = await getApprovedSession();
  if (!session) return new Response("Sign in required", { status: 401 });
  const { id } = await ctx.params;
  const { log, files } = await getAdapters();
  const row = await log.get(id);
  if (!row || row.requester_email.toLowerCase() !== session.email.toLowerCase() || !row.pdf_file_id) {
    return new Response("Not found", { status: 404 });
  }
  // Once the event chair has signed, the co-signed packet is the one that went on.
  if (row.chair_pdf_file_id) return pdfResponse(await files.getFileBytes(row.chair_pdf_file_id), cosignedName(row.request_id, Number(row.version) || 1), "private, no-store");
  const bytes = await files.getFileBytes(row.pdf_file_id);
  return pdfResponse(bytes, `${row.request_id}.pdf`, "private, no-store");
}
