import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "@/server/config";
import type { ActionLog, ActionRecord } from "@/server/adapters/types";

/** Development stand-in for the Actions tab: a JSON array in .data/actions.json. */

function recordsPath() {
  return path.join(process.cwd(), config.localDataDir, "actions.json");
}

async function readAll(): Promise<ActionRecord[]> {
  try {
    return JSON.parse(await fs.readFile(recordsPath(), "utf8")) as ActionRecord[];
  } catch {
    return [];
  }
}

export const localActionLog: ActionLog = {
  async append(record) {
    const rows = await readAll();
    rows.push(record);
    await fs.mkdir(path.dirname(recordsPath()), { recursive: true });
    await fs.writeFile(recordsPath(), JSON.stringify(rows, null, 2));
  },
  async listFor(requestId) {
    return (await readAll()).filter((r) => r.request_id === requestId).sort((a, b) => a.at.localeCompare(b.at));
  },
};
