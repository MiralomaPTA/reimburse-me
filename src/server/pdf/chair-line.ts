import { rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { eventLabel } from "@/lib/events";
import { fitText } from "@/server/pdf/text";
import type { LineBox } from "@/server/pdf/types";

/**
 * The layout of the form's "Signature of VP/Chairman for Program/Event" line.
 * The right end holds two small lines of text: the event (printed when the
 * requester signs, so the packet says whose signature belongs there) and,
 * above it, the chair's name and the date (added when the chair signs; the
 * form has no date box for this line). The signature itself goes to the left.
 */

export const CHAIR_TEXT_SIZE = 7;
const COLOR = rgb(0.25, 0.25, 0.25);
/** Baselines above the bottom of the field: the event sits just above the printed underline, the name above that. */
const EVENT_BASELINE = 5;
const NAME_BASELINE = 12.5;
const RIGHT_PAD = 2;
/** Gap between the signature and the text at the right end. */
const GAP = 10;
/** The right-hand text never takes more of the line than this; longer text is cut short, so the signature always has room. */
const MAX_TEXT_SHARE = 0.45;

/** `text` as it is printed at the right end of `line`: cut short with an ellipsis when it would take too much of the line. */
const rightText = (font: PDFFont, line: LineBox, text: string) => fitText(font, text, CHAIR_TEXT_SIZE, line.width * MAX_TEXT_SHARE);

function rightAligned(page: PDFPage, font: PDFFont, line: LineBox, text: string, baseline: number) {
  const clean = rightText(font, line, text);
  const width = font.widthOfTextAtSize(clean, CHAIR_TEXT_SIZE);
  page.drawText(clean, { x: line.x + line.width - RIGHT_PAD - width, y: line.y + baseline, size: CHAIR_TEXT_SIZE, font, color: COLOR });
  return width;
}

export function drawEventLabel(page: PDFPage, font: PDFFont, line: LineBox, event: string) {
  rightAligned(page, font, line, eventLabel(event), EVENT_BASELINE);
}

/** "Lillie Coit, 11/14/2026". A name too long for the line is cut short so the date still shows. */
export function chairCaption(font: PDFFont, line: LineBox, name: string, date: string): string {
  const suffix = `, ${date}`;
  const room = line.width * MAX_TEXT_SHARE - font.widthOfTextAtSize(suffix, CHAIR_TEXT_SIZE);
  return `${fitText(font, name, CHAIR_TEXT_SIZE, room)}${suffix}`;
}

export function drawChairCaption(page: PDFPage, font: PDFFont, line: LineBox, caption: string) {
  rightAligned(page, font, line, caption, NAME_BASELINE);
}

/** The part of the line left of the right-hand text, where the chair's signature goes. */
export function signatureArea(font: PDFFont, line: LineBox, rightTexts: string[]): { x: number; y: number; width: number } {
  const textWidth = Math.max(0, ...rightTexts.map((t) => font.widthOfTextAtSize(rightText(font, line, t), CHAIR_TEXT_SIZE)));
  return { x: line.x + 4, y: line.y + EVENT_BASELINE - 1, width: Math.max(1, line.width - RIGHT_PAD - textWidth - GAP - 4) };
}
