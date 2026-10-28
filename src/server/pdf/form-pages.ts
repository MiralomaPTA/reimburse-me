import { PDFDocument, StandardFonts, rgb, type PDFEmbeddedPage, type PDFFont, type PDFPage } from "pdf-lib";
import { moneyPlain } from "@/lib/money";
import { CHECK_DELIVERY_LABEL, totals, type RequestInput } from "@/lib/request-schema";
import { fitFontSize, winAnsi, wrap } from "@/server/pdf/text";

/**
 * The PTA form, re-flowed. Two regions of the official page are reused pixel
 * for pixel: the header (logo, title, payee details) and the signature and
 * treasurer block. Between them we draw the purpose line, the expenditures
 * and the totals ourselves, using the full page width, so the list can take
 * as many lines, and as many pages, as the items need.
 */

const PAGE: [number, number] = [612, 792];
const PAGE_WIDTH = PAGE[0];

/** Template regions, in the template's own coordinates. */
const HEADER_BOX = { left: 0, bottom: 540, right: PAGE_WIDTH, top: 792 };
const SIGNATURE_BOX = { left: 0, bottom: 58, right: PAGE_WIDTH, top: 262 };

/** Column geometry: the left margin of the official form, the amount column at the right edge. */
const LEFT = 38;
const DESC_RIGHT = 445;
const DOLLAR_X = 458;
const AMOUNT_LEFT = 470;
const AMOUNT_RIGHT = 555;
const TOTALS_LABEL_X = 110;
/** The purpose underline stops short of the right edge to leave room for the check-delivery note. */
const PURPOSE_RIGHT = 400;
const CHECK_NOTE_X = 412;

const SIZE = 10;
/** One expenditure slot on the official form: 17.8 of field plus a 2.6 gap. */
const SLOT = 17.8;
const SLOT_GAP = 2.6;
/** Extra height for each wrapped line beyond the first. */
const LINE = 12;
/** The official form prints four slots; fewer items leave the rest blank. */
const MIN_SLOTS = 4;
/** Baselines of the two labels under the header, and the top of the first slot below them. */
const PURPOSE_BASELINE = 511;
const LIST_LABEL_BASELINE = 488;
const FIRST_SLOT_TOP = 480;
/** Where the first slot's top sits on a continuation page. */
const CONTINUED_SLOT_TOP = 700;
/** Nothing is drawn below this except the footer. */
const FLOOR = 60;
/** The signature block may float this low, just above the footer. */
const SIGNATURE_FLOOR = 24;
/** Gaps copied from the official form: last slot to TOTAL EXPENSE, TOTAL EXPENSE to the claimed line, refund line to the signature block. */
const TOTAL_GAP = 7.2;
const CLAIMED_GAP = SLOT + SLOT_GAP + 15.6;
const SIGNATURE_GAP = 6.3;

const SIGNATURE_HEIGHT = SIGNATURE_BOX.top - SIGNATURE_BOX.bottom;
const TOTALS_HEIGHT = TOTAL_GAP + SLOT + CLAIMED_GAP + (SLOT + SLOT_GAP) * 4;

interface Fonts {
  helv: PDFFont;
  bold: PDFFont;
  oblique: PDFFont;
}

class FormWriter {
  page!: PDFPage;
  pageCount = 0;
  /** The top of the next slot to draw. */
  top = FIRST_SLOT_TOP;

  constructor(
    private doc: PDFDocument,
    private fonts: Fonts,
    private request: RequestInput,
    header: PDFEmbeddedPage,
  ) {
    this.page = doc.addPage(PAGE);
    this.pageCount = 1;
    this.page.drawPage(header, { x: HEADER_BOX.left, y: HEADER_BOX.bottom });
    this.purposeLine();
    this.page.drawText("List Expenditures:", { x: LEFT, y: LIST_LABEL_BASELINE, size: SIZE, font: this.fonts.bold });
  }

  /** "Expenditure was for: <purpose>" with the check-delivery note, which is not on the PTA form, to its right. */
  private purposeLine() {
    const { helv, bold } = this.fonts;
    const label = "Expenditure was for:";
    this.page.drawText(label, { x: LEFT, y: PURPOSE_BASELINE, size: SIZE, font: bold });
    const textX = LEFT + bold.widthOfTextAtSize(label, SIZE) + 4;
    const purpose = winAnsi(this.request.purpose);
    const size = fitFontSize(helv, purpose, PURPOSE_RIGHT - textX - 2, SIZE, 7);
    this.page.drawText(purpose, { x: textX, y: PURPOSE_BASELINE, size, font: helv });
    this.rule(textX - 2, PURPOSE_RIGHT, PURPOSE_BASELINE - 4);
    this.page.drawText(winAnsi(`Check: ${CHECK_DELIVERY_LABEL[this.request.checkDelivery]}`), {
      x: CHECK_NOTE_X,
      y: PURPOSE_BASELINE,
      size: 7.5,
      font: helv,
      color: rgb(0.25, 0.25, 0.25),
    });
  }

  /** Starts a continuation page and returns to the caller with `top` set. */
  private continuePage() {
    this.page = this.doc.addPage(PAGE);
    this.pageCount += 1;
    const { helv, bold } = this.fonts;
    const title = "PAYMENT AUTHORIZATION/REQUEST FOR REIMBURSEMENT (continued)";
    this.page.drawText(title, { x: (PAGE_WIDTH - bold.widthOfTextAtSize(title, 11)) / 2, y: 745, size: 11, font: bold });
    const context = winAnsi(`Name of Payee: ${this.request.payeeName}    Expenditure was for: ${this.request.purpose}`);
    this.page.drawText(context, { x: (PAGE_WIDTH - helv.widthOfTextAtSize(context, 9)) / 2, y: 728, size: 9, font: helv, color: rgb(0.25, 0.25, 0.25) });
    this.top = CONTINUED_SLOT_TOP;
  }

  private ensure(height: number, floor = FLOOR) {
    if (this.top - height < floor) this.continuePage();
  }

  private rule(x1: number, x2: number, y: number) {
    this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.6, color: rgb(0, 0, 0) });
  }

  private amount(cents: number, baseline: number, font = this.fonts.helv) {
    const text = moneyPlain(cents);
    this.page.drawText("$", { x: DOLLAR_X, y: baseline, size: SIZE, font });
    this.page.drawText(text, { x: AMOUNT_RIGHT - 2 - font.widthOfTextAtSize(text, SIZE), y: baseline, size: SIZE, font });
  }

  /** One expenditure slot: description lines (wrapped), one amount, underlines at the bottom. */
  slot(description: string | null, amountCents: number | null) {
    const lines = description === null ? [] : wrap(this.fonts.helv, winAnsi(description), SIZE, DESC_RIGHT - LEFT - 2);
    const height = SLOT + Math.max(0, lines.length - 1) * LINE;
    this.ensure(height + SLOT_GAP);
    lines.forEach((line, i) => {
      this.page.drawText(line, { x: LEFT, y: this.top - 13.3 - i * LINE, size: SIZE, font: this.fonts.helv });
    });
    if (amountCents !== null) this.amount(amountCents, this.top - 13.3);
    const bottom = this.top - height;
    this.rule(LEFT, DESC_RIGHT, bottom);
    this.rule(AMOUNT_LEFT, AMOUNT_RIGHT, bottom);
    this.top = bottom - SLOT_GAP;
  }

  /** TOTAL EXPENSE and the five claimed/advance/reimbursement lines, kept on one page. */
  totals() {
    this.ensure(TOTALS_HEIGHT);
    const { helv, bold } = this.fonts;
    const t = totals(this.request);
    let top = this.top + SLOT_GAP - TOTAL_GAP;
    const line = (label: string, cents: number, font: PDFFont, x: number, align: "left" | "right") => {
      const baseline = top - 13.3;
      const width = font.widthOfTextAtSize(label, SIZE);
      this.page.drawText(label, { x: align === "right" ? x - width : x, y: baseline, size: SIZE, font });
      this.amount(cents, baseline, font);
      this.rule(AMOUNT_LEFT, AMOUNT_RIGHT, top - SLOT);
    };
    line("TOTAL EXPENSE", t.totalCents, bold, DESC_RIGHT, "right");
    top -= CLAIMED_GAP;
    line("Total Amount Claimed From Above", t.totalCents, helv, TOTALS_LABEL_X, "left");
    top -= SLOT + SLOT_GAP;
    line("Minus Advance Received", 0, helv, TOTALS_LABEL_X, "left");
    top -= SLOT + SLOT_GAP;
    line("Reimbursement Claimed", t.reimbursementCents, helv, TOTALS_LABEL_X, "left");
    top -= SLOT + SLOT_GAP;
    line(winAnsi("Not claimed – donate to PTA"), t.donationCents, helv, TOTALS_LABEL_X, "left");
    top -= SLOT + SLOT_GAP;
    line("Refund to PTA (Enclose Check)", 0, helv, TOTALS_LABEL_X, "left");
    this.top = top - SLOT;
  }

  /** The signature lines and treasurer block, directly below the totals or on a fresh page. */
  signatureBlock(block: PDFEmbeddedPage) {
    this.ensure(SIGNATURE_GAP + SIGNATURE_HEIGHT, SIGNATURE_FLOOR);
    const y = this.top - SIGNATURE_GAP - SIGNATURE_HEIGHT;
    this.page.drawPage(block, { x: SIGNATURE_BOX.left, y });
    this.top = y;
  }
}

/**
 * Appends the form pages to the packet from the filled, flattened template.
 * Returns how many pages the form took.
 */
export async function appendFormPages(doc: PDFDocument, template: PDFDocument, request: RequestInput): Promise<number> {
  const fonts: Fonts = {
    helv: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    oblique: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  // Fonts and images are written on save; the template is never saved, so write them now or the embedded regions would point at nothing.
  await template.flush();
  const source = template.getPage(0);
  const [header, signature] = await doc.embedPages([source, source], [HEADER_BOX, SIGNATURE_BOX]);

  const w = new FormWriter(doc, fonts, request, header);
  const firstPage = w.page;
  request.items.forEach((item) => w.slot(item.description, item.amountCents));
  for (let i = request.items.length; i < MIN_SLOTS; i++) w.slot(null, null);
  w.totals();
  w.signatureBlock(signature);
  // The form's revision note, kept in the footer line since the signature block no longer sits at its printed position.
  const note = "Revised July 2022";
  firstPage.drawText(note, { x: (PAGE_WIDTH - fonts.oblique.widthOfTextAtSize(note, 7.5)) / 2, y: 16, size: 7.5, font: fonts.oblique, color: rgb(0.35, 0.35, 0.35) });
  return w.pageCount;
}
