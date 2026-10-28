import { PDFDocument, StandardFonts, type PDFFont, type PDFTextField } from "pdf-lib";
import { formatDateShort } from "@/lib/dates";
import { splitPhone, type RequestInput } from "@/lib/request-schema";
import { fitFontSize, winAnsi } from "@/server/pdf/text";
import { FIELDS } from "@/server/pdf/template";
import type { PacketSignature } from "@/server/pdf/types";

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
  /** The loaded template; its first page is filled in place. */
  doc: PDFDocument;
  request: RequestInput;
  requesterEmail: string;
  signedAt: Date;
  signature: PacketSignature | null;
}

/**
 * Fills the payee details and signature on page 1 of the template and
 * flattens the form. The purpose, expenditure and total fields stay empty:
 * that part of the page is redrawn by form-pages.ts so the list can grow.
 */
export async function fillForm({ doc, request, requesterEmail, signedAt, signature }: FillOptions): Promise<void> {
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const form = doc.getForm();
  const page = doc.getPage(0);
  const text = (name: string) => form.getTextField(name);

  setFitted(text(FIELDS.payeeName), helv, request.payeeName);
  setFitted(text(FIELDS.ptaPosition), helv, request.ptaPosition);
  const phone = splitPhone(request.phone);
  setFitted(text(FIELDS.phoneArea), helv, phone.area);
  setFitted(text(FIELDS.phoneNumber), helv, phone.number);
  setFitted(text(FIELDS.email), helv, requesterEmail);

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
