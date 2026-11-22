import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "@/server/config";
import type { CategoryRow, CategoryTable } from "@/server/adapters/types";

/** Development stand-in for the Categories tab: a JSON array in .data/categories.json. */

export const localCategoryTable: CategoryTable = {
  async list() {
    try {
      return JSON.parse(await fs.readFile(path.join(process.cwd(), config.localDataDir, "categories.json"), "utf8")) as CategoryRow[];
    } catch {
      return [];
    }
  },
};
