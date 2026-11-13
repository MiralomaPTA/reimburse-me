import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { config } from "@/server/config";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { totals, type RequestInput } from "@/lib/request-schema";
import { winAnsi, wrap } from "@/server/pdf/text";
import type { AuditInfo, PacketSignature } from "@/server/pdf/types";

const LETTER = [612, 792] as [number, number];
const MARGIN = 54;
const BODY = 10;

class Writer {
  y: number;
  page: PDFPage;
  constructor(
    private doc: PDFDocument,
    private helv: PDFFont,
    private bold: PDFFont,
  ) {
    this.page = doc.addPage(LETTER);
    this.y = LETTER[1] - MARGIN;
  }
  private ensure(height: number) {
    if (this.y - height < MARGIN + 20) {
      this.page = this.doc.addPage(LETTER);
      this.y = LETTER[1] - MARGIN;
    }
  }
  heading(text: string) {
    this.ensure(30);
    this.page.drawText(winAnsi(text), { x: MARGIN, y: this.y - 16, size: 16, font: this.bold });
    this.y -= 30;
  }
  sub(text: string) {
    this.ensure(18);
    this.page.drawText(winAnsi(text), { x: MARGIN, y: this.y - 12, size: 11, font: this.bold });
    this.y -= 18;
  }
  paragraph(text: string, size = BODY, font = this.helv) {
    const lines = wrap(font, winAnsi(text), size, LETTER[0] - MARGIN * 2);
    for (const line of lines) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font });
      this.y -= size + 4;
    }
    this.y -= 4;
  }
  field(label: string, value: string) {
    const labelWidth = 130;
    const lines = wrap(this.helv, winAnsi(value), BODY, LETTER[0] - MARGIN * 2 - labelWidth);
    this.ensure((BODY + 4) * lines.length);
    this.page.drawText(winAnsi(label), { x: MARGIN, y: this.y - BODY, size: BODY, font: this.bold });
    lines.forEach((line) => {
      this.page.drawText(line, { x: MARGIN + labelWidth, y: this.y - BODY, size: BODY, font: this.helv });
      this.y -= BODY + 4;
    });
    this.y -= 2;
  }
  row(cells: { text: string; x: number; width: number; align?: "right"; bold?: boolean }[]) {
    const font = cells.some((c) => c.bold) ? this.bold : this.helv;
    const wrapped = cells.map((c) => wrap(font, winAnsi(c.text), BODY, c.width));
    const height = Math.max(...wrapped.map((w) => w.length)) * (BODY + 3);
    this.ensure(height + 2);
    cells.forEach((cell, i) => {
      wrapped[i].forEach((line, l) => {
        const w = font.widthOfTextAtSize(line, BODY);
        const x = cell.align === "right" ? cell.x + cell.width - w : cell.x;
        this.page.drawText(line, { x, y: this.y - BODY - l * (BODY + 3), size: BODY, font });
      });
    });
    this.y -= height + 2;
  }
  rule() {
    this.ensure(8);
    this.page.drawLine({ start: { x: MARGIN, y: this.y - 2 }, end: { x: LETTER[0] - MARGIN, y: this.y - 2 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
    this.y -= 8;
  }
  space(h = 10) {
    this.y -= h;
  }
}

async function writer(doc: PDFDocument) {
  return new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
}

export interface AuditPageInput {
  requestId: string;
  request: RequestInput;
  submittedAt: Date;
  signature: PacketSignature;
  audit: AuditInfo;
  receiptCount: number;
  /** How many pages the form itself took. */
  formPages: number;
  pagesBeforeAudit: number;
}

/** The last page: who signed, how, when and from where. */
export async function appendAuditPage(doc: PDFDocument, input: AuditPageInput): Promise<void> {
  const { requestId, request, submittedAt, signature, audit } = input;
  const w = await writer(doc);
  w.heading("Electronic signature record");
  w.paragraph(`This page was added by the Miraloma PTA reimbursement portal when request ${requestId} was signed and submitted.`);
  w.space(6);
  w.sub("Signer");
  w.field("Name", request.payeeName);
  w.field("Email", audit.requesterEmail);
  w.field("PTA position", request.ptaPosition);
  w.field("Signed in by", `${audit.signInMethod}, link used ${formatDateTime(audit.signedInAt)}`);
  w.space(6);
  w.sub("Signature");
  w.field("Method", signature.type === "typed" ? `Typed name: "${signature.name}"` : "Drawn with finger or mouse");
  w.field("Signed at", `${formatDateTime(submittedAt)} (${submittedAt.toISOString()})`);
  w.field("IP address", audit.ip || "unknown");
  w.field("Browser", audit.userAgent || "unknown");
  w.field("Consent", audit.consentText);
  w.space(6);
  w.sub("Document");
  w.field("Request", requestId);
  w.field("Purpose", request.purpose);
  if (request.event) w.field("Event", request.event);
  w.field("Line items", `${request.items.length}, total ${formatMoney(totals(request).totalCents)}`);
  w.field("Receipts", `${input.receiptCount} file${input.receiptCount === 1 ? "" : "s"}`);
  w.field("Pages", `${input.pagesBeforeAudit} before this record: the PTA form (${input.formPages} page${input.formPages === 1 ? "" : "s"}), then the receipts`);
  w.space(6);
  w.sub("Integrity");
  // A request for an event goes to its chair first, so the email carrying the hash isn't always the one to AP.
  const emailedTo = request.event
    ? "the emails sent when it was signed"
    : config.sendPacketsTo === "ap"
      ? `the submission email to ${config.apEmail}`
      : `the email sent to ${audit.requesterEmail}`;
  w.paragraph(
    `The SHA-256 hash of this file is recorded in the PTA's request log and in ${emailedTo}. ` +
      "Any change to the file after signing changes that hash. A corrected request is signed again and gets a new version.",
  );
}

export interface CountersignaturePageInput {
  requestId: string;
  event: string;
  payeeName: string;
  /** The name the chair signed under. */
  name: string;
  signature: PacketSignature;
  signedAt: Date;
  /** The address the signing link was emailed to. */
  chairEmail: string;
  /** When that email went out, if known. */
  linkSentAt: Date | null;
  ip: string;
  userAgent: string;
  consentText: string;
  /** The packet the requester signed, which this one extends. */
  requesterSha256: string;
  requesterPages: number;
  note: string;
}

/** Added after the requester's audit page when the event chair signs: who countersigned, how, and what. */
export async function appendCountersignaturePage(doc: PDFDocument, input: CountersignaturePageInput): Promise<void> {
  const w = await writer(doc);
  w.heading("Event chair signature record");
  w.paragraph(
    `This page was added by the Miraloma PTA reimbursement portal when the ${input.event} chair signed request ${input.requestId}. ` +
      `The ${input.requesterPages} pages before it are the packet ${input.payeeName} signed, with the chair's signature added on the VP/Chairman line.`,
  );
  w.space(6);
  w.sub("Signer");
  w.field("Name", input.name);
  w.field("Email", input.chairEmail);
  w.field("Signed as", `Chair, ${input.event}`);
  w.field("Signing link", `Emailed to ${input.chairEmail}${input.linkSentAt ? ` on ${formatDateTime(input.linkSentAt)}` : ""}; the link works only for this request`);
  w.space(6);
  w.sub("Signature");
  w.field("Method", input.signature.type === "typed" ? `Typed name: "${input.signature.name}"` : "Drawn with finger or mouse");
  w.field("Signed at", `${formatDateTime(input.signedAt)} (${input.signedAt.toISOString()})`);
  w.field("IP address", input.ip || "unknown");
  w.field("Browser", input.userAgent || "unknown");
  w.field("Consent", input.consentText);
  if (input.note) {
    w.space(6);
    w.sub("Note to the PTA");
    w.paragraph(input.note);
  }
  w.space(6);
  w.sub("Integrity");
  w.field("Requester-signed", `SHA-256 ${input.requesterSha256}`);
  w.paragraph(
    "That is the hash recorded when the requester signed; their file is kept unchanged beside this one. " +
      "The SHA-256 of this co-signed file is recorded in the PTA's request log and in the email that sent it on.",
  );
}

/** Footers for pages added after the packet was first signed; the original pages keep theirs. */
export async function stampAddedFooters(doc: PDFDocument, fromIndex: number, requestId: string, addedAt: Date): Promise<void> {
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const left = `Request ${requestId} - chair signature added ${formatDateTime(addedAt)}`;
  doc.getPages().forEach((page, i) => {
    if (i < fromIndex) return;
    const { width } = page.getSize();
    const right = `Page ${i + 1} (added)`;
    page.drawText(winAnsi(left), { x: 36, y: 16, size: 7.5, font: helv, color: rgb(0.35, 0.35, 0.35) });
    page.drawText(right, { x: width - 36 - helv.widthOfTextAtSize(right, 7.5), y: 16, size: 7.5, font: helv, color: rgb(0.35, 0.35, 0.35) });
  });
}

/** Request ID, timestamp and page numbers on every page. */
export async function stampFooters(doc: PDFDocument, requestId: string, submittedAt: Date, preview: boolean): Promise<void> {
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const left = preview ? "PREVIEW - not yet signed" : `Request ${requestId} - submitted ${formatDateTime(submittedAt)}`;
  pages.forEach((page, i) => {
    const { width } = page.getSize();
    const right = `Page ${i + 1} of ${pages.length}`;
    page.drawText(winAnsi(left), { x: 36, y: 16, size: 7.5, font: helv, color: rgb(0.35, 0.35, 0.35) });
    page.drawText(right, { x: width - 36 - helv.widthOfTextAtSize(right, 7.5), y: 16, size: 7.5, font: helv, color: rgb(0.35, 0.35, 0.35) });
  });
}
