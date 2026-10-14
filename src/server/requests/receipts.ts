import { getAdapters } from "@/server/adapters";
import type { RequestInput } from "@/lib/request-schema";
import type { ReceiptFile } from "@/server/pdf/types";

export class ReceiptError extends Error {}

/**
 * Loads every receipt the request references and checks it was uploaded by
 * the signed-in user. The uploader is set server-side when the upload session
 * is created, so a client cannot point a request at someone else's file.
 */
export async function loadReceiptFiles(request: RequestInput, requesterEmail: string): Promise<Map<string, ReceiptFile>> {
  const { files } = await getAdapters();
  const out = new Map<string, ReceiptFile>();
  const ids = new Set(request.items.flatMap((item) => item.receipts.map((r) => r.fileId)));
  await Promise.all(
    [...ids].map(async (fileId) => {
      const meta = await files.getFileMeta(fileId);
      if (!meta) throw new ReceiptError(`A receipt is missing or still uploading (${fileId}). Please re-add it.`);
      if (meta.uploader.toLowerCase() !== requesterEmail.toLowerCase()) {
        throw new ReceiptError("A receipt does not belong to this sign-in. Please re-add it.");
      }
      const bytes = await files.getFileBytes(fileId);
      out.set(fileId, { fileId, name: meta.name, mimeType: meta.mimeType, bytes });
    }),
  );
  return out;
}
