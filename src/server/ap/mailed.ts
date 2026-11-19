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
 * shows the JSON's address and warns when the row says something else.
 */

export interface MailedCheck {
  /** "123 Main St Apt 4, San Francisco, CA 94127", from the JSON. */
  address: string;
  amountCents: number;
  /** What the row says differently from the JSON, in AP's words; empty when they agree. */
  differences: string[];
}

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

/** The mailed check's address and amount from its JSON, or why they can't be read; null for a request that isn't mailed. */
export async function mailedCheck(row: RequestRow, files: FileStore): Promise<MailedCheck | { problem: string } | null> {
  if (row.check_delivery !== "mail") return null;
  if (!row.request_file_id) return { problem: "This request has no saved copy of what was signed, so its address can't be checked here." };
  try {
    const stored = await loadStoredRequest(files, row.request_file_id);
    return { address: formatAddress(stored.request), amountCents: totals(stored.request).reimbursementCents, differences: mailedDifferences(row, stored) };
  } catch (error) {
    console.error(`[ap mailed] couldn't read ${row.request_id}'s request JSON:`, error);
    return { problem: "The saved copy of what was signed couldn't be read, so its address can't be checked here." };
  }
}
