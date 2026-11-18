import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatDateShort, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { splitPhone } from "@/lib/request-schema";
import { setFitted } from "@/server/pdf/fill-form";
import { appendSignersPage, type SignersPageInput } from "@/server/pdf/pages";
import { fitFontSize, fitText, winAnsi } from "@/server/pdf/text";
import type { PacketSignature } from "@/server/pdf/types";

/**
 * CAPTA's "Authorization for Payment via Electronic Services" (FO10), which
 * every bill pay payment needs, signed by two check signers. The app's copy
 * (assets/fo10-template.pdf, made by scripts/make-fo10-template.mjs) is the
 * official PDF with its fields renamed. Nobody signs it but the check signers,
 * so it is filled in fresh whenever it's needed: unsigned for the first
 * signer to look at, then with each signature stamped on its Authorized By
 * line. The form is one page whose lines never move, so the signatures go
 * where the template's fields are.
 */

let cached: Uint8Array | null = null;

export async function fo10TemplateBytes(): Promise<Uint8Array> {
  if (!cached) cached = new Uint8Array(await fs.readFile(path.join(process.cwd(), "assets", "fo10-template.pdf")));
  return cached;
}

/** Field names in the template. The treasurer block's fields (treasurer_…) are never filled. */
export const FO10_FIELDS = {
  date: "date",
  vendorName: "vendor_name",
  address: "address",
  cityStateZip: "city_state_zip",
  phoneArea: "phone_area_code",
  phoneNumber: "phone_number",
  email: "email",
  budgetAccount: "budget_account",
  reason: "reason",
  paymentAccount: "payment_account",
  paymentAmount: "payment_amount",
  requestedBy: "requested_by",
  signature: (slot: 1 | 2) => `signer_${slot}_signature`,
  signatureDate: (slot: 1 | 2) => `signer_${slot}_date`,
} as const;

/** What the FO10 says. Everything but the two accounts comes from the request as the requester signed it. */
export interface Fo10Details {
  requestId: string;
  /** When the requester signed: the FO10's Date. */
  signedAt: Date;
  payeeName: string;
  ptaPosition: string;
  address: string;
  cityStateZip: string;
  phone: string;
  /** The requester's sign-in address. */
  email: string;
  purpose: string;
  /** The reimbursement claimed, after any donation to the PTA. */
  amountCents: number;
  budgetAccount: string;
  paymentAccount: string;
}

export interface Fo10Signature {
  slot: 1 | 2;
  /** The name the signer signed under, printed small at the right end of the line: the form has no box for it. */
  name: string;
  signature: PacketSignature;
  signedAt: Date;
}

export interface Fo10File {
  bytes: Uint8Array;
  sha256: string;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** "Reimbursement FY27-042: Classroom supplies" */
export const fo10Reason = (requestId: string, purpose: string) => `Reimbursement ${requestId}: ${purpose}`;
/** "Harvey Milk, 2nd grade teacher" */
export const fo10RequestedBy = (payeeName: string, ptaPosition: string) => `${payeeName}, ${ptaPosition}`;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where each Authorized By line and its Date box are, read from the template once. */
async function signatureRects(): Promise<Record<1 | 2, { line: Rect; date: Rect }>> {
  const template = await PDFDocument.load(await fo10TemplateBytes());
  const form = template.getForm();
  const rect = (name: string) => form.getTextField(name).acroField.getWidgets()[0].getRectangle();
  return {
    1: { line: rect(FO10_FIELDS.signature(1)), date: rect(FO10_FIELDS.signatureDate(1)) },
    2: { line: rect(FO10_FIELDS.signature(2)), date: rect(FO10_FIELDS.signatureDate(2)) },
  };
}

let rects: Promise<Record<1 | 2, { line: Rect; date: Rect }>> | null = null;
const fo10SignatureRects = () => (rects ??= signatureRects());

const NAME_SIZE = 7;
const GRAY = rgb(0.25, 0.25, 0.25);
/** A drawn signature may rise this far above the line, short of the "(Authorized Check Signer)" caption of the line above. */
const MAX_DRAWN_HEIGHT = 18;

/** Stamps one check signer's signature, name and date on their Authorized By line. */
async function stampSignature(doc: PDFDocument, page: PDFPage, fonts: { helv: PDFFont; oblique: PDFFont }, signer: Fo10Signature) {
  const { line, date } = (await fo10SignatureRects())[signer.slot];
  const baseline = line.y + 5;
  // The name, right-aligned at the end of the line, given at most 40% of it.
  const name = fitText(fonts.helv, signer.name, NAME_SIZE, line.width * 0.4);
  const nameWidth = fonts.helv.widthOfTextAtSize(name, NAME_SIZE);
  page.drawText(name, { x: line.x + line.width - 2 - nameWidth, y: baseline, size: NAME_SIZE, font: fonts.helv, color: GRAY });
  const area = { x: line.x + 4, width: Math.max(1, line.width - nameWidth - 16) };
  if (signer.signature.type === "typed") {
    const text = winAnsi(signer.signature.name);
    const size = fitFontSize(fonts.oblique, text, area.width, 13, 6);
    page.drawText(fitText(fonts.oblique, text, size, area.width), { x: area.x, y: baseline, size, font: fonts.oblique });
  } else {
    const png = await doc.embedPng(signer.signature.png);
    const scale = Math.min(MAX_DRAWN_HEIGHT / png.height, area.width / png.width);
    page.drawImage(png, { x: area.x, y: baseline - 3, width: png.width * scale, height: png.height * scale });
  }
  page.drawText(formatDateShort(signer.signedAt), { x: date.x + 4, y: baseline, size: 10, font: fonts.helv });
}

/**
 * The FO10 filled in from `details` and flattened, with `signatures` stamped
 * on their lines: none for the first signer to review, the first signer's
 * for the copy the second signer sees.
 */
export async function fillFo10(details: Fo10Details, signatures: Fo10Signature[] = []): Promise<Fo10File> {
  const doc = await PDFDocument.load(await fo10TemplateBytes());
  doc.setTitle(`Authorization for payment ${details.requestId}`);
  doc.setProducer("Miraloma PTA reimbursement portal");
  const latest = signatures.reduce((at, s) => (s.signedAt > at ? s.signedAt : at), details.signedAt);
  doc.setCreationDate(details.signedAt);
  doc.setModificationDate(latest);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const form = doc.getForm();
  const text = (name: string) => form.getTextField(name);
  const phone = splitPhone(details.phone);

  setFitted(text(FO10_FIELDS.date), helv, formatDateShort(details.signedAt));
  setFitted(text(FO10_FIELDS.vendorName), helv, details.payeeName);
  setFitted(text(FO10_FIELDS.address), helv, details.address);
  setFitted(text(FO10_FIELDS.cityStateZip), helv, details.cityStateZip);
  setFitted(text(FO10_FIELDS.phoneArea), helv, phone.area);
  setFitted(text(FO10_FIELDS.phoneNumber), helv, phone.number);
  setFitted(text(FO10_FIELDS.email), helv, details.email);
  setFitted(text(FO10_FIELDS.budgetAccount), helv, details.budgetAccount);
  setFitted(text(FO10_FIELDS.reason), helv, fo10Reason(details.requestId, details.purpose));
  setFitted(text(FO10_FIELDS.paymentAccount), helv, details.paymentAccount);
  setFitted(text(FO10_FIELDS.paymentAmount), helv, formatMoney(details.amountCents));
  setFitted(text(FO10_FIELDS.requestedBy), helv, fo10RequestedBy(details.payeeName, details.ptaPosition));
  form.updateFieldAppearances(helv);
  form.flatten({ updateFieldAppearances: false });

  const page = doc.getPage(0);
  for (const signer of signatures) await stampSignature(doc, page, { helv, oblique }, signer);
  const footer = winAnsi(`Request ${details.requestId} - filled in by the Miraloma PTA reimbursement portal from the signed request`);
  page.drawText(footer, { x: 36, y: 16, size: 7.5, font: helv, color: rgb(0.35, 0.35, 0.35) });

  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, sha256: sha256(bytes) };
}

/** The first-signature FO10 with the second signer's signature added, for the authorized packet. The first-signature file is read, never changed. */
export async function addSecondSignature(fo10: Uint8Array, signer: Omit<Fo10Signature, "slot">): Promise<Uint8Array> {
  const doc = await PDFDocument.load(fo10);
  doc.setModificationDate(signer.signedAt);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  await stampSignature(doc, doc.getPage(0), { helv, oblique }, { ...signer, slot: 2 });
  return doc.save({ useObjectStreams: true });
}

export interface AuthorizedPacketInput {
  requestId: string;
  /** The FO10 signed by both check signers. */
  fo10: Uint8Array;
  /** The packet the signers authorized, co-signed or requester-signed. Its pages go in unchanged. */
  packet: Uint8Array;
  page: Omit<SignersPageInput, "packetPages">;
  authorizedAt: Date;
}

export interface AuthorizedPacket {
  bytes: Uint8Array;
  sha256: string;
  pageCount: number;
}

/**
 * The packet AP pays from: the signed FO10 first, as CAPTA asks ("attach all
 * invoices and the original signed request for payment"), then every page of
 * the packet the signers authorized, unchanged, then a page recording the
 * authorization.
 */
export async function buildAuthorizedPacket(input: AuthorizedPacketInput): Promise<AuthorizedPacket> {
  const doc = await PDFDocument.load(input.packet);
  const packetPages = doc.getPageCount();
  doc.setTitle(`PTA reimbursement request ${input.requestId}, authorized for bill pay`);
  doc.setModificationDate(input.authorizedAt);
  const [fo10Page] = await doc.copyPages(await PDFDocument.load(input.fo10), [0]);
  doc.insertPage(0, fo10Page);
  await appendSignersPage(doc, { ...input.page, packetPages });

  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const added = `Request ${input.requestId} - check signers' authorization added ${formatDateTime(input.authorizedAt)}`;
  doc.getPages().forEach((page, i) => {
    if (i > 0 && i <= packetPages) return;
    const { width } = page.getSize();
    const right = `Page ${i + 1} (added)`;
    // The FO10 already carries its own footer line; the added label goes above it.
    page.drawText(winAnsi(added), { x: 36, y: i === 0 ? 26 : 16, size: 7.5, font: helv, color: rgb(0.35, 0.35, 0.35) });
    page.drawText(right, { x: width - 36 - helv.widthOfTextAtSize(right, 7.5), y: i === 0 ? 26 : 16, size: 7.5, font: helv, color: rgb(0.35, 0.35, 0.35) });
  });

  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, sha256: sha256(bytes), pageCount: doc.getPageCount() };
}
