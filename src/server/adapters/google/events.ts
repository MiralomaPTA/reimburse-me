import { googleConfig } from "@/server/config";
import { SheetTable } from "@/server/adapters/google/sheet-table";
import { EVENT_COLUMNS, type EventRow, type EventTable } from "@/server/adapters/types";

/** The PTA events and their chairs: the `Events` tab of the spreadsheet. */

let table: SheetTable<EventRow> | null = null;

function events(): SheetTable<EventRow> {
  if (!table) table = new SheetTable<EventRow>(googleConfig().eventsSheetName, EVENT_COLUMNS, "name");
  return table;
}

export const googleEventTable: EventTable = {
  async list() {
    return (await events().readAll()).map((r) => r.row);
  },
};
