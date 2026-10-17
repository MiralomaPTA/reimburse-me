import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "@/server/config";
import type { FileStore, StoredFileMeta } from "@/server/adapters/types";

/**
 * Development stand-in for Google Drive. Files live under .data/files as
 * `<id>` (bytes) and `<id>.json` (metadata). "Direct upload" is simulated by
 * a PUT to /api/local-upload/<id>, which is only mounted when ADAPTERS=local.
 */

interface LocalMeta extends Omit<StoredFileMeta, "attachedTo"> {
  folderPath: string[];
  pending: boolean;
}

function filesDir() {
  return path.join(process.cwd(), config.localDataDir, "files");
}

async function readMeta(id: string): Promise<LocalMeta | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(filesDir(), `${id}.json`), "utf8")) as LocalMeta;
  } catch {
    return null;
  }
}

async function writeMeta(meta: LocalMeta) {
  await fs.mkdir(filesDir(), { recursive: true });
  await fs.writeFile(path.join(filesDir(), `${meta.id}.json`), JSON.stringify(meta, null, 2));
}

function safeId(id: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new Error("Invalid file id");
  return id;
}

/** What the rest of the app sees. A file outside pending/ belongs to the request its folder is named for. */
function publicMeta(meta: LocalMeta): StoredFileMeta {
  const { id, name, mimeType, size, uploader, folderPath } = meta;
  const attachedTo = folderPath[0] === "pending" ? "" : (folderPath[folderPath.length - 1] ?? "");
  return { id, name, mimeType, size, uploader, attachedTo };
}

export const localFileStore: FileStore = {
  async createUploadSession({ name, mimeType, size, uploader }) {
    const id = crypto.randomUUID().replace(/-/g, "");
    await writeMeta({ id, name, mimeType, size, uploader, folderPath: ["pending"], pending: true });
    // Relative, so the browser PUTs to whatever origin it loaded the app from
    // (localhost, 127.0.0.1, a LAN address from a phone) with no CORS involved.
    return { uploadUrl: `/api/local-upload/${id}` };
  },

  async getFileMeta(id) {
    const meta = await readMeta(safeId(id));
    if (!meta || meta.pending) return null;
    return publicMeta(meta);
  },

  async getFileBytes(id) {
    return new Uint8Array(await fs.readFile(path.join(filesDir(), safeId(id))));
  },

  async putFile({ name, mimeType, bytes, folderPath }) {
    const id = crypto.randomUUID().replace(/-/g, "");
    await fs.mkdir(filesDir(), { recursive: true });
    await fs.writeFile(path.join(filesDir(), id), bytes);
    await writeMeta({ id, name, mimeType, size: bytes.byteLength, uploader: "app", folderPath, pending: false });
    return { id };
  },

  async moveFile(id, folderPath) {
    const meta = await readMeta(safeId(id));
    if (!meta) throw new Error(`Unknown file ${id}`);
    await writeMeta({ ...meta, folderPath });
  },
};

/**
 * Called by the local upload route once the browser has PUT the bytes. Like a
 * Drive upload session, it only accepts the bytes from the sign-in that
 * opened it.
 */
export async function completeLocalUpload(id: string, bytes: Uint8Array, uploader: string): Promise<StoredFileMeta> {
  const meta = await readMeta(safeId(id));
  if (!meta || !meta.pending) throw new Error("No pending upload with that id");
  if (meta.uploader.toLowerCase() !== uploader.toLowerCase()) throw new Error("This upload was opened by another sign-in");
  await fs.writeFile(path.join(filesDir(), id), bytes);
  const done = { ...meta, size: bytes.byteLength, pending: false };
  await writeMeta(done);
  return publicMeta(done);
}
