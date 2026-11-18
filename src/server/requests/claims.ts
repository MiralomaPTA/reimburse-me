import { randomUUID } from "node:crypto";
import type { SignatureClaim, SignatureLog } from "@/server/adapters/types";

/**
 * First claim wins, for each check signer's signature on a mailed check.
 *
 * The Sheet can't update a cell only if nobody has changed it since, so two
 * signers pressing Sign at the same moment could both be recorded as the
 * first, or both as the second, and AP could get two authorized packets and
 * pay twice. Instead each press adds a claim to the Signatures tab and reads
 * back every claim on that signature (request, version and slot). The Sheet
 * keeps rows in the order they were added and a claimant reads only after its
 * own row has landed, so every reader agrees which live claim came first, and
 * only that one goes on to build the files, record the signature and send the
 * emails. A send-back claims the signature it replaces, so a signature and a
 * send-back can't both go through either.
 *
 * A claim that hasn't finished within `timeoutMs` (its process crashed, say)
 * stops counting, and the next press can claim the signature.
 */

export const claimTiming = {
  /** Far longer than a signing takes: the routes allow 60 seconds. */
  timeoutMs: 5 * 60_000,
};

/** Whether `claim` still holds its signature at `now`: finished, or claimed within the time-out. */
export function isLive(claim: Pick<SignatureClaim, "state" | "claimed_at">, now = new Date()): boolean {
  if (claim.state === "signed" || claim.state === "sent back") return true;
  if (claim.state !== "claimed") return false;
  const at = Date.parse(claim.claimed_at);
  return Number.isFinite(at) && now.getTime() - at < claimTiming.timeoutMs;
}

const sameSignature = (a: Pick<SignatureClaim, "request_id" | "version" | "slot">, b: Pick<SignatureClaim, "request_id" | "version" | "slot">) =>
  a.request_id === b.request_id && Number(a.version) === Number(b.version) && Number(a.slot) === Number(b.slot);

export type ClaimInput = Omit<SignatureClaim, "claim_id" | "state" | "claimed_at" | "signed_at" | "packet_sha256" | "fo10_sha256">;

export type ClaimOutcome =
  | { won: true; claim: SignatureClaim; /** Every claim on the request, as read back. */ all: SignatureClaim[] }
  | { won: false; winner: SignatureClaim };

/** Claims a signature. Loses to an earlier live claim on it, and then marks its own claim lost. */
export async function claimSignature(signatures: SignatureLog, input: ClaimInput, now = new Date()): Promise<ClaimOutcome> {
  const claim: SignatureClaim = { ...input, claim_id: randomUUID(), state: "claimed", claimed_at: now.toISOString(), signed_at: "", packet_sha256: "", fo10_sha256: "" };
  await signatures.append(claim);
  const all = await signatures.listFor(input.request_id);
  const onThis = all.filter((c) => sameSignature(c, claim));
  const winner = onThis.find((c) => isLive(c, now));
  // Tidy up after a crash: a claim that ran out of time is marked so in the tab. Best effort; it already doesn't count.
  for (const stale of onThis) {
    if (stale.state === "claimed" && !isLive(stale, now) && stale.claim_id !== claim.claim_id) await signatures.update(stale.claim_id, { state: "abandoned" }).catch(() => undefined);
  }
  if (winner && winner.claim_id !== claim.claim_id) {
    await signatures.update(claim.claim_id, { state: "lost" }).catch(() => undefined);
    return { won: false, winner };
  }
  return { won: true, claim, all };
}

/** Checked before writing anything: whether `claim` still holds its signature (it hasn't run out of time). */
export async function stillHeld(signatures: SignatureLog, claim: SignatureClaim, now = new Date()): Promise<boolean> {
  const all = await signatures.listFor(claim.request_id);
  const winner = all.filter((c) => sameSignature(c, claim)).find((c) => isLive(c, now));
  return winner?.claim_id === claim.claim_id;
}
