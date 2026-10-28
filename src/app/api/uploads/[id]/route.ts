import type { NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters";
import { getApprovedSession } from "@/server/auth/session";
import { ALLOWED_RECEIPT_TYPES } from "@/lib/request-schema";

/**
 * Shows a requester one of their own uploaded receipts, so they can check a
 * photo is legible before signing. Only the sign-in that uploaded the file
 * may open it; files are never public links.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/uploads/[id]">) {
  const session = await getApprovedSession();
  if (!session) return new Response("Sign in required", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) return new Response("Not found", { status: 404 });

  const { files } = await getAdapters();
  const meta = await files.getFileMeta(id);
  if (!meta || meta.uploader.toLowerCase() !== session.email.toLowerCase()) return new Response("Not found", { status: 404 });
  // Only the types the upload route accepts; anything else is downloaded rather than rendered.
  const type = (ALLOWED_RECEIPT_TYPES as readonly string[]).includes(meta.mimeType) ? meta.mimeType : "application/octet-stream";
  const disposition = type === "application/octet-stream" ? "attachment" : "inline";
  const filename = encodeURIComponent(meta.name.replace(/[\r\n"]/g, "_"));

  const bytes = await files.getFileBytes(id);
  return new Response(new Blob([bytes.slice()], { type }), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${filename}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
