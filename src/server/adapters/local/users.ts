import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "@/server/config";
import type { UserDirectory, UserRecord } from "@/server/adapters/types";

/** Development stand-in for the Users tab: a JSON array in .data/users.json. */

function usersPath() {
  return path.join(process.cwd(), config.localDataDir, "users.json");
}

async function readAll(): Promise<UserRecord[]> {
  try {
    return JSON.parse(await fs.readFile(usersPath(), "utf8")) as UserRecord[];
  } catch {
    return [];
  }
}

async function writeAll(rows: UserRecord[]) {
  await fs.mkdir(path.dirname(usersPath()), { recursive: true });
  await fs.writeFile(usersPath(), JSON.stringify(rows, null, 2));
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const localUserDirectory: UserDirectory = {
  async get(email) {
    return (await readAll()).find((r) => same(r.email, email)) ?? null;
  },
  async upsert(record) {
    const rows = await readAll();
    const index = rows.findIndex((r) => same(r.email, record.email));
    if (index === -1) rows.push(record);
    else rows[index] = record;
    await writeAll(rows);
  },
  async countPendingSince(sinceIso) {
    return (await readAll()).filter((r) => r.status === "pending" && r.requested_at >= sinceIso).length;
  },
};
