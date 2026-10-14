import type { RequestInput } from "@/lib/request-schema";

export interface ReceiptFile {
  fileId: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export type PacketSignature = { type: "typed"; name: string } | { type: "drawn"; png: Uint8Array };

export interface AuditInfo {
  requesterEmail: string;
  signInMethod: string;
  signedInAt: Date;
  ip: string;
  userAgent: string;
  consentText: string;
}

export interface PacketInput {
  /** e.g. FY27-042, or "PREVIEW" before signing. */
  requestId: string;
  submittedAt: Date;
  request: RequestInput;
  requesterEmail: string;
  /** Keyed by fileId; every receipt referenced by the request must be present. */
  receiptFiles: Map<string, ReceiptFile>;
  /** null for the unsigned preview. */
  signature: PacketSignature | null;
  /** Present only when signing; produces the audit page. */
  audit: AuditInfo | null;
}

export interface Packet {
  bytes: Uint8Array;
  sha256: string;
  pageCount: number;
}

export const CONSENT_TEXT =
  "I agree to sign this reimbursement request electronically. I certify that the expenses listed were " +
  "made on behalf of the Miraloma Elementary PTA and that the attached receipts are accurate.";
