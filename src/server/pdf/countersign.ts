import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { formatDateShort } from "@/lib/dates";
import { eventLabel } from "@/lib/events";
import { drawChairCaption, signatureArea } from "@/server/pdf/chair-line";
import { appendCountersignaturePage, stampAddedFooters } from "@/server/pdf/pages";
import { fitFontSize, winAnsi } from "@/server/pdf/text";
import type { LineBox, PacketSignature } from "@/server/pdf/types";

/** A drawn signature may rise this far above the line, short of the requester's signature line above it. */
const MAX_DRAWN_HEIGHT = 18;

export interface CountersignInput {
  /** The packet as the requester signed it. It is read, never changed. */
  packet: Uint8Array;
  requesterSha256: string;
  requestId: string;
  /** Where the VP/Chairman line is, as recorded when the packet was built. */
  chairLine: LineBox;
  event: string;
  payeeName: string;
  /** The name the chair signs under, printed beside the line. */
  name: string;
  signature: PacketSignature;
  signedAt: Date;
  chairEmail: string;
  linkSentAt: Date | null;
  ip: string;
  userAgent: string;
  consentText: string;
  note: string;
}

export interface CountersignedPacket {
  bytes: Uint8Array;
  sha256: string;
  pageCount: number;
}

/**
 * The co-signed packet: a copy of the requester-signed packet with the
 * chair's signature, name and date on the VP/Chairman line and a
 * countersignature page at the end. The requester's file stays as it was;
 * this is a second file.
 */
export async function countersignPacket(input: CountersignInput): Promise<CountersignedPacket> {
  const doc = await PDFDocument.load(input.packet);
  const requesterPages = doc.getPageCount();
  doc.setModificationDate(input.signedAt);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const line = input.chairLine;
  const page = doc.getPage(line.page);

  const caption = `${input.name}, ${formatDateShort(input.signedAt)}`;
  drawChairCaption(page, helv, line, caption);
  const area = signatureArea(helv, line, [eventLabel(input.event), caption]);
  if (input.signature.type === "typed") {
    const text = winAnsi(input.signature.name);
    page.drawText(text, { x: area.x, y: area.y, size: fitFontSize(oblique, text, area.width, 13, 7), font: oblique });
  } else {
    const png = await doc.embedPng(input.signature.png);
    const scale = Math.min(MAX_DRAWN_HEIGHT / png.height, area.width / png.width);
    page.drawImage(png, { x: area.x, y: area.y - 2, width: png.width * scale, height: png.height * scale });
  }

  await appendCountersignaturePage(doc, {
    requestId: input.requestId,
    event: input.event,
    payeeName: input.payeeName,
    name: input.name,
    signature: input.signature,
    signedAt: input.signedAt,
    chairEmail: input.chairEmail,
    linkSentAt: input.linkSentAt,
    ip: input.ip,
    userAgent: input.userAgent,
    consentText: input.consentText,
    requesterSha256: input.requesterSha256,
    requesterPages,
    note: input.note,
  });
  await stampAddedFooters(doc, requesterPages, input.requestId, input.signedAt);

  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), pageCount: doc.getPageCount() };
}
