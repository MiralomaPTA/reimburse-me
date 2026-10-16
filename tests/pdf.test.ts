import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildPacket } from "@/server/pdf/build-packet";
import { formLines, SCHEDULE_LINE_TEXT } from "@/server/pdf/fill-form";
import { CONSENT_TEXT, type ReceiptFile } from "@/server/pdf/types";
import { winAnsi } from "@/server/pdf/text";
import type { RequestInput } from "@/lib/request-schema";

async function jpegReceipt(fileId: string, width = 1200, height = 1800): Promise<ReceiptFile> {
  const bytes = await sharp({ create: { width, height, channels: 3, background: { r: 240, g: 240, b: 240 } } })
    .jpeg()
    .toBuffer();
  return { fileId, name: `${fileId}.jpg`, mimeType: "image/jpeg", bytes: new Uint8Array(bytes) };
}

async function pdfReceipt(fileId: string, pages = 2): Promise<ReceiptFile> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]).drawText(`Receipt page ${i + 1}`, { x: 72, y: 700, size: 24, font });
  return { fileId, name: `${fileId}.pdf`, mimeType: "application/pdf", bytes: await doc.save() };
}

function request(itemCount: number, receiptsPerItem: (i: number) => string[]): RequestInput {
  return {
    payeeName: "Jane Doe",
    ptaPosition: "Teacher, Room 12",
    phone: "(415) 555-1234",
    checkDelivery: "mail",
    address: "123 Main St",
    cityZip: "San Francisco, CA 94127",
    purpose: "2nd grade art supplies",
    donationCents: 500,
    funding: "none",
    items: Array.from({ length: itemCount }, (_, i) => ({
      description: `Item ${i + 1} supplies`,
      amountCents: 1000 * (i + 1) + 25,
      receipts: receiptsPerItem(i).map((fileId) => ({ fileId, name: `${fileId}.jpg`, mimeType: "image/jpeg" as const })),
    })),
  };
}

describe("formLines", () => {
  it("itemizes up to four lines", () => {
    const lines = formLines(request(4, (i) => [`f${i}`]).items);
    expect(lines).toHaveLength(4);
    expect(lines[3].description).toBe("Item 4 supplies");
  });
  it("rolls items 4+ into a schedule subtotal on line 4", () => {
    const lines = formLines(request(6, (i) => [`f${i}`]).items);
    expect(lines).toHaveLength(4);
    expect(lines[3].description).toBe(SCHEDULE_LINE_TEXT);
    expect(lines[3].amountCents).toBe(4025 + 5025 + 6025);
  });
});

describe("winAnsi", () => {
  it("keeps Latin text and typographic punctuation, replaces the rest", () => {
    expect(winAnsi("Café – “quotes” … ok")).toBe("Café – “quotes” ... ok");
    expect(winAnsi("emoji 🎨 and 漢字")).toBe("emoji ? and ??");
  });
});

describe("buildPacket", () => {
  it("builds an unsigned preview: form page plus one page per receipt image", async () => {
    const input = request(2, (i) => [`r${i}`]);
    const files = new Map([["r0", await jpegReceipt("r0")], ["r1", await jpegReceipt("r1", 1800, 1200)]]);
    const packet = await buildPacket({ requestId: "PREVIEW", submittedAt: new Date(), request: input, requesterEmail: "jane@example.org", receiptFiles: files, signature: null, audit: null });
    expect(packet.pageCount).toBe(3);
    expect(packet.sha256).toMatch(/^[0-9a-f]{64}$/);
    const doc = await PDFDocument.load(packet.bytes);
    expect(doc.getForm().getFields()).toHaveLength(0); // flattened
    expect(doc.getTitle()).toBe("PTA reimbursement request PREVIEW");
  }, 30_000);

  it("adds a schedule page for 5+ items, copies PDF receipt pages, and ends with the audit page when signed", async () => {
    const input = request(5, (i) => (i === 4 ? ["pdf1"] : [`r${i}`]));
    const files = new Map<string, ReceiptFile>();
    for (let i = 0; i < 4; i++) files.set(`r${i}`, await jpegReceipt(`r${i}`, 600, 800));
    files.set("pdf1", await pdfReceipt("pdf1", 2));
    const packet = await buildPacket({
      requestId: "FY27-042",
      submittedAt: new Date("2026-10-14T22:00:00Z"),
      request: input,
      requesterEmail: "jane@example.org",
      receiptFiles: files,
      signature: { type: "typed", name: "Jane Doe" },
      audit: { requesterEmail: "jane@example.org", signInMethod: "One-time email link", signedInAt: new Date(), ip: "127.0.0.1", userAgent: "vitest", consentText: CONSENT_TEXT },
    });
    // 1 form + 1 schedule + 4 images + 2 pdf pages + 1 audit
    expect(packet.pageCount).toBe(9);
  }, 30_000);

  it("places a drawn signature image", async () => {
    const png = await sharp({ create: { width: 400, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const input = request(1, () => ["r0"]);
    const files = new Map([["r0", await jpegReceipt("r0", 300, 300)]]);
    const packet = await buildPacket({
      requestId: "FY27-001",
      submittedAt: new Date(),
      request: input,
      requesterEmail: "jane@example.org",
      receiptFiles: files,
      signature: { type: "drawn", png: new Uint8Array(png) },
      audit: { requesterEmail: "jane@example.org", signInMethod: "One-time email link", signedInAt: new Date(), ip: "", userAgent: "", consentText: CONSENT_TEXT },
    });
    expect(packet.pageCount).toBe(3);
  }, 30_000);
});
