import { getAdapters } from "@/server/adapters";
import type { RequestRow } from "@/server/adapters/types";
import type { Session } from "@/server/auth/tokens";
import { config } from "@/server/config";
import { apSubmissionEmail, requesterCopyEmail } from "@/server/email/templates";
import { buildPacket } from "@/server/pdf/build-packet";
import { CONSENT_TEXT, type PacketSignature } from "@/server/pdf/types";
import { loadReceiptFiles } from "@/server/requests/receipts";
import { fiscalYearLabel, formatRequestId, requestIdPrefix } from "@/lib/fiscal-year";
import { moneyPlain } from "@/lib/money";
import { totals, type RequestInput, type SignatureInput } from "@/lib/request-schema";

export interface SubmitInput {
  request: RequestInput;
  signature: SignatureInput;
  session: Session;
  ip: string;
  userAgent: string;
}

export interface SubmitResult {
  requestId: string;
  pdfFileId: string;
  sha256: string;
  pageCount: number;
  /** false when the row was written but the email could not be sent. */
  emailed: boolean;
  emailError?: string;
}

function toPacketSignature(signature: SignatureInput): PacketSignature {
  if (signature.type === "typed") return { type: "typed", name: signature.name };
  const base64 = signature.pngDataUrl.slice("data:image/png;base64,".length);
  return { type: "drawn", png: new Uint8Array(Buffer.from(base64, "base64")) };
}

/** Signs, stores, logs and emails a new request. */
export async function submitRequest(input: SubmitInput): Promise<SubmitResult> {
  const { request, session, ip, userAgent } = input;
  const { files, log, mailer } = await getAdapters();
  const submittedAt = new Date();
  const receiptFiles = await loadReceiptFiles(request, session.email);

  const prefix = requestIdPrefix(submittedAt);
  const requestId = formatRequestId(prefix, (await log.maxSequence(prefix)) + 1);
  const signature = toPacketSignature(input.signature);

  const packet = await buildPacket({
    requestId,
    submittedAt,
    request,
    requesterEmail: session.email,
    receiptFiles,
    signature,
    audit: {
      requesterEmail: session.email,
      signInMethod: "One-time email link",
      signedInAt: new Date(session.signedInAt),
      ip,
      userAgent,
      consentText: CONSENT_TEXT,
    },
  });

  const folderPath = ["requests", fiscalYearLabel(submittedAt), requestId];
  const pdfName = `${requestId}.pdf`;
  const stored = await files.putFile({ name: pdfName, mimeType: "application/pdf", bytes: packet.bytes, folderPath });
  await Promise.all([...receiptFiles.keys()].map((id) => files.moveFile(id, folderPath)));

  const t = totals(request);
  const row: RequestRow = {
    request_id: requestId,
    status: "Submitted",
    submitted_at: submittedAt.toISOString(),
    requester_email: session.email,
    payee_name: request.payeeName,
    pta_position: request.ptaPosition,
    phone: request.phone,
    check_delivery: request.checkDelivery,
    address: request.checkDelivery === "mail" ? request.address : "",
    city_zip: request.checkDelivery === "mail" ? request.cityZip : "",
    purpose: request.purpose,
    line_count: request.items.length,
    receipt_count: receiptFiles.size,
    total_expense: moneyPlain(t.totalCents),
    donation_to_pta: moneyPlain(t.donationCents),
    reimbursement_claimed: moneyPlain(t.reimbursementCents),
    pdf_file_id: stored.id,
    pdf_sha256: packet.sha256,
    signature_type: signature.type,
    budget_category: "",
    check_number: "",
    paid_date: "",
    returned_note: "",
    version: 1,
    updated_at: submittedAt.toISOString(),
    notes: "",
  };
  await log.append(row);

  const emailInput = { requestId, request, requesterEmail: session.email, submittedAt, sha256: packet.sha256, version: 1 };
  const attachment = { filename: pdfName, mimeType: "application/pdf", bytes: packet.bytes };
  try {
    const ap = apSubmissionEmail(emailInput);
    await mailer.send({ to: [config.apEmail], replyTo: session.email, subject: ap.subject, text: ap.text, attachments: [attachment] });
    const copy = requesterCopyEmail(emailInput);
    await mailer.send({ to: [session.email], subject: copy.subject, text: copy.text, attachments: [attachment] });
    return { requestId, pdfFileId: stored.id, sha256: packet.sha256, pageCount: packet.pageCount, emailed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[submit] email failed for ${requestId}: ${message}`);
    await log.update(requestId, { notes: `Email failed at submission: ${message}` }).catch(() => undefined);
    return { requestId, pdfFileId: stored.id, sha256: packet.sha256, pageCount: packet.pageCount, emailed: false, emailError: message };
  }
}
