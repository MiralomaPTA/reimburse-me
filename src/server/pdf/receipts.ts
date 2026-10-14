import sharp from "sharp";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatMoney } from "@/lib/money";
import type { RequestInput } from "@/lib/request-schema";
import { winAnsi } from "@/server/pdf/text";
import type { ReceiptFile } from "@/server/pdf/types";

const LETTER = { width: 612, height: 792 } as const;
const MARGIN = 36;
const LABEL_BAND = 28;
const MAX_IMAGE_EDGE = 1600;
const JPEG_QUALITY = 80;
const MAX_PAGES_PER_PDF_RECEIPT = 20;

/** Normalize a photo for the packet: honor EXIF rotation, cap size, re-encode as JPEG. */
export async function normalizeImage(bytes: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(Buffer.from(bytes), { failOn: "none" })
    .rotate()
    .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  return new Uint8Array(out);
}

/** Appends one page per receipt image, or copies the pages of a receipt PDF, each labeled. */
export async function appendReceipts(doc: PDFDocument, request: RequestInput, files: Map<string, ReceiptFile>, requestId: string): Promise<void> {
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const drawLabel = (page: ReturnType<PDFDocument["addPage"]>, label: string, sub: string) => {
    const { width, height } = page.getSize();
    page.drawRectangle({ x: 0, y: height - LABEL_BAND, width, height: LABEL_BAND, color: rgb(1, 1, 1), opacity: 0.92 });
    page.drawText(winAnsi(label), { x: MARGIN, y: height - 18, size: 10, font: bold, color: rgb(0, 0, 0) });
    const subWidth = helv.widthOfTextAtSize(winAnsi(sub), 8);
    page.drawText(winAnsi(sub), { x: width - MARGIN - subWidth, y: height - 17, size: 8, font: helv, color: rgb(0.3, 0.3, 0.3) });
  };

  for (const [index, item] of request.items.entries()) {
    const lineNo = index + 1;
    for (const [rIndex, receipt] of item.receipts.entries()) {
      const file = files.get(receipt.fileId);
      if (!file) throw new Error(`Receipt file ${receipt.fileId} is missing`);
      const part = item.receipts.length > 1 ? ` (image ${rIndex + 1} of ${item.receipts.length})` : "";
      const label = `Line ${lineNo} of ${request.items.length}: ${item.description} - ${formatMoney(item.amountCents)}${part}`;
      const sub = `Request ${requestId}`;

      if (file.mimeType === "application/pdf") {
        const source = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
        const indices = source.getPageIndices().slice(0, MAX_PAGES_PER_PDF_RECEIPT);
        const pages = await doc.copyPages(source, indices);
        pages.forEach((page, p) => {
          doc.addPage(page);
          drawLabel(page, pages.length > 1 ? `${label} - page ${p + 1} of ${pages.length}` : label, sub);
        });
        continue;
      }

      const jpg = await doc.embedJpg(await normalizeImage(file.bytes));
      const page = doc.addPage([LETTER.width, LETTER.height]);
      const boxWidth = LETTER.width - MARGIN * 2;
      const boxHeight = LETTER.height - MARGIN * 2 - LABEL_BAND;
      const scale = Math.min(boxWidth / jpg.width, boxHeight / jpg.height, 1.5);
      const width = jpg.width * scale;
      const height = jpg.height * scale;
      page.drawImage(jpg, {
        x: (LETTER.width - width) / 2,
        y: LETTER.height - LABEL_BAND - MARGIN / 2 - height,
        width,
        height,
      });
      drawLabel(page, label, sub);
    }
  }
}
