import { googleConfig } from "@/server/config";
import { SheetTable } from "@/server/adapters/google/sheet-table";
import { SIGNATURE_COLUMNS, type SignatureLog, type SignatureRecord } from "@/server/adapters/types";

/** The check signers' signatures and send-backs: the `Signatures` tab, created on first use. Rows are only added. */

let table: SheetTable<SignatureRecord> | null = null;

function signatures(): SheetTable<SignatureRecord> {
  if (!table) table = new SheetTable<SignatureRecord>(googleConfig().signaturesSheetName, SIGNATURE_COLUMNS, "record_id", ["version", "slot"]);
  return table;
}

export const googleSignatureLog: SignatureLog = {
  async append(record) {
    await signatures().append(record);
  },
  async listFor(requestId) {
    return (await signatures().readAll()).map((r) => r.row).filter((r) => r.request_id === requestId);
  },
};
