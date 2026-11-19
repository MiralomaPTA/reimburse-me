import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "@/server/config";
import type { SignatureLog, SignatureRecord } from "@/server/adapters/types";

/** Development stand-in for the Signatures tab: a JSON array in .data/signatures.json. */

function recordsPath() {
  return path.join(process.cwd(), config.localDataDir, "signatures.json");
}

async function readAll(): Promise<SignatureRecord[]> {
  try {
    return JSON.parse(await fs.readFile(recordsPath(), "utf8")) as SignatureRecord[];
  } catch {
    return [];
  }
}

export const localSignatureLog: SignatureLog = {
  async append(record) {
    const rows = await readAll();
    rows.push(record);
    await fs.mkdir(path.dirname(recordsPath()), { recursive: true });
    await fs.writeFile(recordsPath(), JSON.stringify(rows, null, 2));
  },
  async listFor(requestId) {
    return (await readAll()).filter((r) => r.request_id === requestId);
  },
};
