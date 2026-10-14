import type { NextRequest } from "next/server";
import { config } from "@/server/config";

/** Development only: receives the bytes the browser would otherwise PUT straight to Drive. */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/local-upload/[id]">) {
  if (config.adapters !== "local") return Response.json({ error: "Not found" }, { status: 404 });
  const { id } = await ctx.params;
  const { completeLocalUpload } = await import("@/server/adapters/local/files");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > config.maxUploadBytes) {
    return Response.json({ error: "Bad upload size" }, { status: 400 });
  }
  try {
    const meta = await completeLocalUpload(id, bytes);
    return Response.json(meta);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 400 });
  }
}
