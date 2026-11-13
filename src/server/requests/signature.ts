import type { SignatureInput } from "@/lib/request-schema";
import type { PacketSignature } from "@/server/pdf/types";

/** A signature as the browser sends it, ready to stamp: typed text, or the drawn PNG's bytes. */
export function toPacketSignature(signature: SignatureInput): PacketSignature {
  if (signature.type === "typed") return { type: "typed", name: signature.name };
  const base64 = signature.pngDataUrl.slice("data:image/png;base64,".length);
  return { type: "drawn", png: new Uint8Array(Buffer.from(base64, "base64")) };
}
