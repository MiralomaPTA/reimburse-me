import type { FileStore, RequestRow } from "@/server/adapters/types";
import { versionOf } from "@/server/requests/rows";
import { loadStoredRequest, type StoredRequest } from "@/server/requests/stored";
import { formatAddress, sameAddress } from "@/lib/mailing";
import { formatMoney, parseMoney } from "@/lib/money";
import { totals } from "@/lib/request-schema";

/**
 * A mailed check on the dashboard. AP pays only to the address and amount
 * on the signed FO10, which come from the request's JSON in Drive, never the
 * Sheet, since anyone with the Sheet open can change a cell. The dashboard
 * shows the JSON's address, once it's checked to belong to the packet the row
 * records, and warns when the row says something else.
 */

export type MailedCheck =
  /** From the request's JSON: "123 Main St Apt 4, San Francisco, CA 94127". `differences` is what the row says differently, in AP's words; empty when they agree. */
  | { kind: "signed"; address: string; amountCents: number; differences: string[] }
  /** A paper check mailed before bill pay (the October pilot): no JSON or FO10 was kept, so the address is the Sheet's, unchecked. */
  | { kind: "before-bill-pay"; address: string }
  /** Why the address can't be shown as signed. */
  | { kind: "problem"; problem: string };

export function mailedDifferences(row: RequestRow, stored: StoredRequest): string[] {
  const differences: string[] = [];
  const rowAddress = { address: row.address, cityStateZip: row.city_zip };
  if (!sameAddress(rowAddress, stored.request)) {
    differences.push(`The Sheet's address (${formatAddress(rowAddress)}) isn't the one the request was signed with (${formatAddress(stored.request)}).`);
  }
  const signedCents = totals(stored.request).reimbursementCents;
  const rowCents = parseMoney(String(row.reimbursement_claimed ?? ""));
  if (rowCents !== signedCents) {
    differences.push(`The Sheet's amount (${rowCents === null ? `"${row.reimbursement_claimed}"` : formatMoney(rowCents)}) isn't the amount signed (${formatMoney(signedCents)}).`);
  }
  if (stored.version !== versionOf(row)) {
    differences.push(`The Sheet says version ${versionOf(row)}, but its saved request is version ${stored.version}.`);
  }
  return differences;
}

/**
 * Whether a mailed row is from before bill pay. The portal began keeping the
 * request's JSON (Nov 12) while checks were picked up, before mailing came
 * back through bill pay (Nov 17), so a mailed row with none of bill pay's
 * cells is a paper check from the October pilot. One with some of them but
 * no JSON has had a cell cleared, which is a problem, not an old row.
 */
export function mailedBeforeBillPay(row: RequestRow): boolean {
  const billPayCells = [row.request_file_id, row.signers_step, row.signers_sent_at, row.fo10_file_id, row.authorized_pdf_file_id];
  return row.check_delivery === "mail" && billPayCells.every((cell) => !String(cell ?? "").trim());
}

/** Paid through the bank's bill pay: a mailed check from since bill pay began. A check mailed before then was a paper check. */
export const paidByBillPay = (row: RequestRow) => row.check_delivery === "mail" && !mailedBeforeBillPay(row);

/** The mailed check's address and amount as signed, or why they can't be shown; null for a request that isn't mailed. */
export async function mailedCheck(row: RequestRow, files: FileStore): Promise<MailedCheck | null> {
  if (row.check_delivery !== "mail") return null;
  if (mailedBeforeBillPay(row)) return { kind: "before-bill-pay", address: formatAddress({ address: row.address, cityStateZip: row.city_zip }) };
  if (!row.request_file_id) return { kind: "problem", problem: "This request has no saved copy of what was signed, so its address can't be checked here." };
  let stored: StoredRequest;
  try {
    stored = await loadStoredRequest(files, row.request_file_id);
  } catch (error) {
    console.error(`[ap mailed] couldn't read ${row.request_id}'s request JSON:`, error);
    return { kind: "problem", problem: "The saved copy of what was signed couldn't be read just now, so its address isn't shown. Reload the page to try again." };
  }
  // `request_file_id` is a Sheet cell too: the JSON must be this request's, and the one its packet was made from.
  if (stored.requestId !== row.request_id || !row.pdf_sha256 || stored.packet.sha256 !== row.pdf_sha256) {
    console.error(`[ap mailed] ${row.request_id}'s request JSON is for ${stored.requestId}, packet ${stored.packet.sha256}; the row says packet ${row.pdf_sha256 || "nothing"}`);
    return { kind: "problem", problem: "The saved copy of what was signed doesn't match the packet the Sheet records, so its address can't be checked here." };
  }
  return { kind: "signed", address: formatAddress(stored.request), amountCents: totals(stored.request).reimbursementCents, differences: mailedDifferences(row, stored) };
}

/**
 * The list's mailed checks by request ID, read from Drive a few at a time so a
 * long list doesn't make dozens of reads at once. Paid ones are left out: there
 * is nothing left to pay.
 */
export async function mailedChecks(rows: RequestRow[], files: FileStore, atOnce = 4): Promise<Map<string, MailedCheck>> {
  const todo = rows.filter((row) => row.check_delivery === "mail" && row.status !== "Paid");
  const found = new Map<string, MailedCheck>();
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const row = todo[next++];
      const check = await mailedCheck(row, files);
      if (check) found.set(row.request_id, check);
    }
  };
  await Promise.all(Array.from({ length: Math.min(atOnce, todo.length) }, worker));
  return found;
}
