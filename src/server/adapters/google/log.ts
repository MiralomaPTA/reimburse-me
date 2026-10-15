import { googleConfig } from "@/server/config";
import { SheetTable } from "@/server/adapters/google/sheet-table";
import { REQUEST_COLUMNS, type RequestLog, type RequestRow } from "@/server/adapters/types";

/** The request log: the `Requests` tab of the spreadsheet, one row per request. */

let table: SheetTable<RequestRow> | null = null;

function requests(): SheetTable<RequestRow> {
  if (!table) table = new SheetTable<RequestRow>(googleConfig().sheetName, REQUEST_COLUMNS, "request_id", ["line_count", "receipt_count", "version"]);
  return table;
}

export const googleRequestLog: RequestLog = {
  async maxSequence(prefix) {
    let max = 0;
    for (const { row } of await requests().readAll()) {
      if (!row.request_id.startsWith(prefix)) continue;
      const n = Number(row.request_id.slice(prefix.length));
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
  },
  async append(row) {
    await requests().append(row);
  },
  async get(requestId) {
    return (await requests().find(requestId))?.row ?? null;
  },
  async listByEmail(email) {
    const wanted = email.toLowerCase();
    return (await requests().readAll()).map((r) => r.row).filter((r) => r.requester_email.toLowerCase() === wanted);
  },
  async update(requestId, patch) {
    await requests().update(requestId, { ...patch, updated_at: new Date().toISOString() });
  },
};
