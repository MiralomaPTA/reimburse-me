import { sheets as sheetsApi, type sheets_v4 } from "@googleapis/sheets";
import { googleConfig } from "@/server/config";
import { googleAuth } from "@/server/adapters/google/auth";
import { REQUEST_COLUMNS, type RequestLog, type RequestRow } from "@/server/adapters/types";

/**
 * Google Sheets implementation of the request log.
 *
 * AP may edit the Sheet directly, so nothing here depends on row order or
 * column position: rows are found by request_id and columns by header name.
 * Renaming a header breaks the mapping; adding columns or sorting does not.
 */

let api: sheets_v4.Sheets | null = null;

function sheets(): sheets_v4.Sheets {
  if (!api) api = sheetsApi({ version: "v4", auth: googleAuth() });
  return api;
}

function range(a1: string) {
  const { sheetName } = googleConfig();
  return `'${sheetName.replace(/'/g, "''")}'!${a1}`;
}

function columnLetter(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function headers(): Promise<string[]> {
  const { spreadsheetId } = googleConfig();
  const { data } = await sheets().spreadsheets.values.get({ spreadsheetId, range: range("1:1") });
  const existing = (data.values?.[0] ?? []).map(String);
  if (existing.length > 0) return existing;
  // Fresh sheet: write the header row once.
  await sheets().spreadsheets.values.update({
    spreadsheetId,
    range: range("A1"),
    valueInputOption: "RAW",
    requestBody: { values: [REQUEST_COLUMNS] },
  });
  return [...REQUEST_COLUMNS];
}

interface Table {
  headers: string[];
  rows: { rowNumber: number; row: RequestRow }[];
}

async function readTable(): Promise<Table> {
  const { spreadsheetId } = googleConfig();
  const cols = await headers();
  const { data } = await sheets().spreadsheets.values.get({
    spreadsheetId,
    range: range(`A2:${columnLetter(cols.length - 1)}`),
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = (data.values ?? []).map((values, i) => {
    const row = {} as Record<string, unknown>;
    cols.forEach((name, c) => {
      row[name] = values[c] ?? "";
    });
    return { rowNumber: i + 2, row: fromSheet(row) };
  });
  return { headers: cols, rows: rows.filter((r) => r.row.request_id) };
}

function fromSheet(raw: Record<string, unknown>): RequestRow {
  const row = {} as Record<string, unknown>;
  for (const key of REQUEST_COLUMNS) {
    const v = raw[key];
    if (key === "line_count" || key === "receipt_count" || key === "version") row[key] = Number(v ?? 0);
    else row[key] = v == null ? "" : String(v);
  }
  return row as unknown as RequestRow;
}

function toValues(cols: string[], row: Partial<RequestRow>, previous?: RequestRow): unknown[] {
  return cols.map((name) => {
    const key = name as keyof RequestRow;
    const value = row[key] ?? previous?.[key];
    return value == null ? "" : value;
  });
}

export const googleRequestLog: RequestLog = {
  async maxSequence(prefix) {
    const { rows } = await readTable();
    let max = 0;
    for (const { row } of rows) {
      if (!row.request_id.startsWith(prefix)) continue;
      const n = Number(row.request_id.slice(prefix.length));
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
  },

  async append(row) {
    const { spreadsheetId } = googleConfig();
    const cols = await headers();
    await sheets().spreadsheets.values.append({
      spreadsheetId,
      range: range("A1"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [toValues(cols, row)] },
    });
  },

  async get(requestId) {
    const { rows } = await readTable();
    return rows.find((r) => r.row.request_id === requestId)?.row ?? null;
  },

  async listByEmail(email) {
    const wanted = email.toLowerCase();
    const { rows } = await readTable();
    return rows.map((r) => r.row).filter((r) => r.requester_email.toLowerCase() === wanted);
  },

  async update(requestId, patch) {
    const { spreadsheetId } = googleConfig();
    const { headers: cols, rows } = await readTable();
    const found = rows.find((r) => r.row.request_id === requestId);
    if (!found) throw new Error(`Unknown request ${requestId}`);
    const merged = { ...patch, updated_at: new Date().toISOString() };
    await sheets().spreadsheets.values.update({
      spreadsheetId,
      range: range(`A${found.rowNumber}:${columnLetter(cols.length - 1)}${found.rowNumber}`),
      valueInputOption: "RAW",
      requestBody: { values: [toValues(cols, merged, found.row)] },
    });
  },
};
