import type { FileStore } from "@/server/adapters/types";
import type { RequestInput } from "@/lib/request-schema";
import type { LineBox } from "@/server/pdf/types";

/**
 * What the request's JSON file in Drive holds: the request exactly as it was
 * signed, and where its VP/Chairman line landed in the packet. Written at
 * every submission. The chair step reads it to stamp the chair's signature
 * and to show the chair what they are signing; Phase 2's "Fix and re-sign"
 * will read it to refill the form.
 */
export interface StoredRequest {
  requestId: string;
  version: number;
  submittedAt: string;
  requesterEmail: string;
  request: RequestInput;
  packet: { sha256: string; pageCount: number; chairLine: LineBox };
}

const suffix = (version: number) => (version > 1 ? `-v${version}` : "");
/** FY27-042.json, FY27-042-v2.json */
export const storedRequestName = (requestId: string, version: number) => `${requestId}${suffix(version)}.json`;
/** FY27-042-cosigned.pdf, FY27-042-v2-cosigned.pdf */
export const cosignedName = (requestId: string, version: number) => `${requestId}${suffix(version)}-cosigned.pdf`;

export async function saveStoredRequest(files: FileStore, folderPath: string[], stored: StoredRequest): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(stored, null, 2));
  const { id } = await files.putFile({ name: storedRequestName(stored.requestId, stored.version), mimeType: "application/json", bytes, folderPath });
  return id;
}

/**
 * Reads a request's JSON back. It was validated when it was submitted, so it
 * isn't checked against today's form rules, which may have tightened since.
 */
export async function loadStoredRequest(files: FileStore, fileId: string): Promise<StoredRequest> {
  const raw = JSON.parse(new TextDecoder().decode(await files.getFileBytes(fileId))) as StoredRequest;
  const line = raw.packet?.chairLine;
  if (!line || ![line.page, line.x, line.y, line.width, line.height].every(Number.isFinite)) {
    throw new Error(`The stored request ${fileId} has no VP/Chairman line position`);
  }
  return { ...raw, request: { ...raw.request, event: raw.request.event ?? "" } };
}
