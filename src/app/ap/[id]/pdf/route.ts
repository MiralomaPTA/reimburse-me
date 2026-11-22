import type { NextRequest } from "next/server";
import { getAdapters } from "@/server/adapters";
import { getApSession } from "@/server/ap/access";
import { earlierPackets } from "@/server/ap/dashboard";
import { sha256 } from "@/server/hash";
import { pdfResponse } from "@/server/http";
import { versionOf } from "@/server/requests/rows";
import { authorizedName, cosignedName, packetName } from "@/server/requests/stored";

/**
 * Serves AP any of a request's packets: `file=authorized` (a mailed check's,
 * with the FO10 signed by both), `file=cosigned` (with the event chair's
 * signature), or `file=signed` (as the requester signed it), each only if it
 * matches the hash on the row: every packet the app writes records one, so a
 * blank hash cell is refused too. `v` picks an earlier version's
 * requester-signed packet, for reference: the row keeps no hash for those, so
 * they're served unchecked, and the page says so. Only the files the row
 * names can be served, and only to AP.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/ap/[id]/pdf">) {
  const session = await getApSession();
  if (!session) return new Response("Not found", { status: 404 });
  const { id } = await ctx.params;
  const { log, files } = await getAdapters();
  const row = await log.get(id);
  if (!row) return new Response("Not found", { status: 404 });

  const file = request.nextUrl.searchParams.get("file") ?? "signed";
  const version = versionOf(row);
  const v = Number(request.nextUrl.searchParams.get("v") ?? version);
  if (!Number.isInteger(v) || v < 1 || v > version) return new Response("Not found", { status: 404 });

  if (v < version) {
    const fileId = file === "signed" ? earlierPackets(row)[v - 1] : undefined;
    if (!fileId) return new Response("Not found", { status: 404 });
    return pdfResponse(await files.getFileBytes(fileId), packetName(row.request_id, v), "private, no-store");
  }

  const which = {
    authorized: { fileId: row.authorized_pdf_file_id, hash: row.authorized_pdf_sha256, name: authorizedName(row.request_id, version) },
    cosigned: { fileId: row.chair_pdf_file_id, hash: row.chair_pdf_sha256, name: cosignedName(row.request_id, version) },
    signed: { fileId: row.pdf_file_id, hash: row.pdf_sha256, name: packetName(row.request_id, version) },
  }[file];
  if (!which?.fileId) return new Response("Not found", { status: 404 });
  const bytes = await files.getFileBytes(which.fileId);
  if (!which.hash || sha256(bytes) !== which.hash) {
    console.error(`[ap pdf] ${row.request_id}'s ${file} packet is ${sha256(bytes)}, the row says ${which.hash || "nothing"}`);
    const why = which.hash ? "its SHA-256 differs from the Sheet's" : "the Sheet has no SHA-256 for it";
    return new Response(`This file can't be matched to the record of what was signed (${why}). Don't pay from it; ask the admin to look.`, { status: 409 });
  }
  return pdfResponse(bytes, which.name, "private, no-store");
}
