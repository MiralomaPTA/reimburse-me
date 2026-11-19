import type { Adapters, RequestRow, StipendRow, UserRecord } from "@/server/adapters/types";
import type { ApprovedSession } from "@/server/auth/session";
import { requesterSentToChairEmail, requesterSentToSignersEmail, type SubmissionEmailInput } from "@/server/email/templates";
import { buildPacket } from "@/server/pdf/build-packet";
import { CONSENT_TEXT, type Packet } from "@/server/pdf/types";
import { sendChairRequests } from "@/server/requests/chair";
import { MAILING_REFUSED, MailingError, mailingRefusal, signersFor } from "@/server/requests/mailing";
import { loadReceiptFiles, type LoadedReceipt } from "@/server/requests/receipts";
import { appendNotes, versionOf } from "@/server/requests/rows";
import { sendPacketOn } from "@/server/requests/send-on";
import { toPacketSignature } from "@/server/requests/signature";
import { FundingError, fundingAsOf, fundingCell, fundingEmailShares, fundingOptions, parseFundingChoice, type FundingOptions } from "@/server/requests/stipends";
import { reachedCells, sendToSigners, signerFlags } from "@/server/requests/signers";
import { packetName, requestFolder, saveStoredRequest, type StoredRequest } from "@/server/requests/stored";
import { chairRouting, eventBudget, findEvent, parseEvents, type ChairRouting, type PtaEvent } from "@/lib/events";
import { formatRequestId, requestIdPrefix } from "@/lib/fiscal-year";
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
  /** 1 for a new request; 2 and up when a returned one was signed again. */
  version: number;
  pdfFileId: string;
  sha256: string;
  pageCount: number;
  /** The requester's stipends with this request counted. */
  funding: FundingOptions;
  /** Set when the request went to its event's chairs to sign before going on to AP: who the email reached, and who it didn't. */
  chair: { event: string; sentTo: string[]; notReached: string[] } | null;
  /** Set when a mailed check went straight to the check signers: how many the email reached, and how many it didn't. */
  signers: { reached: number; notReached: number } | null;
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

/** What signing checks and works out before the packet is built, for a new request or a returned one signed again. */
export interface CheckedSubmission {
  /** As signed: the event spelled the way the Events tab spells it. */
  request: RequestInput;
  receiptFiles: Map<string, LoadedReceipt>;
  stipendRows: StipendRow[];
  /** The whole log, as read before signing. */
  rows: RequestRow[];
  event: PtaEvent | null;
  routing: ChairRouting;
  /** Goes to the event's chairs first. */
  toChair: boolean;
  /** A mailed check with no chair step: goes to the check signers next. */
  toSigners: boolean;
  /** The `funding` cell. */
  funding: string;
}

/**
 * The checks every signing makes, against the Sheet as it is now: the
 * receipts are the requester's own and unused, each line's stipend is one of
 * theirs, the event is on the Events tab's active list, and mailing is
 * switched on for the account (its Users row as read for this request, not
 * when the form opened). For a returned request signed again, `returned`
 * allows the receipts already in its folder, and the event it already names
 * even if that has been made inactive since.
 */
export async function checkSubmission(
  input: Pick<SubmitInput, "request" | "session">,
  adapters: Adapters,
  at: Date,
  returned?: { requestId: string; event: string },
): Promise<CheckedSubmission> {
  const { session } = input;
  const { files, log, stipends, events } = adapters;
  const [receiptFiles, stipendRows, rows, eventRows] = await Promise.all([
    loadReceiptFiles(input.request, session.email, files, returned?.requestId),
    stipends.list(),
    log.list(),
    events.list(),
  ]);
  // A returned request is checked with its own fiscal year's requests, even when signed again after June 30.
  const choices = fundingOptions(session.user, stipendRows, rows, returned ? fundingAsOf(returned.requestId, at) : at).stipends;
  const shares = fundingSplit(input.request);
  for (const share of shares) {
    if (share.funding !== "none" && !choices.some((s) => s.id === share.funding)) {
      throw new FundingError("A line is charged to a stipend that isn't one of yours. Choose another, or \"Not from a stipend\".");
    }
  }
  // Blank when there was nothing to choose; AP can tell "chose none" from "wasn't asked".
  const funding = choices.length > 0 ? fundingCell(shares.map((share) => ({ ...parseFundingChoice(share.funding), cents: share.claimedCents }))) : "";

  // The event must be on the tab's active list; it is recorded under the tab's own spelling.
  const listed = parseEvents(eventRows).filter((e) => e.active || (returned?.event && findEvent([e], returned.event)));
  const event = input.request.event ? findEvent(listed, input.request.event) : null;
  if (input.request.event && !event) {
    throw new EventError(`"${input.request.event}" isn't on the PTA's list of events any more. Choose another event, or "Not for an event".`);
  }
  const request: RequestInput = { ...input.request, event: event?.name ?? "" };
  const routing = chairRouting(event, session.email);
  const toChair = routing.step === "Waiting";
  const mailed = request.checkDelivery === "mail";
  if (mailed && mailingRefusal(session.user)) throw new MailingError(MAILING_REFUSED);
  return { request, receiptFiles, stipendRows, rows, event, routing, toChair, toSigners: mailed && !toChair, funding };
}

/** The packet as the requester signs it, for one version of one request. */
export function buildSignedPacket(input: SubmitInput, checked: CheckedSubmission, requestId: string, version: number, at: Date): Promise<Packet> {
  const { session } = input;
  return buildPacket({
    requestId,
    version,
    submittedAt: at,
    request: checked.request,
    requesterEmail: session.email,
    receiptFiles: checked.receiptFiles,
    signature: toPacketSignature(input.signature),
    audit: {
      requesterEmail: session.email,
      signInMethod: "One-time email link",
      signedInAt: new Date(session.signedInAt),
      ip: input.ip,
      userAgent: input.userAgent,
      consentText: CONSENT_TEXT,
    },
  });
}

type RequestCell =
  | "payee_name"
  | "pta_position"
  | "phone"
  | "check_delivery"
  | "address"
  | "city_zip"
  | "purpose"
  | "line_count"
  | "receipt_count"
  | "total_expense"
  | "donation_to_pta"
  | "reimbursement_claimed"
  | "funding"
  | "event";

/** The row's cells that describe the request as signed. */
export function requestCells(checked: CheckedSubmission): Pick<RequestRow, RequestCell> {
  const { request } = checked;
  const t = totals(request);
  return {
    payee_name: request.payeeName,
    pta_position: request.ptaPosition,
    phone: request.phone,
    check_delivery: request.checkDelivery,
    // For display; the FO10 and AP go by the stored request.
    address: request.address,
    city_zip: request.cityStateZip,
    purpose: request.purpose,
    line_count: request.items.length,
    receipt_count: checked.receiptFiles.size,
    total_expense: moneyPlain(t.totalCents),
    donation_to_pta: moneyPlain(t.donationCents),
    reimbursement_claimed: moneyPlain(t.reimbursementCents),
    funding: checked.funding,
    event: request.event,
  };
}

type StepCell =
  | "status"
  | "chair_step"
  | "chair_sent_to"
  | "chair_sent_at"
  | "chair_signed_by"
  | "chair_name"
  | "chair_signed_at"
  | "chair_note"
  | "chair_ip"
  | "chair_user_agent"
  | "chair_pdf_file_id"
  | "chair_pdf_sha256"
  | "signers_step"
  | "signers_sent_to"
  | "signers_sent_at"
  | "signer_1_email"
  | "signer_1_name"
  | "signer_1_signed_at"
  | "signer_1_note"
  | "signer_2_email"
  | "signer_2_name"
  | "signer_2_signed_at"
  | "signer_2_note"
  | "budget_account"
  | "payment_account"
  | "fo10_file_id"
  | "fo10_sha256"
  | "authorized_pdf_file_id"
  | "authorized_pdf_sha256"
  | "authorized_sent_at"
  | "authorized_send_error";

/**
 * The cells of every step after the requester's, as a version starts them:
 * the chair's or the check signers' step waiting when it applies, and
 * everything a later step fills in blank. A new version starts clean, so
 * nothing an earlier version's chair or check signers did carries over; their
 * files stay in Drive and their signatures in the Signatures tab.
 */
export function stepCells(checked: CheckedSubmission, requesterEmail: string, at: Date): Pick<RequestRow, StepCell> {
  const { routing, toChair, toSigners } = checked;
  const iso = at.toISOString();
  return {
    status: toChair ? "Awaiting chair" : toSigners ? "Awaiting signers" : "Submitted",
    chair_step: routing.step,
    // Narrowed once sent to the chairs the email reached; cleared if it reached none, so the requester can resend at once.
    chair_sent_to: routing.chairs.join(", "),
    chair_sent_at: toChair ? iso : "",
    chair_signed_by: "",
    chair_name: "",
    chair_signed_at: "",
    chair_note: "",
    chair_ip: "",
    chair_user_agent: "",
    chair_pdf_file_id: "",
    chair_pdf_sha256: "",
    signers_step: toSigners ? "Waiting" : "",
    // Narrowed once sent to the signers the email reached.
    signers_sent_to: toSigners ? signersFor(requesterEmail).join(", ") : "",
    signers_sent_at: toSigners ? iso : "",
    signer_1_email: "",
    signer_1_name: "",
    signer_1_signed_at: "",
    signer_1_note: "",
    signer_2_email: "",
    signer_2_name: "",
    signer_2_signed_at: "",
    signer_2_note: "",
    budget_account: "",
    payment_account: "",
    fo10_file_id: "",
    fo10_sha256: "",
    authorized_pdf_file_id: "",
    authorized_pdf_sha256: "",
    authorized_sent_at: "",
    authorized_send_error: "",
  };
}

/** What happened after the row was written. */
interface Sent {
  /** The requester's stipends with this version counted. */
  funding: FundingOptions;
  chair: SubmitResult["chair"];
  signers: SubmitResult["signers"];
  emailError?: string;
}

/**
 * What follows once a version's row is written: the receipts not yet in the
 * request's folder are moved there, and the emails go to the event's chairs,
 * the check signers, or on to AP (see config.sendPacketsTo), with the
 * requester's copy. Trouble is noted on the row and reported, never retried
 * and never thrown: the request is recorded either way.
 */
export async function sendSigned(
  args: { row: RequestRow; stored: StoredRequest; checked: CheckedSubmission; packetBytes: Uint8Array; user: UserRecord; linkBase: string },
  adapters: Adapters,
): Promise<Sent> {
  const { row, stored, checked } = args;
  const { files, log, mailer } = adapters;
  const { request } = checked;
  const requestId = row.request_id;
  const version = versionOf(row);
  const submittedAt = new Date(stored.submittedAt);
  const tag = version > 1 ? "[resubmit]" : "[submit]";
  const when = version > 1 ? `when version ${version} was signed` : "at submission";
  // The log with this version in place of the row as read, so it counts against its stipends and the event's budget.
  const rows = [...checked.rows.filter((r) => r.request_id !== requestId), row];
  const after = fundingOptions(args.user, checked.stipendRows, rows, fundingAsOf(requestId, submittedAt));

  const problems: string[] = [];
  const patch: Partial<RequestRow> = {};
  try {
    const toMove = [...checked.receiptFiles.values()].filter((r) => !r.attached).map((r) => r.fileId);
    await Promise.all(toMove.map((id) => files.moveFile(id, requestFolder(row))));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${tag} could not move the receipts of ${requestId}: ${message}`);
    problems.push(`Receipts could not be moved into the request folder: ${message}`);
  }

  const emailInput: SubmissionEmailInput = {
    requestId,
    request,
    requesterEmail: row.requester_email,
    submittedAt,
    sha256: row.pdf_sha256,
    version,
    funding: fundingEmailShares(after, request),
    linkBase: args.linkBase,
    answers: stored.answers,
  };
  const attachment = { filename: packetName(requestId, version), mimeType: "application/pdf", bytes: args.packetBytes };
  let emailError: string | undefined;
  let chairs: { sent: string[]; failed: string[] } | null = null;
  let signers: { sent: string[]; failed: string[] } | null = null;
  if (checked.toChair) {
    const budget = checked.event ? eventBudget(checked.event, rows, { requestId, claimedCents: totals(request).reimbursementCents }) : null;
    const sent = await sendChairRequests({ ...emailInput, chairs: checked.routing.chairs, attachment, budget }, mailer);
    chairs = sent;
    if (sent.error) {
      emailError = sent.error;
      console.error(`${tag} email to the ${request.event} chair failed for ${requestId}: ${sent.error}`);
      problems.push(`Email to the chair (${sent.failed.join(", ")}) failed ${when}: ${sent.error}`);
      // Only who it reached, so the request page offers to send it to the rest at once.
      patch.chair_sent_to = sent.sent.join(", ");
      if (sent.sent.length === 0) patch.chair_sent_at = "";
    }
  }
  if (checked.toSigners) {
    // The log as read before signing, for the requester's earlier requests, without reading it again.
    const flags = signerFlags(row, request, checked.rows);
    const sent = await sendToSigners({ row, stored, linkBase: args.linkBase, packetBytes: args.packetBytes, flags, first: null }, adapters);
    signers = sent;
    if (sent.error) {
      // Only when nobody has it: the requester's email says who it missed.
      if (sent.sent.length === 0) emailError = sent.error;
      console.error(`${tag} email to the check signers failed for ${requestId}: ${sent.error}`);
      problems.push(`Email to the check signers${sent.failed.length ? ` (${sent.failed.join(", ")})` : ""} failed ${when}: ${sent.error}`);
      Object.assign(patch, reachedCells(sent.sent));
    }
  }
  try {
    if (chairs) {
      const mail = requesterSentToChairEmail(emailInput, chairs.sent, chairs.failed);
      await mailer.send({ to: [row.requester_email], subject: mail.subject, text: mail.text, attachments: [attachment] });
    } else if (signers) {
      const mail = requesterSentToSignersEmail(emailInput, signers.failed, signers.sent.length === 0);
      await mailer.send({ to: [row.requester_email], subject: mail.subject, text: mail.text, attachments: [attachment] });
    } else {
      await sendPacketOn(emailInput, attachment, mailer);
    }
  } catch (error) {
    emailError ??= error instanceof Error ? error.message : String(error);
    console.error(`${tag} email failed for ${requestId}: ${emailError}`);
    problems.push(`Email failed ${when}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (Object.keys(patch).length > 0) await log.update(requestId, patch).catch(() => undefined);
  await appendNotes(log, requestId, problems);

  return {
    funding: after,
    chair: chairs ? { event: request.event, sentTo: chairs.sent, notReached: chairs.failed } : null,
    signers: signers ? { reached: signers.sent.length, notReached: signers.failed.length } : null,
    emailError,
  };
}

/** What the form shows once a version is signed. */
export function submitResult(row: RequestRow, packet: Packet, sent: Sent): SubmitResult {
  const result: SubmitResult = {
    requestId: row.request_id,
    version: versionOf(row),
    pdfFileId: row.pdf_file_id,
    sha256: packet.sha256,
    pageCount: packet.pageCount,
    funding: sent.funding,
    chair: sent.chair,
    signers: sent.signers,
    emailed: !sent.emailError,
  };
  return sent.emailError ? { ...result, emailError: sent.emailError } : result;
}

/**
 * Signs, stores, logs and emails a new request.
 *
 * A request for a PTA event whose chair isn't the requester goes to that
 * event's chairs first, as "Awaiting chair"; one of them signs the form's
 * VP/Chairman line and the co-signed packet goes on from there (see
 * chair.ts). A mailed check goes to the PTA's check signers next, as
 * "Awaiting signers", and reaches AP once two have signed its FO10 (see
 * signers.ts). Every other request goes on now, to wherever
 * `config.sendPacketsTo` sends packets: to AP with a copy to the requester,
 * or only to the requester, who forwards it to AP by hand. A returned
 * request signed again takes the same path (see resubmit.ts).
 *
 * The order decides what a failure leaves behind. The PDF and the request's
 * JSON are stored, then the row is written, and only then are the receipts
 * moved and the emails sent. Failing in the first steps leaves at most an
 * orphan file in Drive and the requester simply tries again. Trouble in the
 * last two is noted on the row and reported, never retried, so no request is
 * ever logged twice.
 */
export async function submitRequest(input: SubmitInput, adapters: Adapters): Promise<SubmitResult> {
  const { session } = input;
  const { files, log } = adapters;
  const submittedAt = new Date();
  const checked = await checkSubmission(input, adapters, submittedAt);
  const build = (requestId: string) => buildSignedPacket(input, checked, requestId, 1, submittedAt);

  // The ID is printed in the PDF, so it is chosen before the packet is built,
  // and building takes seconds. Another submission may take the number in
  // that time, so check again just before claiming it and rebuild if it did.
  // What remains is the moment between this check and the row being written.
  const prefix = requestIdPrefix(submittedAt);
  let sequence = maxSequenceIn(checked.rows, prefix) + 1;
  let requestId = formatRequestId(prefix, sequence);
  let packet = await build(requestId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await log.maxSequence(prefix);
    if (latest < sequence) break;
    sequence = latest + 1;
    requestId = formatRequestId(prefix, sequence);
    packet = await build(requestId);
  }

  const folderPath = requestFolder({ request_id: requestId, submitted_at: submittedAt.toISOString() });
  const saved = await files.putFile({ name: packetName(requestId, 1), mimeType: "application/pdf", bytes: packet.bytes, folderPath });
  const storedRequest: StoredRequest = {
    requestId,
    version: 1,
    submittedAt: submittedAt.toISOString(),
    requesterEmail: session.email,
    request: checked.request,
    packet: { sha256: packet.sha256, pageCount: packet.pageCount, chairLine: packet.chairLine },
  };
  const requestFileId = await saveStoredRequest(files, folderPath, storedRequest);

  const row: RequestRow = {
    request_id: requestId,
    submitted_at: submittedAt.toISOString(),
    requester_email: session.email,
    ...requestCells(checked),
    pdf_file_id: saved.id,
    pdf_sha256: packet.sha256,
    signature_type: input.signature.type,
    budget_category: "",
    check_number: "",
    paid_date: "",
    returned_note: "",
    version: 1,
    updated_at: submittedAt.toISOString(),
    notes: "",
    request_file_id: requestFileId,
    lock: "",
    ...stepCells(checked, session.email, submittedAt),
    returned_at: "",
    returned_by: "",
    previous_pdf_file_ids: "",
  };
  await log.append(row);

  // From here on the request exists; anything that goes wrong is noted on the row rather than failing the submission.
  const sent = await sendSigned({ row, stored: storedRequest, checked, packetBytes: packet.bytes, user: session.user, linkBase: input.linkBase }, adapters);
  return submitResult(row, packet, sent);
}
