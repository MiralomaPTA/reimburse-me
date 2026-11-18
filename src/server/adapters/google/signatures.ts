import { googleConfig } from "@/server/config";
import { SheetTable } from "@/server/adapters/google/sheet-table";
import { SIGNATURE_COLUMNS, type SignatureClaim, type SignatureLog } from "@/server/adapters/types";

/**
 * The check signers' claims: the `Signatures` tab, created on first use. Rows
 * are appended, and the Sheet keeps them in the order they were added, so
 * every reader agrees which claim on a signature came first.
 */

let table: SheetTable<SignatureClaim> | null = null;

function signatures(): SheetTable<SignatureClaim> {
  if (!table) table = new SheetTable<SignatureClaim>(googleConfig().signaturesSheetName, SIGNATURE_COLUMNS, "claim_id", ["version", "slot"]);
  return table;
}

export const googleSignatureLog: SignatureLog = {
  async append(claim) {
    await signatures().append(claim);
  },
  async listFor(requestId) {
    // readAll keeps the tab's order; nothing here sorts.
    return (await signatures().readAll()).map((r) => r.row).filter((r) => r.request_id === requestId);
  },
  async update(claimId, patch) {
    await signatures().update(claimId, patch);
  },
};
