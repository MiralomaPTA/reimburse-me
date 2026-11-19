import { createHash } from "node:crypto";

/** A file's SHA-256 as lower-case hex: the hash every packet, FO10 and request row records. */
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
