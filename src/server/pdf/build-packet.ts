import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { fillForm } from "@/server/pdf/fill-form";
import { appendAuditPage, appendSchedule, stampFooters } from "@/server/pdf/pages";
import { appendReceipts } from "@/server/pdf/receipts";
import { templateBytes } from "@/server/pdf/template";
import type { Packet, PacketInput } from "@/server/pdf/types";

/**
 * Assembles the packet: filled PTA form, schedule page when there are more
 * than four items, one page per receipt image (or the receipt PDF's pages),
 * and, when signed, the audit page. Footers go on every page last.
 */
export async function buildPacket(input: PacketInput): Promise<Packet> {
  const { request, requestId, submittedAt, signature, audit } = input;
  const doc = await PDFDocument.load(await templateBytes());
  doc.setTitle(`PTA reimbursement request ${requestId}`);
  doc.setAuthor(request.payeeName);
  doc.setProducer("Miraloma PTA reimbursement portal");
  doc.setCreationDate(submittedAt);
  doc.setModificationDate(submittedAt);

  await fillForm({ doc, request, requesterEmail: input.requesterEmail, signedAt: submittedAt, signature });
  if (request.items.length > 4) await appendSchedule(doc, request, requestId);
  await appendReceipts(doc, request, input.receiptFiles, requestId);

  const receiptCount = new Set(request.items.flatMap((item) => item.receipts.map((r) => r.fileId))).size;
  if (signature && audit) {
    await appendAuditPage(doc, {
      requestId,
      request,
      submittedAt,
      signature,
      audit,
      receiptCount,
      pagesBeforeAudit: doc.getPageCount(),
    });
  }
  await stampFooters(doc, requestId, submittedAt, !signature);

  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), pageCount: doc.getPageCount() };
}
