import { googleConfig } from "@/server/config";
import { SheetTable } from "@/server/adapters/google/sheet-table";
import { ACTION_COLUMNS, type ActionLog, type ActionRecord } from "@/server/adapters/types";

/** What AP did to each request: the `Actions` tab, created on first use. Rows are only added. */

let table: SheetTable<ActionRecord> | null = null;

function actions(): SheetTable<ActionRecord> {
  // Keyed by request ID only so readAll skips blank rows; the app never looks one row up by key.
  if (!table) table = new SheetTable<ActionRecord>(googleConfig().actionsSheetName, ACTION_COLUMNS, "request_id");
  return table;
}

export const googleActionLog: ActionLog = {
  async append(record) {
    await actions().append(record);
  },
  async listFor(requestId) {
    const rows = (await actions().readAll()).map((r) => r.row).filter((r) => r.request_id === requestId);
    // By time, in case the tab was sorted by hand.
    return rows.sort((a, b) => a.at.localeCompare(b.at));
  },
};
