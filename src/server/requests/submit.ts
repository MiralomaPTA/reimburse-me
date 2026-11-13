import type { Adapters, RequestRow } from "@/server/adapters/types";
import type { ApprovedSession } from "@/server/auth/session";
import { requesterSentToChairEmail } from "@/server/email/templates";
import { buildPacket } from "@/server/pdf/build-packet";
import { CONSENT_TEXT } from "@/server/pdf/types";
import { sendChairRequests } from "@/server/requests/chair";
import { loadReceiptFiles } from "@/server/requests/receipts";
import { sendPacketOn } from "@/server/requests/send-on";
import { toPacketSignature } from "@/server/requests/signature";
import { FundingError, fundingCell, fundingEmailShares, fundingOptions, parseFundingChoice, type FundingOptions } from "@/server/requests/stipends";
import { saveStoredRequest } from "@/server/requests/stored";
import { chairRouting, eventBudget, findEvent, parseEvents } from "@/lib/events";
import { fiscalYearLabel, formatRequestId, requestIdPrefix } from "@/lib/fiscal-year";
import { moneyPlain } from "@/lib/money";
import { fundingSplit, totals, type RequestInput, type SignatureInput } from "@/lib/request-schema";

export interface SubmitInput {
  request: RequestInput;
  signature: SignatureInput;
  /** The requester, already checked against the Users tab. */
  session: ApprovedSession;
  ip: string;
  userAgent: string;
  /** Base URL for the links in the emails. */
  linkBase: string;
}

export interface SubmitResult {
  requestId: string;
  pdfFileId: string;
  sha256: string;
  pageCount: number;
  /** The requester's stipends with this request counted. */
  funding: FundingOptions;
  /** Set when the request went to its event's chairs to sign before going on to AP: who the email reached, and who it didn't. */
  chair: { event: string; sentTo: string[]; notReached: string[] } | null;
  /** false when the row was written but an email could not be sent. */
  emailed: boolean;
  emailError?: string;
}

/** The request names an event that isn't on the Events tab's active list (removed while the form was open, say). */
export class EventError extends Error {}

/** Highest sequence number among `rows` whose ID starts with `prefix` (0 if none). */
export function maxSequenceIn(rows: Pick<RequestRow, "request_id">[], prefix: string): number {
  let max = 0;
  for (const row of rows) {
    if (!row.request_id.startsWith(prefix)) continue;
    const n = Number(row.request_id.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/**
 * Signs, stores, logs and emails a new request.
 *
 * A request for a PTA event whose chair isn't the requester goes to that
 * event's chairs first, as "Awaiting chair"; one of them signs the form's
 * VP/Chairman line and the co-signed packet goes on from there (see
 * chair.ts). Every other request goes on now, to wherever
 * `config.sendPacketsTo` sends packets: to AP with a copy to the requester,
 * or only to the requester, who forwards it to AP by hand.
 *
 * The order decides what a failure leaves behind. The PDF and the request's
 * JSON are stored, then the row is written, and only then are the receipts
 * moved and the emails sent. Failing in the first steps leaves at most an
 * orphan file in Drive and the requester simply tries again. Trouble in the
 * last two is noted on the row and reported, never retried, so no request is
 * ever logged twice.
 */
export async function submitRequest(input: SubmitInput, adapters: Adapters): Promise<SubmitResult> {
  const { session, ip, userAgent } = input;
  const { files, log, mailer, stipends, events } = adapters;
  const { user } = session;
  const submittedAt = new Date();
  const [receiptFiles, stipendRows, earlierRows, eventRows] = await Promise.all([
    loadReceiptFiles(input.request, session.email, files),
    stipends.list(),
    log.list(),
    events.list(),
  ]);
  const choices = fundingOptions(user, stipendRows, earlierRows, submittedAt).stipends;
  const shares = fundingSplit(input.request);
  for (const share of shares) {
    if (share.funding !== "none" && !choices.some((s) => s.id === share.funding)) {
      throw new FundingError("A line is charged to a stipend that isn't one of yours. Choose another, or \"Not from a stipend\".");
    }
  }
  // Blank when there was nothing to choose; AP can tell "chose none" from "wasn't asked".
  const funding = choices.length > 0 ? fundingCell(shares.map((share) => ({ ...parseFundingChoice(share.funding), cents: share.claimedCents }))) : "";

  // The event must be on the tab's active list; it is recorded under the tab's own spelling.
  const event = input.request.event ? findEvent(parseEvents(eventRows).filter((e) => e.active), input.request.event) : null;
  if (input.request.event && !event) {
    throw new EventError(`"${input.request.event}" isn't on the PTA's list of events any more. Choose another event, or "Not for an event".`);
  }
  const request: RequestInput = { ...input.request, event: event?.name ?? "" };
  const routing = chairRouting(event, session.email);
  const toChair = routing.step === "Waiting";

  const signature = toPacketSignature(input.signature);
  const build = (requestId: string) =>
    buildPacket({
      requestId,
      submittedAt,
      request,
      requesterEmail: session.email,
      receiptFiles,
      signature,
      audit: {
        requesterEmail: session.email,
        signInMethod: "One-time email link",
        signedInAt: new Date(session.signedInAt),
        ip,
        userAgent,
        consentText: CONSENT_TEXT,
      },
    });

  // The ID is printed in the PDF, so it is chosen before the packet is built,
  // and building takes seconds. Another submission may take the number in
  // that time, so check again just before claiming it and rebuild if it did.
  // What remains is the moment between this check and the row being written.
  const prefix = requestIdPrefix(submittedAt);
  let sequence = maxSequenceIn(earlierRows, prefix) + 1;
  let requestId = formatRequestId(prefix, sequence);
  let packet = await build(requestId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await log.maxSequence(prefix);
    if (latest < sequence) break;
    sequence = latest + 1;
    requestId = formatRequestId(prefix, sequence);
    packet = await build(requestId);
  }

  const folderPath = ["requests", fiscalYearLabel(submittedAt), requestId];
  const pdfName = `${requestId}.pdf`;
  const stored = await files.putFile({ name: pdfName, mimeType: "application/pdf", bytes: packet.bytes, folderPath });
  const requestFileId = await saveStoredRequest(files, folderPath, {
    requestId,
    version: 1,
    submittedAt: submittedAt.toISOString(),
    requesterEmail: session.email,
    request,
    packet: { sha256: packet.sha256, pageCount: packet.pageCount, chairLine: packet.chairLine },
  });

  const t = totals(request);
  const row: RequestRow = {
    request_id: requestId,
    status: toChair ? "Awaiting chair" : "Submitted",
    submitted_at: submittedAt.toISOString(),
    requester_email: session.email,
    payee_name: request.payeeName,
    pta_position: request.ptaPosition,
    phone: request.phone,
    check_delivery: request.checkDelivery,
    address: "",
    city_zip: "",
    purpose: request.purpose,
    line_count: request.items.length,
    receipt_count: receiptFiles.size,
    total_expense: moneyPlain(t.totalCents),
    donation_to_pta: moneyPlain(t.donationCents),
    reimbursement_claimed: moneyPlain(t.reimbursementCents),
    pdf_file_id: stored.id,
    pdf_sha256: packet.sha256,
    signature_type: signature.type,
    budget_category: "",
    check_number: "",
    paid_date: "",
    returned_note: "",
    version: 1,
    updated_at: submittedAt.toISOString(),
    notes: "",
    funding,
    event: request.event,
    chair_step: routing.step,
    // Narrowed below to the chairs the email reached; cleared if it reached none, so the requester can resend at once.
    chair_sent_to: routing.chairs.join(", "),
    chair_sent_at: toChair ? submittedAt.toISOString() : "",
    chair_signed_by: "",
    chair_name: "",
    chair_signed_at: "",
    chair_note: "",
    chair_pdf_file_id: "",
    chair_pdf_sha256: "",
    request_file_id: requestFileId,
    lock: "",
  };
  await log.append(row);
  const after = fundingOptions(user, stipendRows, [...earlierRows, row], submittedAt);

  // From here on the request exists; anything that goes wrong is noted on the row rather than failing the submission.
  const problems: string[] = [];
  const patch: Partial<RequestRow> = {};
  try {
    await Promise.all([...receiptFiles.keys()].map((id) => files.moveFile(id, folderPath)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[submit] could not move the receipts of ${requestId}: ${message}`);
    problems.push(`Receipts could not be moved into the request folder: ${message}`);
  }

  const emailInput = {
    requestId,
    request,
    requesterEmail: session.email,
    submittedAt,
    sha256: packet.sha256,
    version: 1,
    funding: fundingEmailShares(after, request),
    linkBase: input.linkBase,
  };
  const attachment = { filename: pdfName, mimeType: "application/pdf", bytes: packet.bytes };
  let emailError: string | undefined;
  let chairs: { sent: string[]; failed: string[] } | null = null;
  if (toChair) {
    const budget = event ? eventBudget(event, [...earlierRows, row], { requestId, claimedCents: t.reimbursementCents }) : null;
    const sent = await sendChairRequests({ ...emailInput, chairs: routing.chairs, attachment, budget }, mailer);
    chairs = sent;
    if (sent.error) {
      emailError = sent.error;
      console.error(`[submit] email to the ${request.event} chair failed for ${requestId}: ${sent.error}`);
      problems.push(`Email to the chair (${sent.failed.join(", ")}) failed at submission: ${sent.error}`);
      // Only who it reached, so the request page offers to send it to the rest at once.
      patch.chair_sent_to = sent.sent.join(", ");
      if (sent.sent.length === 0) patch.chair_sent_at = "";
    }
  }
  try {
    if (chairs) {
      const mail = requesterSentToChairEmail(emailInput, chairs.sent, chairs.failed);
      await mailer.send({ to: [session.email], subject: mail.subject, text: mail.text, attachments: [attachment] });
    } else {
      await sendPacketOn(emailInput, attachment, mailer);
    }
  } catch (error) {
    emailError ??= error instanceof Error ? error.message : String(error);
    console.error(`[submit] email failed for ${requestId}: ${emailError}`);
    problems.push(`Email failed at submission: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (problems.length > 0) await log.update(requestId, { ...patch, notes: problems.join(" | ") }).catch(() => undefined);

  const result: SubmitResult = {
    requestId,
    pdfFileId: stored.id,
    sha256: packet.sha256,
    pageCount: packet.pageCount,
    funding: after,
    chair: chairs ? { event: request.event, sentTo: chairs.sent, notReached: chairs.failed } : null,
    emailed: !emailError,
  };
  return emailError ? { ...result, emailError } : result;
}
