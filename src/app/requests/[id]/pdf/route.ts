import type { NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters";
import { getApprovedSession } from "@/server/auth/session";
import { pdfResponse } from "@/server/http";
import { versionOf } from "@/server/requests/rows";
import { authorizedName, cosignedName } from "@/server/requests/stored";

/**
 * Serves a requester's own packet: the authorized one once two check signers
 * have signed a mailed check's FO10, else the co-signed one once the event
 * chair has signed, else the one they signed. Files are never public links.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/requests/[id]/pdf">) {
  const session = await getApprovedSession();
  if (!session) return new Response("Sign in required", { status: 401 });
  const { id } = await ctx.params;
  const { log, files } = await getAdapters();
  const row = await log.get(id);
  if (!row || row.requester_email.toLowerCase() !== session.email.toLowerCase() || !row.pdf_file_id) {
    return new Response("Not found", { status: 404 });
  }
  const version = versionOf(row);
  if (row.authorized_pdf_file_id) return pdfResponse(await files.getFileBytes(row.authorized_pdf_file_id), authorizedName(row.request_id, version), "private, no-store");
  // Once the event chair has signed, the co-signed packet is the one that went on.
  if (row.chair_pdf_file_id) return pdfResponse(await files.getFileBytes(row.chair_pdf_file_id), cosignedName(row.request_id, version), "private, no-store");
  const bytes = await files.getFileBytes(row.pdf_file_id);
  return pdfResponse(bytes, `${row.request_id}.pdf`, "private, no-store");
}
