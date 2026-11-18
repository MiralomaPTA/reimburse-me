import { createHash } from "node:crypto";
import type { RequestRow } from "@/server/adapters/types";

/** Small helpers the chair and check signer steps share for reading request rows. */

/** The row's version: 1 for a row from before versions, or a cell cleared by hand. */
export const versionOf = (row: Pick<RequestRow, "version">) => Number(row.version) || 1;

/** An address as compared: trimmed and lower-case. */
export const lowerEmail = (email: string) => String(email ?? "").trim().toLowerCase();

/** A comma-separated address cell as lower-case addresses. */
export const addressList = (cell: string) =>
  String(cell ?? "")
    .split(",")
    .map(lowerEmail)
    .filter(Boolean);

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
