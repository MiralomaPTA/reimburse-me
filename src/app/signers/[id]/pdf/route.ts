import type { NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters";
import { pdfResponse } from "@/server/http";
import { signerPdf } from "@/server/requests/signers";

/**
 * The files for a check signer's link: the packet they're asked to authorize
 * (`file=packet`), or the FO10 as it stands (`file=fo10`). Same checks as the
 * page; once the request has left the signers, nothing is served.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/signers/[id]/pdf">) {
  const { id } = await ctx.params;
  const token = request.nextUrl.searchParams.get("t") ?? "";
  const which = request.nextUrl.searchParams.get("file") === "fo10" ? "fo10" : "packet";
  const file = await signerPdf(id, token, which, await getAdapters());
  if (!file) return new Response("This link can't open the request any more.", { status: 404 });
  const response = pdfResponse(file.bytes, file.filename, "private, no-store");
  // The token is in the URL: keep it out of Referer headers and search indexes.
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
