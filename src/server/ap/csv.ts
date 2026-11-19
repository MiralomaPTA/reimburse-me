import type { RequestRow } from "@/server/adapters/types";
import { versionOf } from "@/server/requests/rows";

/**
 * The bookkeeping export: one row per request (its latest version), in UTF-8
 * with a byte-order mark so Excel opens it cleanly. `check_date`,
 * `approved_by` and `paid_by` come with Phase 2b; until then they're blank,
 * so the columns don't move when they arrive.
 */
export const CSV_COLUMNS = [
  "request_id",
  "status",
  "submitted_at",
  "check_date",
  "check_number",
  "paid_date",
  "budget_category",
  "payee_name",
  "pta_position",
  "requester_email",
  "purpose",
  "event",
  "chair_signed_by",
  "total_expense",
  "donation_to_pta",
  "reimbursement_claimed",
  "check_delivery",
  "budget_account",
  "payment_account",
  "line_count",
  "receipt_count",
  "version",
  "approved_by",
  "paid_by",
  "pdf_sha256",
] as const;

/**
 * One field. Text a spreadsheet would run as a formula (starting with = + - @
 * or a tab) gets a leading apostrophe: a purpose typed as "=HYPERLINK(...)"
 * stays text. Fields with a comma, quote or line break are quoted.
 */
export function csvField(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function requestsCsv(rows: RequestRow[]): string {
  const cell = (row: RequestRow, column: (typeof CSV_COLUMNS)[number]) =>
    column === "version" ? versionOf(row) : (row as unknown as Record<string, unknown>)[column];
  const lines = [CSV_COLUMNS.join(","), ...rows.map((row) => CSV_COLUMNS.map((column) => csvField(cell(row, column))).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
