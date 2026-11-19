import { sha256 } from "@/server/hash";
import { PDFDocument } from "pdf-lib";
import { fillForm } from "@/server/pdf/fill-form";
import { appendFormPages } from "@/server/pdf/form-pages";
import { appendAuditPage, stampFooters } from "@/server/pdf/pages";
import { appendReceipts } from "@/server/pdf/receipts";
import { templateBytes } from "@/server/pdf/template";
import type { Packet, PacketInput } from "@/server/pdf/types";

/**
 * Assembles the packet: the PTA form (as many pages as the expenditures
 * need), one page per receipt image (or the receipt PDF's pages), and, when
 * signed, the audit page. Footers go on every page last.
 */
export async function buildPacket(input: PacketInput): Promise<Packet> {
  const { request, requestId, submittedAt, signature, audit } = input;
  // "FY27-042 v2" wherever the packet names itself, so a printed copy says which version it is.
  const label = (input.version ?? 1) > 1 ? `${requestId} v${input.version}` : requestId;
  const doc = await PDFDocument.create();
  doc.setTitle(`PTA reimbursement request ${label}`);
  doc.setAuthor(request.payeeName);
  doc.setProducer("Miraloma PTA reimbursement portal");
  doc.setCreationDate(submittedAt);
  doc.setModificationDate(submittedAt);

  const template = await PDFDocument.load(await templateBytes());
  const { chairField } = await fillForm({ doc: template, request, requesterEmail: input.requesterEmail, signedAt: submittedAt, signature });
  const { pageCount: formPages, chairLine } = await appendFormPages(doc, template, request, chairField);
  await appendReceipts(doc, request, input.receiptFiles, requestId);

  const receiptCount = new Set(request.items.flatMap((item) => item.receipts.map((r) => r.fileId))).size;
  if (signature && audit) {
    await appendAuditPage(doc, {
      requestId,
      version: input.version ?? 1,
      request,
      submittedAt,
      signature,
      audit,
      receiptCount,
      formPages,
      pagesBeforeAudit: doc.getPageCount(),
    });
  }
  await stampFooters(doc, label, submittedAt, !signature);

  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, sha256: sha256(bytes), pageCount: doc.getPageCount(), chairLine };
}
