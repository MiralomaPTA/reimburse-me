import { Readable } from "node:stream";
import { drive as driveApi, type drive_v3 } from "@googleapis/drive";
import { googleConfig } from "@/server/config";
import { accessToken, googleAuth } from "@/server/adapters/google/auth";
import type { FileStore } from "@/server/adapters/types";

/**
 * Google Drive implementation. Everything lives under the root folder owned by
 * fs@: uploads land in `pending/`, and each submitted request gets
 * `requests/<FY>/<request id>/`.
 *
 * Receipts are uploaded straight from the browser: the server opens a
 * resumable upload session (which fixes the file's name, folder and
 * `appProperties.uploader`), hands the session URL to the browser, and the
 * browser PUTs the bytes. Drive answers that PUT with the file resource, whose
 * `id` the browser sends back with the form. Moving a receipt into a request's
 * folder also records that request in `appProperties.attachedTo`, so a receipt
 * can't be claimed twice.
 *
 * Folders are looked up by name on every call, one `files.list` per path
 * element, rather than cached. Drive IDs survive renames and moves, but a
 * trashed folder would sit in a cache until the next cold start, and the few
 * extra calls per submission are nothing against the quota.
 */

const FOLDER = "application/vnd.google-apps.folder";
let api: drive_v3.Drive | null = null;

function drive(): drive_v3.Drive {
  if (!api) api = driveApi({ version: "v3", auth: googleAuth() });
  return api;
}

async function folderId(folderPath: string[]): Promise<string> {
  const { rootFolderId } = googleConfig();
  let parent = rootFolderId;
  for (const name of folderPath) {
    const escaped = name.replace(/'/g, "\\'");
    const found = await drive().files.list({
      q: `name='${escaped}' and '${parent}' in parents and mimeType='${FOLDER}' and trashed=false`,
      fields: "files(id)",
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    let id = found.data.files?.[0]?.id ?? null;
    if (!id) {
      const created = await drive().files.create({
        requestBody: { name, mimeType: FOLDER, parents: [parent] },
        fields: "id",
        supportsAllDrives: true,
      });
      id = created.data.id ?? null;
    }
    if (!id) throw new Error(`Could not create Drive folder ${folderPath.join("/")}`);
    parent = id;
  }
  return parent;
}

export const googleFileStore: FileStore = {
  async createUploadSession({ name, mimeType, size, uploader, origin }) {
    const parent = await folderId(["pending"]);
    const response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType,
          "X-Upload-Content-Length": String(size),
          // Drive echoes this origin in the CORS headers of the browser's PUT.
          Origin: origin,
        },
        body: JSON.stringify({
          name,
          mimeType,
          parents: [parent],
          appProperties: { uploader, kind: "receipt" },
        }),
      },
    );
    const uploadUrl = response.headers.get("location");
    if (!response.ok || !uploadUrl) {
      throw new Error(`Drive refused to open an upload session: ${response.status} ${await response.text()}`);
    }
    return { uploadUrl };
  },

  async getFileMeta(id) {
    try {
      const { data } = await drive().files.get({
        fileId: id,
        fields: "id,name,mimeType,size,appProperties,trashed",
        supportsAllDrives: true,
      });
      if (data.trashed || data.appProperties?.kind !== "receipt") return null;
      return {
        id: data.id ?? id,
        name: data.name ?? "receipt",
        mimeType: data.mimeType ?? "application/octet-stream",
        size: Number(data.size ?? 0),
        uploader: data.appProperties?.uploader ?? "",
        attachedTo: data.appProperties?.attachedTo ?? "",
      };
    } catch {
      return null;
    }
  },

  async getFileBytes(id) {
    const { data } = await drive().files.get(
      { fileId: id, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" },
    );
    return new Uint8Array(data as ArrayBuffer);
  },

  async putFile({ name, mimeType, bytes, folderPath }) {
    const parent = await folderId(folderPath);
    const { data } = await drive().files.create({
      requestBody: { name, mimeType, parents: [parent], appProperties: { kind: "packet" } },
      media: { mimeType, body: Readable.from(Buffer.from(bytes)) },
      fields: "id",
      supportsAllDrives: true,
    });
    if (!data.id) throw new Error("Drive did not return a file id");
    return { id: data.id };
  },

  async moveFile(id, folderPath) {
    const target = await folderId(folderPath);
    const { data } = await drive().files.get({ fileId: id, fields: "parents", supportsAllDrives: true });
    await drive().files.update({
      fileId: id,
      addParents: target,
      removeParents: (data.parents ?? []).join(","),
      // Drive merges appProperties, so uploader and kind stay.
      requestBody: { appProperties: { attachedTo: folderPath[folderPath.length - 1] ?? "" } },
      supportsAllDrives: true,
    });
  },
};
