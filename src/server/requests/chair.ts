import { createHash } from "node:crypto";
import type { Adapters, MailAttachment, Mailer, RequestRow } from "@/server/adapters/types";
import { config } from "@/server/config";
import { createChairToken, verifyChairToken, type ChairLink } from "@/server/auth/tokens";
import { chairRequestEmail, chairSignedEmail } from "@/server/email/templates";
import { countersignPacket } from "@/server/pdf/countersign";
import { chairConsentText } from "@/server/pdf/types";
import { BusyError, withRequestLock } from "@/server/requests/lock";
import { sendPacketOn } from "@/server/requests/send-on";
import { toPacketSignature } from "@/server/requests/signature";
import { fundingEmailShares, fundingOptions } from "@/server/requests/stipends";
import { cosignedName, loadStoredRequest, type StoredRequest } from "@/server/requests/stored";
import { formatDateTime, parseDate } from "@/lib/dates";
import { eventBudget, findEvent, parseEvents, type EventBudget, type PtaEvent } from "@/lib/events";
import { fiscalYearLabel } from "@/lib/fiscal-year";
import { parseMoney } from "@/lib/money";
import type { RequestInput, SignatureInput } from "@/lib/request-schema";

/**
 * The event chair's step. A request for an event goes to its chairs before it
 * goes on to AP; each chair gets their own link, good for one version of one
 * request. Any one of them signs the form's VP/Chairman line, which makes a
 * co-signed copy of the packet, and that copy goes on to AP the way every
 * packet does (see config.sendPacketsTo).
 */

/** The page a chair's link opens. */
export const chairLinkPath = (requestId: string, token: string) => `/chair/${encodeURIComponent(requestId)}?t=${encodeURIComponent(token)}`;

const versionOf = (row: RequestRow) => Number(row.version) || 1;

/** A comma-separated address cell as lower-case addresses. */
const addresses = (cell: string) =>
  String(cell ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

/**
 * Who may sign `row` as chair now: its event's chairs in the Events tab, or,
 * when the event is no longer in the tab at all (renamed or deleted), the
 * chairs the request already reached, so it isn't stranded. While the event
 * is in the tab the tab decides, so taking a chair off it ends their access
 * at once. Never the requester.
 */
export function signingChairs(row: Pick<RequestRow, "event" | "chair_sent_to" | "requester_email">, events: PtaEvent[]): string[] {
  const event = findEvent(events, row.event);
  const requester = row.requester_email.trim().toLowerCase();
  return (event ? event.chairs : addresses(row.chair_sent_to)).filter((chair) => chair !== requester);
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export interface ChairRequestInput {
  requestId: string;
  version: number;
  request: RequestInput;
  requesterEmail: string;
  submittedAt: Date;
  /** Of the requester-signed packet, which is attached. */
  sha256: string;
  chairs: string[];
  linkBase: string;
  attachment: MailAttachment;
  /** The requester asked for it to be sent again. */
  reminder?: boolean;
  /** Where the event's budget stands around this request, when it has one. */
  budget: EventBudget | null;
}

/**
 * Emails each chair their own link. Replies go to AP, not the requester: a
 * reply quotes the email, link and all, and the link is all it takes to sign
 * as the chair. Never throws: says who was reached and why the others weren't.
 */
export async function sendChairRequests(input: ChairRequestInput, mailer: Mailer): Promise<{ sent: string[]; failed: string[]; error?: string }> {
  const results = await Promise.allSettled(
    input.chairs.map(async (chair) => {
      const token = await createChairToken(chair, input.requestId, input.version);
      const mail = chairRequestEmail({ ...input, link: `${input.linkBase}${chairLinkPath(input.requestId, token)}`, chairCount: input.chairs.length });
      await mailer.send({ to: [chair], replyTo: config.apEmail, subject: mail.subject, text: mail.text, attachments: [input.attachment] });
    }),
  );
  const sent = input.chairs.filter((_, i) => results[i].status === "fulfilled");
  const failed = input.chairs.filter((_, i) => results[i].status === "rejected");
  const firstError = results.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
  return firstError ? { sent, failed, error: firstError instanceof Error ? firstError.message : String(firstError) } : { sent, failed };
}

export type ChairLinkState =
  | { kind: "invalid" }
  /** The request was re-signed since this link was sent. */
  | { kind: "stale"; row: RequestRow }
  /** The address is no longer listed as a chair of the request's event. */
  | { kind: "not-chair"; row: RequestRow; link: ChairLink }
  | { kind: "signed"; row: RequestRow; link: ChairLink }
  /** No longer waiting for a chair: sent back, timed out, or changed by hand in the Sheet. */
  | { kind: "closed"; row: RequestRow }
  | {
      kind: "ready";
      row: RequestRow;
      link: ChairLink;
      stored: StoredRequest;
      budget: EventBudget | null;
      /** The whole log as read for the budget, so signing needn't read it again. */
      rows: RequestRow[];
    };

type CheckedLink = Exclude<ChairLinkState, { kind: "ready" }> | { kind: "open"; row: RequestRow; link: ChairLink; rows: RequestRow[]; event: PtaEvent | null };

/**
 * The checks every use of a link makes, against the request's row and the
 * Events tab as they are now, so a chair taken off the tab loses access at
 * once, to the signed request as well as the unsigned one. `wholeLog` reads
 * every row, which the budget needs; otherwise just this one.
 */
async function checkLink(requestId: string, token: string, adapters: Pick<Adapters, "log" | "events">, wholeLog: boolean): Promise<CheckedLink> {
  const link = token ? await verifyChairToken(token) : null;
  if (!link || link.requestId !== requestId) return { kind: "invalid" };
  const [rows, eventRows] = await Promise.all([
    wholeLog ? adapters.log.list() : adapters.log.get(requestId).then((row) => (row ? [row] : [])),
    adapters.events.list(),
  ]);
  const row = rows.find((r) => r.request_id === requestId);
  if (!row) return { kind: "invalid" };
  if (link.version !== versionOf(row)) return { kind: "stale", row };
  // An event made inactive after the request came in still has its chairs.
  const events = parseEvents(eventRows);
  if (!signingChairs(row, events).includes(link.email.toLowerCase())) return { kind: "not-chair", row, link };
  if (row.chair_step === "Signed") return { kind: "signed", row, link };
  // A status typed into the Sheet by hand has no stored request to sign.
  if (row.status !== "Awaiting chair" || !row.request_file_id) return { kind: "closed", row };
  return { kind: "open", row, link, rows, event: findEvent(events, row.event) };
}

/** What a chair's link can do right now, with what the page shows: the stored request and the event's budget. */
export async function chairLinkState(requestId: string, token: string, adapters: Pick<Adapters, "log" | "events" | "files">): Promise<ChairLinkState> {
  const checked = await checkLink(requestId, token, adapters, true);
  if (checked.kind !== "open") return checked;
  const { row, link, rows, event } = checked;
  const budget = event ? eventBudget(event, rows, { requestId, claimedCents: parseMoney(row.reimbursement_claimed) ?? 0 }) : null;
  return { kind: "ready", row, link, rows, budget, stored: await loadStoredRequest(adapters.files, row.request_file_id) };
}

/**
 * The packet a chair's link serves, after the same checks as the page: as the
 * requester signed it while it waits, the co-signed one once signed. Null
 * when the link can't open it.
 */
export async function chairPdfFile(requestId: string, token: string, adapters: Pick<Adapters, "log" | "events">): Promise<{ fileId: string; filename: string } | null> {
  const checked = await checkLink(requestId, token, adapters, false);
  if (checked.kind === "open") return { fileId: checked.row.pdf_file_id, filename: `${requestId}.pdf` };
  if (checked.kind === "signed" && checked.row.chair_pdf_file_id) return { fileId: checked.row.chair_pdf_file_id, filename: cosignedName(requestId, versionOf(checked.row)) };
  return null;
}

export class ChairError extends Error {}

/** Why a link can't be used to sign, in the chair's terms. */
export function chairStateMessage(state: Exclude<ChairLinkState, { kind: "ready" }>): string {
  switch (state.kind) {
    case "invalid":
      return `This link isn't valid. It may have expired (links work for ${config.chairLinkDays} days) or been copied incompletely.`;
    case "stale":
      return "This request was signed again since this link was sent. Use the link in the newest email about it.";
    case "not-chair":
      return `${state.link.email} isn't listed as a ${state.row.event} chair any more. If that's a mistake, ask the PTA at ${config.apEmail}.`;
    case "signed": {
      const at = parseDate(state.row.chair_signed_at);
      return `This request was already signed by ${state.row.chair_name || state.row.chair_signed_by || "a chair"}${at ? ` on ${formatDateTime(at)}` : ""}.`;
    }
    case "closed":
      return state.row.chair_step === "Timed out"
        ? "This request went on to the PTA without a chair signature, because it wasn't signed in time."
        : "This request isn't waiting for a chair's signature any more.";
  }
}

export interface ChairSignInput {
  requestId: string;
  token: string;
  /** The name the chair signs under. */
  name: string;
  signature: SignatureInput;
  /** Optional, for AP. */
  note: string;
  /** Where the chair signed from: recorded on the row for AP, never in the packet. */
  ip: string;
  userAgent: string;
  linkBase: string;
}

export interface ChairSignResult {
  sha256: string;
  /** false when the co-signed packet was saved but didn't go on (to AP, or to the requester). */
  emailed: boolean;
  /** false when the chair's own copy didn't go out. */
  chairCopied: boolean;
}

/**
 * Signs as chair: stamps the chair's signature on a copy of the requester's
 * packet, saves it beside the original, marks the request Submitted, and
 * sends the co-signed packet on. Everything up to marking it Submitted runs
 * under the row's lock, so a co-chair signing at the same moment is refused
 * rather than sending AP a second packet. Email trouble after that is noted
 * on the row, never retried.
 */
export async function signAsChair(input: ChairSignInput, adapters: Adapters): Promise<ChairSignResult> {
  const { files, log, users, stipends, mailer } = adapters;
  const state = await chairLinkState(input.requestId, input.token, adapters);
  if (state.kind !== "ready") throw new ChairError(chairStateMessage(state));
  const { link, stored, rows } = state;
  const { request_id: requestId, event } = state.row;
  const signedAt = new Date();

  const signed = await withRequestLock(log, requestId, async (row) => {
    // Checked again under the lock: a co-chair may have signed since the page loaded.
    if (row.chair_step === "Signed") throw new ChairError(`${row.chair_name || row.chair_signed_by || `Another ${event} chair`} signed this request a moment ago.`);
    if (row.status !== "Awaiting chair" || versionOf(row) !== link.version) throw new ChairError("This request isn't waiting for a chair's signature any more.");

    // Countersign only the exact file the requester signed.
    const original = await files.getFileBytes(row.pdf_file_id);
    const actual = sha256(original);
    if (actual !== row.pdf_sha256 || actual !== stored.packet.sha256) {
      console.error(`[chair] not co-signing ${requestId}: the file is ${actual}, the row says ${row.pdf_sha256}, the stored request ${stored.packet.sha256}`);
      throw new ChairError(`This request's signed file doesn't match the record of what was signed, so it can't be co-signed. Please let the PTA know at ${config.apEmail}.`);
    }
    const packet = await countersignPacket({
      packet: original,
      requesterSha256: actual,
      requestId,
      chairLine: stored.packet.chairLine,
      event,
      payeeName: row.payee_name,
      name: input.name,
      signature: toPacketSignature(input.signature),
      signedAt,
      chairEmail: link.email,
      linkSentAt: parseDate(row.chair_sent_at),
      consentText: chairConsentText(event),
      note: input.note,
    });
    const filename = cosignedName(requestId, versionOf(row));
    const saved = await files.putFile({ name: filename, mimeType: "application/pdf", bytes: packet.bytes, folderPath: ["requests", fiscalYearLabel(new Date(row.submitted_at)), requestId] });
    const patch: Partial<RequestRow> = {
      status: "Submitted",
      chair_step: "Signed",
      chair_signed_by: link.email,
      chair_name: input.name,
      chair_signed_at: signedAt.toISOString(),
      chair_note: input.note,
      // Kept off the countersignature page, which the requester gets: only AP sees the Sheet.
      chair_ip: input.ip,
      chair_user_agent: input.userAgent,
      chair_pdf_file_id: saved.id,
      chair_pdf_sha256: packet.sha256,
    };
    return { patch, result: { row, packet, filename } };
  }).catch((error: unknown) => {
    if (error instanceof BusyError) throw new ChairError("This request is being signed right now, perhaps by a co-chair. Reload the page in a minute to see whether it went through.");
    throw error;
  });

  // From here on the signature is recorded; email trouble is noted on the row.
  const { row, packet, filename } = signed;
  const submittedAt = new Date(row.submitted_at);
  const attachment = { filename, mimeType: "application/pdf", bytes: packet.bytes };
  const problems: string[] = [];
  let emailed = true;
  try {
    const [user, stipendRows] = await Promise.all([users.get(row.requester_email), stipends.list()]);
    // The log as read before signing: a request counts against its stipend the same while it waits for the chair.
    const funding = fundingEmailShares(fundingOptions(user, stipendRows, rows, submittedAt), stored.request);
    await sendPacketOn(
      {
        requestId,
        request: stored.request,
        requesterEmail: row.requester_email,
        submittedAt,
        sha256: packet.sha256,
        version: versionOf(row),
        funding,
        linkBase: input.linkBase,
        chair: { event, name: input.name, email: link.email, signedAt, note: input.note, requesterSha256: row.pdf_sha256 },
      },
      attachment,
      mailer,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[chair] could not send ${requestId} on: ${message}`);
    problems.push(`Email failed after the chair signed: ${message}`);
    emailed = false;
  }
  let chairCopied = true;
  try {
    const mail = chairSignedEmail({ requestId, event, payeeName: row.payee_name, sha256: packet.sha256 });
    await mailer.send({ to: [link.email], subject: mail.subject, text: mail.text, attachments: [attachment] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[chair] could not send the chair their copy of ${requestId}: ${message}`);
    problems.push(`The chair's copy (to ${link.email}) failed: ${message}`);
    chairCopied = false;
  }
  if (problems.length > 0) await log.update(requestId, { notes: [row.notes, ...problems].filter(Boolean).join(" | ") }).catch(() => undefined);
  return { sha256: packet.sha256, emailed, chairCopied };
}

export type ResendProblem = "not-found" | "closed" | "too-soon" | "no-chair" | "requester-chair" | "busy" | "failed";

export class ResendError extends Error {
  constructor(
    readonly problem: ResendProblem,
    message: string,
  ) {
    super(message);
  }
}

/** When the requester may resend to every chair: `chairResendHours` after the last send, or now if none went out. */
export function nextResendAt(row: Pick<RequestRow, "chair_sent_at">): Date | null {
  const sentAt = parseDate(row.chair_sent_at);
  return sentAt ? new Date(sentAt.getTime() + config.chairResendHours * 3_600_000) : null;
}

/** Where the chair email stands for a request awaiting its chair, and who a resend now would go to. */
export interface ChairSending {
  /** Who it has reached: who holds a link from the latest send. */
  reached: string[];
  /** Chairs who may sign now but haven't been reached: their email failed, or they were added to the tab since. */
  unreached: string[];
  /** Who a resend now goes to: every chair once the wait is over, else only the unreached ones. Empty when there's nobody to send to now. */
  to: string[];
  /** Whether a resend now goes to every chair (and restarts the wait). */
  everyone: boolean;
  /** When it can go to every chair again; null once it can. */
  nextAt: Date | null;
  /** The requester is now listed as a chair of the event, so it can't be sent on to the chairs. */
  requesterIsChair: boolean;
}

export function chairSending(row: Pick<RequestRow, "event" | "chair_sent_to" | "chair_sent_at" | "requester_email">, events: PtaEvent[], now = new Date()): ChairSending {
  const chairs = signingChairs(row, events);
  const reached = addresses(row.chair_sent_to);
  const unreached = chairs.filter((chair) => !reached.includes(chair));
  const next = nextResendAt(row);
  const everyone = !next || next <= now;
  const requesterIsChair = Boolean(findEvent(events, row.event)?.chairs.includes(row.requester_email.trim().toLowerCase()));
  return { reached, unreached, to: requesterIsChair ? [] : everyone ? chairs : unreached, everyone, nextAt: everyone ? null : next, requesterIsChair };
}

/** Why a resend can't go now, or null if it can. */
function resendProblem(row: RequestRow, sending: ChairSending): ResendError | null {
  if (row.status !== "Awaiting chair") return new ResendError("closed", "This request isn't waiting for a chair's signature any more.");
  if (sending.requesterIsChair) {
    return new ResendError("requester-chair", `You're listed as a ${row.event} chair now, so this can't be sent to the chairs again. Ask the PTA at ${config.apEmail} what to do.`);
  }
  if (sending.to.length > 0) return null;
  if (sending.nextAt) {
    return new ResendError("too-soon", `The chair was emailed less than ${config.chairResendHours} hours ago. You can send it again after ${formatDateTime(sending.nextAt)}.`);
  }
  return new ResendError("no-chair", `The PTA's list doesn't name a chair for ${row.event} right now. Ask the PTA at ${config.apEmail} what to do.`);
}

/**
 * The requester's "Resend to the chair": the signing email again, with fresh
 * links. Once the daily wait (config.chairResendHours) is over it goes to
 * every chair the Events tab lists now; before that, only to chairs it hasn't
 * reached, whose email failed or who were added since. Runs under the row's
 * lock, so a double click sends it once.
 */
export async function resendToChair(
  input: { requestId: string; requesterEmail: string; linkBase: string; now?: Date },
  adapters: Pick<Adapters, "log" | "events" | "files" | "mailer">,
): Promise<{ sentTo: string[] }> {
  const { log, events, files, mailer } = adapters;
  const now = input.now ?? new Date();
  const [first, eventRows] = await Promise.all([log.get(input.requestId), events.list()]);
  if (!first || first.requester_email.toLowerCase() !== input.requesterEmail.toLowerCase()) throw new ResendError("not-found", "That request wasn't found.");
  const parsed = parseEvents(eventRows);
  // Checked before taking the lock, so a refusal writes nothing, and again under it.
  const early = resendProblem(first, chairSending(first, parsed, now));
  if (early) throw early;

  try {
    return await withRequestLock(log, input.requestId, async (row) => {
      const sending = chairSending(row, parsed, now);
      const problem = resendProblem(row, sending);
      if (problem) throw problem;
      const event = findEvent(parsed, row.event);
      const [stored, bytes, rows] = await Promise.all([loadStoredRequest(files, row.request_file_id), files.getFileBytes(row.pdf_file_id), event?.budgetCents != null ? log.list() : []]);
      const { sent, error } = await sendChairRequests(
        {
          requestId: row.request_id,
          version: versionOf(row),
          request: stored.request,
          requesterEmail: row.requester_email,
          submittedAt: new Date(row.submitted_at),
          sha256: row.pdf_sha256,
          chairs: sending.to,
          linkBase: input.linkBase,
          attachment: { filename: `${row.request_id}.pdf`, mimeType: "application/pdf", bytes },
          reminder: true,
          budget: event ? eventBudget(event, rows, { requestId: row.request_id, claimedCents: parseMoney(row.reimbursement_claimed) ?? 0 }) : null,
        },
        mailer,
      );
      if (sent.length === 0) {
        console.error(`[chair] resend of ${row.request_id} failed: ${error}`);
        throw new ResendError("failed", "The email didn't go through. Please try again in a few minutes.");
      }
      // To everyone: whoever it reached now holds the only current links, and the wait starts over. To the rest: they join who was reached.
      const patch: Partial<RequestRow> = sending.everyone
        ? { chair_sent_to: sent.join(", "), chair_sent_at: now.toISOString() }
        : { chair_sent_to: [...new Set([...sending.reached, ...sent])].join(", ") };
      return { patch, result: { sentTo: sent } };
    });
  } catch (error) {
    if (error instanceof BusyError) throw new ResendError("busy", "It's being sent right now. Reload the page in a minute to see when it went.");
    throw error;
  }
}
