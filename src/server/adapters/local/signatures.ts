import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "@/server/config";
import type { SignatureClaim, SignatureLog } from "@/server/adapters/types";

/** Development stand-in for the Signatures tab: a JSON array in .data/signatures.json, in the order claims were added. */

function claimsPath() {
  return path.join(process.cwd(), config.localDataDir, "signatures.json");
}

async function readAll(): Promise<SignatureClaim[]> {
  try {
    return JSON.parse(await fs.readFile(claimsPath(), "utf8")) as SignatureClaim[];
  } catch {
    return [];
  }
}

async function writeAll(rows: SignatureClaim[]) {
  await fs.mkdir(path.dirname(claimsPath()), { recursive: true });
  await fs.writeFile(claimsPath(), JSON.stringify(rows, null, 2));
}

export const localSignatureLog: SignatureLog = {
  async append(claim) {
    const rows = await readAll();
    rows.push(claim);
    await writeAll(rows);
  },
  async listFor(requestId) {
    return (await readAll()).filter((r) => r.request_id === requestId);
  },
  async update(claimId, patch) {
    const rows = await readAll();
    const index = rows.findIndex((r) => r.claim_id === claimId);
    if (index === -1) throw new Error(`Unknown claim ${claimId}`);
    rows[index] = { ...rows[index], ...patch };
    await writeAll(rows);
  },
};
