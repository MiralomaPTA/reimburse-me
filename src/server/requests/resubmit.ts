import type { Adapters, RequestRow } from "@/server/adapters/types";
import { config } from "@/server/config";
import { BusyError, withRequestLock } from "@/server/requests/lock";
import { lowerEmail as lower, versionOf } from "@/server/requests/rows";
import { sentBackBy } from "@/server/requests/signers";
import { packetName, requestFolder, saveStoredRequest, type ReturnAnswered, type StoredRequest } from "@/server/requests/stored";
import { buildSignedPacket, checkSubmission, requestCells, sendSigned, stepCells, submitResult, type SubmitInput, type SubmitResult } from "@/server/requests/submit";

/**
 * "Fix and re-sign". A returned request, whoever sent it back (its event
 * chair, a check signer, or AP), opens in the form again as it was signed,
 * receipts included; the requester changes what they like and signs it again
 * as its next version. The version keeps the request ID and gets its own
 * packet and JSON beside the earlier ones (FY27-042-v2.pdf, FY27-042-v2.json),
 * which are never changed or deleted; the row points at the new ones and
 * lists the earlier packets in `previous_pdf_file_ids`.
 *
 * A version takes the same path a new request does (submit.ts): to the
 * event's chairs, who sign every version, then to the check signers for a
 * mailed check, or on to AP. Every later step starts clean, so links from
 * earlier versions stop working and nothing an earlier chair or check signer
 * did carries over. The emails say which return the version answers.
 */

export class ResubmitError extends Error {}

const CHANGED = "This request was signed again since you opened it, perhaps in another tab. Open it from My requests to see where it stands.";

/** Why `email` can't fix and re-sign `row` now; null when they can. */
export function fixProblem(row: RequestRow | null, email: string): string | null {
  if (!row || lower(row.requester_email) !== lower(email)) return "That request wasn't found.";
  if (row.status !== "Returned") return "This request isn't waiting for a fix. It may have been signed again already, perhaps in another tab.";
  // Requests from before every submission saved its JSON have nothing to fill the form from.
  if (!row.request_file_id) return `This request is from before the portal kept a copy it can fill the form in from. Start a new request with the change, or ask the PTA at ${config.apEmail}.`;
  return null;
}

/** Who sent `row` back, in the requester's words: "the Fun Run chair (lillie@example.org)". */
export async function returnedBy(row: RequestRow, signatures: Adapters["signatures"]): Promise<string> {
  if (row.chair_step === "Sent back") return `the ${row.event} chair${row.returned_by ? ` (${row.returned_by})` : ""}`;
  if (row.signers_step === "Sent back") {
    const record = await sentBackBy(signatures, row);
    return record?.signer_name ? `${record.signer_name}, one of the PTA's check signers` : "one of the PTA's check signers";
  }
  // Phase 2's Return with a note, or a status set by hand in the Sheet.
  return "the PTA's accounts payable team";
}

export interface ResubmitInput extends SubmitInput {
  requestId: string;
  /** The version the form was filled in from, so a second tab can't sign over a version signed since. */
  version: number;
}

/**
 * Signs a returned request again as its next version. The checks are a new
 * request's, except that the receipts already in its folder and the event it
 * already names may be used again. The packet is built first; then, under the
 * row's lock, the row is checked to be still Returned at the version the form
 * showed, the files are stored, and the row is pointed at them, so a double
 * press or a second tab makes one version, not two.
 */
export async function resubmitRequest(input: ResubmitInput, adapters: Adapters): Promise<SubmitResult> {
  const { session } = input;
  const { files, log, signatures } = adapters;
  const returned = await log.get(input.requestId);
  const problem = fixProblem(returned, session.email);
  if (problem || !returned) throw new ResubmitError(problem ?? "That request wasn't found.");
  if (versionOf(returned) !== input.version) throw new ResubmitError(CHANGED);

  const requestId = returned.request_id;
  const version = versionOf(returned) + 1;
  const submittedAt = new Date();
  const [checked, by] = await Promise.all([
    checkSubmission(input, adapters, submittedAt, { requestId, event: returned.event }),
    returnedBy(returned, signatures),
  ]);
  const answers: ReturnAnswered = { note: returned.returned_note, by, at: returned.returned_at };
  // Built before the lock, which it doesn't need, so the lock is held only while the row is checked and written.
  const packet = await buildSignedPacket(input, checked, requestId, version, submittedAt);

  const signed = await withRequestLock(log, requestId, async (current) => {
    const again = fixProblem(current, session.email);
    if (again) throw new ResubmitError(again);
    if (versionOf(current) !== input.version) throw new ResubmitError(CHANGED);
    const folder = requestFolder(current);
    const saved = await files.putFile({ name: packetName(requestId, version), mimeType: "application/pdf", bytes: packet.bytes, folderPath: folder });
    const stored: StoredRequest = {
      requestId,
      version,
      submittedAt: submittedAt.toISOString(),
      requesterEmail: session.email,
      request: checked.request,
      packet: { sha256: packet.sha256, pageCount: packet.pageCount, chairLine: packet.chairLine },
      answers,
    };
    const requestFileId = await saveStoredRequest(files, folder, stored);
    const patch: Partial<RequestRow> = {
      submitted_at: submittedAt.toISOString(),
      ...requestCells(checked),
      pdf_file_id: saved.id,
      pdf_sha256: packet.sha256,
      signature_type: input.signature.type,
      version,
      request_file_id: requestFileId,
      previous_pdf_file_ids: [current.previous_pdf_file_ids, current.pdf_file_id].filter(Boolean).join(", "),
      ...stepCells(checked, session.email, submittedAt),
    };
    return { patch, result: { row: { ...current, ...patch, lock: "" }, stored } };
  }).catch((error: unknown) => {
    if (error instanceof BusyError) throw new ResubmitError("This request is being signed right now, perhaps in another tab. Open it from My requests in a minute to see where it stands.");
    throw error;
  });

  // From here on the new version is recorded; anything that goes wrong is noted on the row, as for a new request.
  const sent = await sendSigned({ row: signed.row, stored: signed.stored, checked, packetBytes: packet.bytes, user: session.user, linkBase: input.linkBase }, adapters);
  return submitResult(signed.row, packet, sent);
}
