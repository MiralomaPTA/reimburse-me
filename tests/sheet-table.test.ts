import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  spreadsheets: {
    get: vi.fn(),
    batchUpdate: vi.fn(),
    values: { get: vi.fn(), update: vi.fn() },
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
