import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "@/server/config";
import type { RequestLog, RequestRow } from "@/server/adapters/types";

/** Development stand-in for the request-log Sheet: a JSON array in .data/requests.json. */

function logPath() {
  return path.join(process.cwd(), config.localDataDir, "requests.json");
}

async function readAll(): Promise<RequestRow[]> {
  try {
    return JSON.parse(await fs.readFile(logPath(), "utf8")) as RequestRow[];
  } catch {
    return [];
  }
}

async function writeAll(rows: RequestRow[]) {
  await fs.mkdir(path.dirname(logPath()), { recursive: true });
  await fs.writeFile(logPath(), JSON.stringify(rows, null, 2));
}

export const localRequestLog: RequestLog = {
  async maxSequence(prefix) {
    const rows = await readAll();
    let max = 0;
    for (const row of rows) {
      if (!row.request_id.startsWith(prefix)) continue;
      const n = Number(row.request_id.slice(prefix.length));
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
  },
  async append(row) {
    const rows = await readAll();
    rows.push(row);
    await writeAll(rows);
  },
  async get(requestId) {
    return (await readAll()).find((r) => r.request_id === requestId) ?? null;
  },
  async listByEmail(email) {
    const wanted = email.toLowerCase();
    return (await readAll()).filter((r) => r.requester_email.toLowerCase() === wanted);
  },
  async update(requestId, patch) {
    const rows = await readAll();
    const index = rows.findIndex((r) => r.request_id === requestId);
    if (index === -1) throw new Error(`Unknown request ${requestId}`);
    rows[index] = { ...rows[index], ...patch, updated_at: new Date().toISOString() };
    await writeAll(rows);
  },
};
