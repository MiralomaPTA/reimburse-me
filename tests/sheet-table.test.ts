import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  spreadsheets: {
    get: vi.fn(),
    batchUpdate: vi.fn(),
    values: { get: vi.fn(), update: vi.fn(), append: vi.fn(), batchUpdate: vi.fn() },
  },
}));
vi.mock("@googleapis/sheets", () => ({ sheets: () => api }));
vi.mock("@/server/adapters/google/auth", () => ({ googleAuth: () => ({}) }));
vi.mock("@/server/config", () => ({ googleConfig: () => ({ spreadsheetId: "sheet-id" }) }));

const { SheetTable } = await import("@/server/adapters/google/sheet-table");

type Row = { a: string; b: string; c: string };
const grid = (columnCount: number, title = "Requests") => ({ data: { sheets: [{ properties: { sheetId: 0, title, gridProperties: { columnCount } } }] } });

describe("SheetTable.headers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves a complete header row alone, extra columns included", async () => {
    api.spreadsheets.values.get.mockResolvedValue({ data: { values: [["a", "extra", "b", "c"]] } });
    expect(await new SheetTable<Row>("Requests", ["a", "b", "c"], "a").headers()).toEqual(["a", "extra", "b", "c"]);
    expect(api.spreadsheets.values.update).not.toHaveBeenCalled();
    expect(api.spreadsheets.batchUpdate).not.toHaveBeenCalled();
  });

  it("widens a full tab, then appends the missing headers after the last one", async () => {
    api.spreadsheets.values.get.mockResolvedValue({ data: { values: [["a", "b"]] } });
    api.spreadsheets.get.mockResolvedValue(grid(2));
    expect(await new SheetTable<Row>("Requests", ["a", "b", "c"], "a").headers()).toEqual(["a", "b", "c"]);
    expect(api.spreadsheets.batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      requestBody: { requests: [{ appendDimension: { sheetId: 0, dimension: "COLUMNS", length: 1 } }] },
    });
    expect(api.spreadsheets.values.update).toHaveBeenCalledWith(expect.objectContaining({ range: "'Requests'!C1", requestBody: { values: [["c"]] } }));
    expect(api.spreadsheets.batchUpdate.mock.invocationCallOrder[0]).toBeLessThan(api.spreadsheets.values.update.mock.invocationCallOrder[0]);
  });

  it("writes every header into an empty tab without widening one that is already wide enough", async () => {
    api.spreadsheets.values.get.mockResolvedValue({ data: {} });
    api.spreadsheets.get.mockResolvedValue(grid(26));
    expect(await new SheetTable<Row>("Requests", ["a", "b", "c"], "a").headers()).toEqual(["a", "b", "c"]);
    expect(api.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    expect(api.spreadsheets.values.update).toHaveBeenCalledWith(expect.objectContaining({ range: "'Requests'!A1", requestBody: { values: [["a", "b", "c"]] } }));
  });

  it("creates a tab that doesn't exist yet, then writes its headers", async () => {
    api.spreadsheets.values.get.mockRejectedValue(new Error("Unable to parse range: 'Stipends'!1:1"));
    api.spreadsheets.get.mockResolvedValueOnce(grid(26, "Requests")).mockResolvedValue(grid(26, "Stipends"));
    expect(await new SheetTable<Row>("Stipends", ["a", "b", "c"], "a").headers()).toEqual(["a", "b", "c"]);
    expect(api.spreadsheets.batchUpdate).toHaveBeenCalledWith({ spreadsheetId: "sheet-id", requestBody: { requests: [{ addSheet: { properties: { title: "Stipends" } } }] } });
    expect(api.spreadsheets.values.update).toHaveBeenCalledWith(expect.objectContaining({ range: "'Stipends'!A1", requestBody: { values: [["a", "b", "c"]] } }));
  });

  it("passes on other read failures when the tab does exist", async () => {
    api.spreadsheets.values.get.mockRejectedValue(new Error("quota exceeded"));
    api.spreadsheets.get.mockResolvedValue(grid(26));
    await expect(new SheetTable<Row>("Requests", ["a", "b", "c"], "a").headers()).rejects.toThrow("quota exceeded");
    expect(api.spreadsheets.batchUpdate).not.toHaveBeenCalled();
  });
});

describe("SheetTable rows", () => {
  type Rec = { a: string; b: string; c: string; n: number };
  const table = () => new SheetTable<Rec>("Requests", ["a", "b", "c", "n"], "a", ["n"]);
  beforeEach(() => vi.clearAllMocks());

  it("reads the header and the records in one call, mapping columns by name and skipping blank keys", async () => {
    api.spreadsheets.values.get.mockResolvedValue({
      data: { values: [["b", "a", "extra", "c", "n"], ["B1", "A1", "x", "C1", 7], ["", "", "", "", ""], ["B3", "A3"]] },
    });
    const rows = await table().readAll();
    expect(api.spreadsheets.values.get).toHaveBeenCalledTimes(1);
    expect(api.spreadsheets.values.get).toHaveBeenCalledWith(expect.objectContaining({ range: "'Requests'" }));
    expect(rows.map((r) => [r.rowNumber, r.row])).toEqual([
      [2, { a: "A1", b: "B1", c: "C1", n: 7 }],
      [4, { a: "A3", b: "B3", c: "", n: 0 }],
    ]);
    expect(api.spreadsheets.values.update).not.toHaveBeenCalled();
  });

  it("updates only the patched cells of a found row, with one read and one write", async () => {
    api.spreadsheets.values.get.mockResolvedValue({ data: { values: [["a", "b", "ap_only", "c", "n"], ["k1", "x", "", "y", 1], ["k2", "p", "AP wrote this", "q", 2]] } });
    await table().update("K2", { b: "changed", n: 0, c: undefined });
    expect(api.spreadsheets.values.get).toHaveBeenCalledTimes(1);
    expect(api.spreadsheets.values.update).not.toHaveBeenCalled();
    expect(api.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(1);
    // Columns found by header name; the cells nobody patched (ap_only, c) aren't written at all, so a change made since the read survives.
    expect(api.spreadsheets.values.batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: "'Requests'!B3", values: [["changed"]] },
          { range: "'Requests'!E3", values: [[0]] },
        ],
      },
    });
  });

  it("updateIf writes the patched cells only when the row passes", async () => {
    api.spreadsheets.values.get.mockResolvedValue({ data: { values: [["a", "b", "c", "n"], ["k1", "free", "y", 1]] } });
    expect(await table().updateIf("k1", (row) => row.b === "held", { c: "z" })).toBe(false);
    expect(api.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
    expect(await table().updateIf("k1", (row) => row.b === "free", { c: "z" })).toBe(true);
    expect(api.spreadsheets.values.batchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: { valueInputOption: "RAW", data: [{ range: "'Requests'!C2", values: [["z"]] }] } }),
    );
  });

  it("refuses to update a key that isn't there", async () => {
    api.spreadsheets.values.get.mockResolvedValue({ data: { values: [["a", "b", "c", "n"]] } });
    await expect(table().update("nope", { b: "x" })).rejects.toThrow("No row with a=nope in Requests");
  });

  it("upsert appends a new key and rewrites an existing one", async () => {
    api.spreadsheets.values.get.mockResolvedValue({ data: { values: [["a", "b", "c", "n"], ["k1", "x", "y", 1]] } });
    await table().upsert({ a: "k9", b: "", c: "", n: 0 });
    expect(api.spreadsheets.values.append).toHaveBeenCalledWith(expect.objectContaining({ range: "'Requests'!A1", requestBody: { values: [["k9", "", "", 0]] } }));
    expect(api.spreadsheets.values.update).not.toHaveBeenCalled();

    await table().upsert({ a: "k1", b: "new", c: "y", n: 1 });
    expect(api.spreadsheets.values.update).toHaveBeenCalledWith(expect.objectContaining({ range: "'Requests'!A2:D2", requestBody: { values: [["k1", "new", "y", 1]] } }));
    expect(api.spreadsheets.values.get).toHaveBeenCalledTimes(2);
  });
});
