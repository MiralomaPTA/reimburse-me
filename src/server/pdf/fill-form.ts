import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFTextField } from "pdf-lib";
import { formatDateShort } from "@/lib/dates";
import { moneyPlain } from "@/lib/money";
import { CHECK_DELIVERY_LABEL, splitPhone, totals, type RequestInput } from "@/lib/request-schema";
import { fitFontSize, winAnsi } from "@/server/pdf/text";
import { FIELDS } from "@/server/pdf/template";
import type { PacketSignature } from "@/server/pdf/types";

export const SCHEDULE_LINE_TEXT = "Additional items – see schedule";

/** What goes on the form's four expenditure lines, given any number of items. */
export function formLines(items: RequestInput["items"]): { description: string; amountCents: number }[] {
  if (items.length <= 4) return items.map((i) => ({ description: i.description, amountCents: i.amountCents }));
  const rest = items.slice(3).reduce((sum, i) => sum + i.amountCents, 0);
  return [...items.slice(0, 3).map((i) => ({ description: i.description, amountCents: i.amountCents })), { description: SCHEDULE_LINE_TEXT, amountCents: rest }];
}

/**
 * The template's DA strings store the font name with an octal-escaped slash
 * (\057Helv), which pdf-lib does not decode, so set a clean DA ourselves
 * rather than going through setFontSize().
 */
function setFontSize(field: PDFTextField, size: number) {
  field.acroField.setDefaultAppearance(`/Helv ${size} Tf 0 g`);
}

function setFitted(field: PDFTextField, font: PDFFont, text: string, max = 10) {
  const clean = winAnsi(text);
  const rect = field.acroField.getWidgets()[0].getRectangle();
  field.setText(clean);
  setFontSize(field, fitFontSize(font, clean, rect.width - 4, max));
}

export interface FillOptions {
  doc: PDFDocument;
  request: RequestInput;
  requesterEmail: string;
  signedAt: Date;
  signature: PacketSignature | null;
}

/** Fills page 1 of the template in place and flattens the form. */
export async function fillForm({ doc, request, requesterEmail, signedAt, signature }: FillOptions): Promise<void> {
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const form = doc.getForm();
  const page = doc.getPage(0);
  const text = (name: string) => form.getTextField(name);

  setFitted(text(FIELDS.payeeName), helv, request.payeeName);
  setFitted(text(FIELDS.ptaPosition), helv, request.ptaPosition);
  if (request.checkDelivery === "mail") {
    setFitted(text(FIELDS.address), helv, request.address);
    setFitted(text(FIELDS.cityZip), helv, request.cityZip);
  }
  const phone = splitPhone(request.phone);
  setFitted(text(FIELDS.phoneArea), helv, phone.area);
  setFitted(text(FIELDS.phoneNumber), helv, phone.number);
  setFitted(text(FIELDS.email), helv, requesterEmail);
  setFitted(text(FIELDS.purpose), helv, request.purpose);

  const lines = formLines(request.items);
  ([1, 2, 3, 4] as const).forEach((n) => {
    const line = lines[n - 1];
    if (!line) return;
    setFitted(text(FIELDS.itemDescription(n)), helv, line.description, 9);
    setFitted(text(FIELDS.itemAmount(n)), helv, moneyPlain(line.amountCents), 9);
  });

  const t = totals(request);
  setFitted(text(FIELDS.totalExpense), helv, moneyPlain(t.totalCents), 9);
  setFitted(text(FIELDS.totalClaimed), helv, moneyPlain(t.totalCents), 9);
  setFitted(text(FIELDS.advanceReceived), helv, "0.00", 9);
  setFitted(text(FIELDS.reimbursementClaimed), helv, moneyPlain(t.reimbursementCents), 9);
  setFitted(text(FIELDS.donationToPta), helv, moneyPlain(t.donationCents), 9);
  setFitted(text(FIELDS.refundToPta), helv, "0.00", 9);

  // Check delivery is not on the PTA form; note it in the free space to the
  // right of "Expenditure was for".
  page.drawText(winAnsi(`Check: ${CHECK_DELIVERY_LABEL[request.checkDelivery]}`), {
    x: 412,
    y: 511,
    size: 7.5,
    font: helv,
    color: rgb(0.25, 0.25, 0.25),
  });

  const sigField = text(FIELDS.requesterSignature);
  if (signature) {
    setFitted(text(FIELDS.requesterSignatureDate), helv, formatDateShort(signedAt));
  }
  form.updateFieldAppearances(helv);

  if (signature?.type === "typed") {
    const rect = sigField.acroField.getWidgets()[0].getRectangle();
    const clean = winAnsi(signature.name);
    sigField.setText(clean);
    setFontSize(sigField, fitFontSize(oblique, clean, rect.width - 6, 13, 7));
    sigField.updateAppearances(oblique);
  } else if (signature?.type === "drawn") {
    // Draw the image sitting on the signature line, allowed to rise above it
    // the way an ink signature would.
    const rect = sigField.acroField.getWidgets()[0].getRectangle();
    const png = await doc.embedPng(signature.png);
    const maxHeight = 34;
    const maxWidth = rect.width - 4;
    const scale = Math.min(maxHeight / png.height, maxWidth / png.width);
    page.drawImage(png, {
      x: rect.x + 2,
      y: rect.y + 2,
      width: png.width * scale,
      height: png.height * scale,
    });
  }

  form.flatten({ updateFieldAppearances: false });
}
