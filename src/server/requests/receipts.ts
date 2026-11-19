import type { FileStore } from "@/server/adapters/types";
import type { RequestInput } from "@/lib/request-schema";
import type { ReceiptFile } from "@/server/pdf/types";

export class ReceiptError extends Error {}

/** A receipt ready to go in a packet, and whether it's already in the request's folder. */
export interface LoadedReceipt extends ReceiptFile {
  /** Moved into `ownRequest`'s folder by an earlier version: kept there, not moved again. */
  attached: boolean;
}

/**
 * Loads every receipt the request references and checks it was uploaded by
 * the signed-in user and not yet used. The uploader is set server-side when
 * the upload session is created, so a client cannot point a request at
 * someone else's file; the request a receipt was moved into is recorded on
 * the file, so one receipt can't back two requests. The one exception is
 * `ownRequest`: when a returned request is fixed and re-signed, the receipts
 * already in its folder may be used again by its next version.
 */
export async function loadReceiptFiles(request: RequestInput, requesterEmail: string, files: FileStore, ownRequest = ""): Promise<Map<string, LoadedReceipt>> {
  const out = new Map<string, LoadedReceipt>();
  const ids = new Set(request.items.flatMap((item) => item.receipts.map((r) => r.fileId)));
  await Promise.all(
    [...ids].map(async (fileId) => {
      const meta = await files.getFileMeta(fileId);
      if (!meta) throw new ReceiptError(`A receipt is missing or still uploading (${fileId}). Please re-add it.`);
      if (meta.uploader.toLowerCase() !== requesterEmail.toLowerCase()) {
        throw new ReceiptError("A receipt does not belong to this sign-in. Please re-add it.");
      }
      const attached = Boolean(meta.attachedTo) && meta.attachedTo === ownRequest;
      if (meta.attachedTo && !attached) {
        throw new ReceiptError(`A receipt was already used in request ${meta.attachedTo}. Upload it again if it belongs to this request too.`);
      }
      const bytes = await files.getFileBytes(fileId);
      out.set(fileId, { fileId, name: meta.name, mimeType: meta.mimeType, bytes, attached });
    }),
  );
  return out;
}
