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

/** A rectangle on one page of a packet: where a line of the form ended up after the expenditures were laid out. */
export interface LineBox {
  /** Zero-based page index in the packet. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Packet {
  bytes: Uint8Array;
  sha256: string;
  pageCount: number;
  /**
   * Where the form's VP/Chairman line landed. It moves with the length of the
   * expenditure list, so it is recorded with the request and the event chair's
   * signature can be stamped there later without rebuilding the packet.
   */
  chairLine: LineBox;
}

export const CONSENT_TEXT =
  "I agree to sign this reimbursement request electronically. I certify that the expenses listed were " +
  "made on behalf of the Miraloma Elementary PTA and that the attached receipts are accurate.";

/** What an event chair agrees to by signing the VP/Chairman line. */
export const chairConsentText = (event: string) =>
  `I agree to sign this reimbursement request electronically as chair of ${event}. ` +
  `I confirm that, to my knowledge, the expenses listed were made for ${event}.`;
