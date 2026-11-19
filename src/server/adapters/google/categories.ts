import { googleConfig } from "@/server/config";
import { SheetTable } from "@/server/adapters/google/sheet-table";
import { CATEGORY_COLUMNS, type CategoryRow, type CategoryTable } from "@/server/adapters/types";

/** The budget categories AP can give a request: the `Categories` tab, created with its header row on first use and kept by the treasurer. */

let table: SheetTable<CategoryRow> | null = null;

function categories(): SheetTable<CategoryRow> {
  if (!table) table = new SheetTable<CategoryRow>(googleConfig().categoriesSheetName, CATEGORY_COLUMNS, "name");
  return table;
}

export const googleCategoryTable: CategoryTable = {
  async list() {
    return (await categories().readAll()).map((r) => r.row);
  },
};
