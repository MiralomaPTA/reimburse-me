import type { NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters";
import { pdfResponse } from "@/server/http";
import { SignerError, signerPdf } from "@/server/requests/signers";

/**
 * The files for a check signer's link: the packet they're asked to authorize
 * (`file=packet`), or the FO10 as it stands (`file=fo10`). Same checks as the
 * page; once the request has left the signers, nothing is served.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/signers/[id]/pdf">) {
  const { id } = await ctx.params;
  const token = request.nextUrl.searchParams.get("t") ?? "";
  const which = request.nextUrl.searchParams.get("file") === "fo10" ? "fo10" : "packet";
  const response = await signerPdf(id, token, which, await getAdapters()).then(
    (file) => (file ? pdfResponse(file.bytes, file.filename, "private, no-store") : new Response("This link can't open the request any more.", { status: 404 })),
    // The files don't match the record of what was signed: the page says so too.
    (error: unknown) => {
      if (error instanceof SignerError) return new Response(error.message, { status: 409 });
      throw error;
    },
  );
  // The token is in the URL: keep it out of Referer headers and search indexes.
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
