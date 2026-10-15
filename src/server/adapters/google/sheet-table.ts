import { sheets as sheetsApi, type sheets_v4 } from "@googleapis/sheets";
import { googleConfig } from "@/server/config";
import { googleAuth } from "@/server/adapters/google/auth";

/**
 * A tab of the spreadsheet used as a table: header row = column names, one
 * record per row, one column as the key.
 *
 * AP may edit the Sheet directly, so nothing here depends on row order or
 * column position: rows are found by key and columns by header name.
 * Renaming a header breaks the mapping; adding columns or sorting does not.
 */

let api: sheets_v4.Sheets | null = null;

function sheets(): sheets_v4.Sheets {
  if (!api) api = sheetsApi({ version: "v4", auth: googleAuth() });
  return api;
}

export function columnLetter(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export class SheetTable<T extends object> {
  constructor(
    private readonly sheetName: string,
    private readonly columns: readonly (keyof T & string)[],
    private readonly key: keyof T & string,
    private readonly numeric: readonly (keyof T & string)[] = [],
  ) {}

  private range(a1: string) {
    return `'${this.sheetName.replace(/'/g, "''")}'!${a1}`;
  }

  /** The header row, written once if the tab is empty. */
  async headers(): Promise<string[]> {
    const { spreadsheetId } = googleConfig();
    const { data } = await sheets().spreadsheets.values.get({ spreadsheetId, range: this.range("1:1") });
    const existing = (data.values?.[0] ?? []).map(String);
    if (existing.length > 0) return existing;
    await sheets().spreadsheets.values.update({
      spreadsheetId,
      range: this.range("A1"),
      valueInputOption: "RAW",
      requestBody: { values: [[...this.columns]] },
    });
    return [...this.columns];
  }

  private fromSheet(cols: string[], values: unknown[]): T {
    const row: Record<string, string | number> = {};
    const byName = new Map(cols.map((name, i) => [name, values[i]]));
    for (const col of this.columns) {
      const v = byName.get(col);
      row[col] = this.numeric.includes(col) ? Number(v ?? 0) : v == null ? "" : String(v);
    }
    return row as unknown as T;
  }

  private toValues(cols: string[], row: Partial<T>, previous?: T): unknown[] {
    const patch = row as Record<string, unknown>;
    const prev = (previous ?? {}) as Record<string, unknown>;
    return cols.map((name) => {
      const value = patch[name] ?? prev[name];
      return value == null ? "" : value;
    });
  }

  private keyOf(row: T): string {
    return String((row as Record<string, unknown>)[this.key] ?? "");
  }

  async readAll(): Promise<{ rowNumber: number; row: T }[]> {
    const { spreadsheetId } = googleConfig();
    const cols = await this.headers();
    const { data } = await sheets().spreadsheets.values.get({
      spreadsheetId,
      range: this.range(`A2:${columnLetter(cols.length - 1)}`),
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    return (data.values ?? [])
      .map((values, i) => ({ rowNumber: i + 2, row: this.fromSheet(cols, values) }))
      .filter((r) => this.keyOf(r.row) !== "");
  }

  async find(keyValue: string): Promise<{ rowNumber: number; row: T } | null> {
    const wanted = keyValue.trim().toLowerCase();
    return (await this.readAll()).find((r) => this.keyOf(r.row).trim().toLowerCase() === wanted) ?? null;
  }

  async append(row: T): Promise<void> {
    const { spreadsheetId } = googleConfig();
    const cols = await this.headers();
    await sheets().spreadsheets.values.append({
      spreadsheetId,
      range: this.range("A1"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [this.toValues(cols, row)] },
    });
  }

  /** Rewrites the found row with `patch` over its current values. */
  async update(keyValue: string, patch: Partial<T>): Promise<void> {
    const { spreadsheetId } = googleConfig();
    const cols = await this.headers();
    const found = await this.find(keyValue);
    if (!found) throw new Error(`No row with ${this.key}=${keyValue} in ${this.sheetName}`);
    await sheets().spreadsheets.values.update({
      spreadsheetId,
      range: this.range(`A${found.rowNumber}:${columnLetter(cols.length - 1)}${found.rowNumber}`),
      valueInputOption: "RAW",
      requestBody: { values: [this.toValues(cols, patch, found.row)] },
    });
  }

  async upsert(row: T): Promise<void> {
    const found = await this.find(this.keyOf(row));
    if (found) await this.update(this.keyOf(row), row);
    else await this.append(row);
  }
}
