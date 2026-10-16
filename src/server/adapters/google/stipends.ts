import { googleConfig } from "@/server/config";
import { SheetTable } from "@/server/adapters/google/sheet-table";
import { STIPEND_COLUMNS, type StipendRow, type StipendTable } from "@/server/adapters/types";

/** The PTA-wide stipend amounts: the `Stipends` tab of the spreadsheet. */

let table: SheetTable<StipendRow> | null = null;

function stipends(): SheetTable<StipendRow> {
  if (!table) table = new SheetTable<StipendRow>(googleConfig().stipendsSheetName, STIPEND_COLUMNS, "name");
  return table;
}

export const googleStipendTable: StipendTable = {
  async list() {
    return (await stipends().readAll()).map((r) => r.row);
  },
};
