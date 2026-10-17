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
 *
 * The header row is read together with the data on every operation rather
 * than cached: a column AP inserts between two reads would otherwise make a
 * cached header write values into the wrong cells. Reading the whole tab in
 * one call keeps the cost at one read for `readAll` and `find`, and one read
 * plus one write for `append`, `update` and `upsert`. Cells in columns the
 * app doesn't know are read back and written back unchanged.
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

export interface FoundRow<T> {
  rowNumber: number;
  row: T;
  /** The cells as read, so columns the app doesn't know survive a rewrite. */
  raw: unknown[];
}

export class SheetTable<T extends object> {
  constructor(
    private readonly sheetName: string,
    private readonly columns: readonly (keyof T & string)[],
    private readonly key: keyof T & string,
    private readonly numeric: readonly (keyof T & string)[] = [],
  ) {}

  /** `'Tab name'!A1`, or the whole tab when `a1` is left out. */
  private range(a1?: string): string {
    const name = `'${this.sheetName.replace(/'/g, "''")}'`;
    return a1 ? `${name}!${a1}` : name;
  }

  /** The header row, with any columns the app gained since the tab was made appended to the end. */
  async headers(): Promise<string[]> {
    const rows = await this.readRows("1:1");
    return this.migrate((rows[0] ?? []).map(String));
  }

  /** Reads `a1`, or the whole tab. A tab the app gained after setup (like Stipends) is created, empty, on first use. */
  private async readRows(a1?: string): Promise<unknown[][]> {
    const { spreadsheetId } = googleConfig();
    try {
      const { data } = await sheets().spreadsheets.values.get({ spreadsheetId, range: this.range(a1), valueRenderOption: "UNFORMATTED_VALUE" });
      return data.values ?? [];
    } catch (error) {
      if (await this.tab()) throw error; // the tab exists, so this is some other failure
      await sheets().spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: this.sheetName } } }] } });
      return [];
    }
  }

  /** Writes the column names missing from `existing` after the last one, widening the tab first, so an existing spreadsheet never needs rebuilding. */
  private async migrate(existing: string[]): Promise<string[]> {
    const { spreadsheetId } = googleConfig();
    const missing = this.columns.filter((col) => !existing.includes(col));
    if (missing.length === 0) return existing;
    await this.ensureColumns(existing.length + missing.length);
    await sheets().spreadsheets.values.update({
      spreadsheetId,
      range: this.range(`${columnLetter(existing.length)}1`),
      valueInputOption: "RAW",
      requestBody: { values: [missing] },
    });
    return [...existing, ...missing];
  }

  private async tab(): Promise<sheets_v4.Schema$SheetProperties | null> {
    const { spreadsheetId } = googleConfig();
    const { data } = await sheets().spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
    return data.sheets?.find((s) => s.properties?.title === this.sheetName)?.properties ?? null;
  }

  /** Widens the tab to `count` columns if needed; a new tab has only 26 (A–Z), and writing past the grid fails. */
  private async ensureColumns(count: number): Promise<void> {
    const { spreadsheetId } = googleConfig();
    const props = await this.tab();
    const current = props?.gridProperties?.columnCount ?? 0;
    if (props?.sheetId == null || current >= count) return;
    await sheets().spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ appendDimension: { sheetId: props.sheetId, dimension: "COLUMNS", length: count - current } }] },
    });
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

  /** One cell per header: the patch's value, else what the row already held. */
  private toValues(cols: string[], patch: Partial<T>, raw: unknown[] = []): unknown[] {
    const values = patch as Record<string, unknown>;
    return cols.map((name, i) => {
      const value = values[name] ?? raw[i];
      return value == null ? "" : value;
    });
  }

  private keyOf(row: T): string {
    return String((row as Record<string, unknown>)[this.key] ?? "");
  }

  /** The header and every record, in one read. */
  private async snapshot(): Promise<{ cols: string[]; rows: FoundRow<T>[] }> {
    const raw = await this.readRows();
    const cols = await this.migrate((raw[0] ?? []).map(String));
    const rows = raw
      .slice(1)
      .map((values, i) => ({ rowNumber: i + 2, row: this.fromSheet(cols, values), raw: values }))
      .filter((r) => this.keyOf(r.row) !== "");
    return { cols, rows };
  }

  private findIn(rows: FoundRow<T>[], keyValue: string): FoundRow<T> | null {
    const wanted = keyValue.trim().toLowerCase();
    return rows.find((r) => this.keyOf(r.row).trim().toLowerCase() === wanted) ?? null;
  }

  private async writeRow(cols: string[], rowNumber: number, values: unknown[]): Promise<void> {
    const { spreadsheetId } = googleConfig();
    await sheets().spreadsheets.values.update({
      spreadsheetId,
      range: this.range(`A${rowNumber}:${columnLetter(cols.length - 1)}${rowNumber}`),
      valueInputOption: "RAW",
      requestBody: { values: [values] },
    });
  }

  private async appendRow(cols: string[], row: T): Promise<void> {
    const { spreadsheetId } = googleConfig();
    await sheets().spreadsheets.values.append({
      spreadsheetId,
      range: this.range("A1"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [this.toValues(cols, row)] },
    });
  }

  async readAll(): Promise<FoundRow<T>[]> {
    return (await this.snapshot()).rows;
  }

  async find(keyValue: string): Promise<FoundRow<T> | null> {
    return this.findIn((await this.snapshot()).rows, keyValue);
  }

  async append(row: T): Promise<void> {
    await this.appendRow(await this.headers(), row);
  }

  /** Rewrites the found row with `patch` over its current values. */
  async update(keyValue: string, patch: Partial<T>): Promise<void> {
    const { cols, rows } = await this.snapshot();
    const found = this.findIn(rows, keyValue);
    if (!found) throw new Error(`No row with ${this.key}=${keyValue} in ${this.sheetName}`);
    await this.writeRow(cols, found.rowNumber, this.toValues(cols, patch, found.raw));
  }

  async upsert(row: T): Promise<void> {
    const { cols, rows } = await this.snapshot();
    const found = this.findIn(rows, this.keyOf(row));
    if (found) await this.writeRow(cols, found.rowNumber, this.toValues(cols, row, found.raw));
    else await this.appendRow(cols, row);
  }
}
