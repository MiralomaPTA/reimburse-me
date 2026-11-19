import type { NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters";
import { getApprovedSession } from "@/server/auth/session";
import { config } from "@/server/config";
import { sha256 } from "@/server/hash";
import { pdfResponse } from "@/server/http";
import { versionOf } from "@/server/requests/rows";
import { authorizedSending } from "@/server/requests/signers";
import { authorizedName, cosignedName, packetName } from "@/server/requests/stored";

/**
 * Serves a requester's own packet: the authorized one once AP has it (two
 * check signers signed a mailed check's FO10, and AP's email went), checked
 * against its hash; else the co-signed one once the event chair has signed;
 * else the one they signed. A requester never holds an authorized packet AP
 * doesn't. Files are never public links.
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
  if (authorizedSending(row) === "sent") {
    const bytes = await files.getFileBytes(row.authorized_pdf_file_id);
    if (sha256(bytes) !== row.authorized_pdf_sha256) {
      console.error(`[requests pdf] ${row.request_id}'s authorized packet is ${sha256(bytes)}, the row says ${row.authorized_pdf_sha256}`);
      return new Response(`This request's authorized file doesn't match the record of what was signed. Please let the PTA know at ${config.apEmail}.`, { status: 409 });
    }
    return pdfResponse(bytes, authorizedName(row.request_id, version), "private, no-store");
  }
  // Once the event chair has signed, the co-signed packet is the one that went on.
  if (row.chair_pdf_file_id) return pdfResponse(await files.getFileBytes(row.chair_pdf_file_id), cosignedName(row.request_id, version), "private, no-store");
  const bytes = await files.getFileBytes(row.pdf_file_id);
  return pdfResponse(bytes, packetName(row.request_id, version), "private, no-store");
}
