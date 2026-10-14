import type { NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters";
import { getSession } from "@/server/auth/session";
import { pdfResponse } from "@/server/http";

/** Serves a requester's own signed packet. Files are never public links. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/requests/[id]/pdf">) {
  const session = await getSession();
  if (!session) return new Response("Sign in required", { status: 401 });
  const { id } = await ctx.params;
  const { log, files } = await getAdapters();
  const row = await log.get(id);
  if (!row || row.requester_email.toLowerCase() !== session.email.toLowerCase() || !row.pdf_file_id) {
    return new Response("Not found", { status: 404 });
  }
  const bytes = await files.getFileBytes(row.pdf_file_id);
  return pdfResponse(bytes, `${row.request_id}.pdf`, "private, no-store");
}
