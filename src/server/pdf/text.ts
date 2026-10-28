import type { PDFFont } from "pdf-lib";

/**
 * The standard PDF fonts only encode WinAnsi. Replace anything else (emoji,
 * CJK, odd symbols) so setText/drawText never throw on user input.
 */
export function winAnsi(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‐-‒]/g, "-")
    .replace(/[^\x20-\x7e\xa0-\xff–—‘’“”•…]/gu, "?");
}

/** Largest size in [min, max] at which `text` fits in `width`. */
export function fitFontSize(font: PDFFont, text: string, width: number, max = 10, min = 5): number {
  let size = max;
  while (size > min && font.widthOfTextAtSize(text, size) > width) size -= 0.5;
  return size;
}

/** Greedy word wrap for the form, receipt and audit pages. */
export function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width || !line) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** `text` if it fits in `width`, otherwise as much as fits with an ellipsis. */
export function truncate(font: PDFFont, text: string, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let end = text.length;
  while (end > 0 && font.widthOfTextAtSize(`${text.slice(0, end).trimEnd()}…`, size) > width) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}
