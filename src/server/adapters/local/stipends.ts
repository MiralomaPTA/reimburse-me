import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "@/server/config";
import type { StipendRow, StipendTable } from "@/server/adapters/types";

/** Development stand-in for the Stipends tab: a JSON array in .data/stipends.json. */

export const localStipendTable: StipendTable = {
  async list() {
    try {
      return JSON.parse(await fs.readFile(path.join(process.cwd(), config.localDataDir, "stipends.json"), "utf8")) as StipendRow[];
    } catch {
      return [];
    }
  },
};
