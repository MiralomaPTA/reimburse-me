import type { FileStore, RequestRow } from "@/server/adapters/types";
import { fiscalYearLabel } from "@/lib/fiscal-year";
import type { RequestInput } from "@/lib/request-schema";
import type { LineBox } from "@/server/pdf/types";

/** The return a re-signed version answers: why it was sent back, by whom (in words, "the Fun Run chair (lillie@example.org)"), and when. */
export interface ReturnAnswered {
  note: string;
  by: string;
  /** ISO; blank when the row didn't record it (a status set by hand in the Sheet). */
  at: string;
}

/**
 * What the request's JSON file in Drive holds: the request exactly as it was
 * signed, and where its VP/Chairman line landed in the packet. Written at
 * every submission and every re-signing. The chair step reads it to stamp the
 * chair's signature and to show the chair what they are signing, the check
 * signers' step fills the FO10 from it (a mailed check's address and amount
 * come from here, never the editable row), and "Fix and re-sign" refills the
 * form from it.
 */
export interface StoredRequest {
  requestId: string;
  version: number;
  submittedAt: string;
  requesterEmail: string;
  request: RequestInput;
  packet: { sha256: string; pageCount: number; chairLine: LineBox };
  /** From version 2 on: the return this version answers, for the emails that carry it. */
  answers?: ReturnAnswered;
}

const suffix = (version: number) => (version > 1 ? `-v${version}` : "");
/** The packet as the requester signed it: FY27-042.pdf, FY27-042-v2.pdf */
export const packetName = (requestId: string, version: number) => `${requestId}${suffix(version)}.pdf`;
/** FY27-042.json, FY27-042-v2.json */
export const storedRequestName = (requestId: string, version: number) => `${requestId}${suffix(version)}.json`;
/** FY27-042-cosigned.pdf, FY27-042-v2-cosigned.pdf */
export const cosignedName = (requestId: string, version: number) => `${requestId}${suffix(version)}-cosigned.pdf`;
/** The FO10 with the first check signer's signature: FY27-042-fo10-1.pdf, FY27-042-v2-fo10-1.pdf */
export const fo10Name = (requestId: string, version: number) => `${requestId}${suffix(version)}-fo10-1.pdf`;
/** The packet AP pays a mailed check from: FY27-042-authorized.pdf, FY27-042-v2-authorized.pdf */
export const authorizedName = (requestId: string, version: number) => `${requestId}${suffix(version)}-authorized.pdf`;

/**
 * The request's folder in Drive: requests/FY27/FY27-042. The year comes from
 * the ID, the year the request was first submitted, so a version signed again
 * after July 1 stays beside the first. A hand-typed ID without one falls back
 * to the year it was signed.
 */
export function requestFolder(row: Pick<RequestRow, "request_id" | "submitted_at">): string[] {
  const year = /^FY\d{2}(?=-)/.exec(row.request_id)?.[0] ?? fiscalYearLabel(new Date(row.submitted_at));
  return ["requests", year, row.request_id];
}

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
  // Requests saved before a field existed read it as blank.
  return { ...raw, request: { ...raw.request, event: raw.request.event ?? "", address: raw.request.address ?? "", cityStateZip: raw.request.cityStateZip ?? "" } };
}
