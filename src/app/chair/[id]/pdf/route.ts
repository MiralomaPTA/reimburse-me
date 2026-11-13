import type { NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters";
import { pdfResponse } from "@/server/http";
import { chairLinkState } from "@/server/requests/chair";
import { cosignedName } from "@/server/requests/stored";

/**
 * The packet for an event chair's link: as the requester signed it while it
 * waits for the chair, the co-signed one afterwards. Same checks as the page.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/chair/[id]/pdf">) {
  const { id } = await ctx.params;
  const token = request.nextUrl.searchParams.get("t") ?? "";
  const adapters = await getAdapters();
  const state = await chairLinkState(id, token, adapters);
  if (state.kind === "ready") {
    return pdfResponse(await adapters.files.getFileBytes(state.row.pdf_file_id), `${id}.pdf`, "private, no-store");
  }
  if (state.kind === "signed" && state.row.chair_pdf_file_id) {
    return pdfResponse(await adapters.files.getFileBytes(state.row.chair_pdf_file_id), cosignedName(id, Number(state.row.version) || 1), "private, no-store");
  }
  return new Response("This link can't open the request any more.", { status: 404 });
}
