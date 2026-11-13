import type { NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters";
import { pdfResponse } from "@/server/http";
import { chairPdfFile } from "@/server/requests/chair";

/**
 * The packet for an event chair's link: as the requester signed it while it
 * waits for the chair, the co-signed one afterwards. Same checks as the page,
 * without loading what only the page shows.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/chair/[id]/pdf">) {
  const { id } = await ctx.params;
  const token = request.nextUrl.searchParams.get("t") ?? "";
  const adapters = await getAdapters();
  const file = await chairPdfFile(id, token, adapters);
  if (!file) return new Response("This link can't open the request any more.", { status: 404 });
  return pdfResponse(await adapters.files.getFileBytes(file.fileId), file.filename, "private, no-store");
}
