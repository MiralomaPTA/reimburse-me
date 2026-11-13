import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "@/server/config";
import type { EventRow, EventTable } from "@/server/adapters/types";

/** Development stand-in for the Events tab: a JSON array in .data/events.json. */

export const localEventTable: EventTable = {
  async list() {
    try {
      return JSON.parse(await fs.readFile(path.join(process.cwd(), config.localDataDir, "events.json"), "utf8")) as EventRow[];
    } catch {
      return [];
    }
  },
};
