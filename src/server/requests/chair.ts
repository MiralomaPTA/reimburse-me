import type { Adapters, MailAttachment, Mailer, RequestRow } from "@/server/adapters/types";
import { config } from "@/server/config";
import { createChairToken, verifyChairToken, type ChairLink } from "@/server/auth/tokens";
import {
  apSubmissionEmail,
  chairRequestEmail,
  chairSignedEmail,
  requesterCopyEmail,
  requesterPacketEmail,
  type SubmissionEmailInput,
} from "@/server/email/templates";
import { countersignPacket } from "@/server/pdf/countersign";
import { chairConsentText } from "@/server/pdf/types";
import { toPacketSignature } from "@/server/requests/signature";
import { fundingEmailShares, fundingOptions } from "@/server/requests/stipends";
import { cosignedName, loadStoredRequest, type StoredRequest } from "@/server/requests/stored";
import { formatDateTime } from "@/lib/dates";
import { chairRouting, eventBudget, findEvent, parseEvents, type EventBudget } from "@/lib/events";
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

/** Emails each chair their own link. Never throws: says who was reached and why the others weren't. */
export async function sendChairRequests(input: ChairRequestInput, mailer: Mailer): Promise<{ sent: string[]; failed: string[]; error?: string }> {
  const results = await Promise.allSettled(
    input.chairs.map(async (chair) => {
      const token = await createChairToken(chair, input.requestId, input.version);
      const mail = chairRequestEmail({ ...input, link: `${input.linkBase}${chairLinkPath(input.requestId, token)}`, chairCount: input.chairs.length });
      await mailer.send({ to: [chair], replyTo: input.requesterEmail, subject: mail.subject, text: mail.text, attachments: [input.attachment] });
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
  | { kind: "ready"; row: RequestRow; link: ChairLink; stored: StoredRequest; budget: EventBudget | null };

/**
 * What a chair's link can do right now. Checked on every page view and every
 * action against the request's row and the Events tab, so a chair removed
 * from the tab loses access at once.
 */
export async function chairLinkState(requestId: string, token: string, adapters: Pick<Adapters, "log" | "events" | "files">): Promise<ChairLinkState> {
  const link = token ? await verifyChairToken(token) : null;
  if (!link || link.requestId !== requestId) return { kind: "invalid" };
  // The whole log, not just the row: the event's budget counts its other requests.
  const rows = await adapters.log.list();
  const row = rows.find((r) => r.request_id === requestId);
  if (!row) return { kind: "invalid" };
  if (link.version !== versionOf(row)) return { kind: "stale", row };
  if (row.chair_step === "Signed") return { kind: "signed", row, link };
  // A status typed into the Sheet by hand has no stored request to sign.
  if (row.status !== "Awaiting chair" || !row.request_file_id) return { kind: "closed", row };
  // An event made inactive after the request came in still has its chairs.
  const event = findEvent(parseEvents(await adapters.events.list()), row.event);
  if (!event?.chairs.includes(link.email.toLowerCase())) return { kind: "not-chair", row, link };
  const budget = eventBudget(event, rows, { requestId, claimedCents: parseMoney(row.reimbursement_claimed) ?? 0 });
  return { kind: "ready", row, link, stored: await loadStoredRequest(adapters.files, row.request_file_id), budget };
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
    case "signed":
      return `This request was already signed by ${state.row.chair_name || state.row.chair_signed_by} on ${formatDateTime(new Date(state.row.chair_signed_at))}.`;
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
  ip: string;
  userAgent: string;
  linkBase: string;
}

export interface ChairSignResult {
  sha256: string;
  /** false when the co-signed packet was saved but an email didn't go out. */
  emailed: boolean;
}

/**
 * Signs as chair: stamps the chair's signature on a copy of the requester's
 * packet, saves it beside the original, marks the request Submitted, and
 * sends the co-signed packet on. Trouble after the row is updated is noted on
 * the row, never retried.
 */
export async function signAsChair(input: ChairSignInput, adapters: Adapters): Promise<ChairSignResult> {
  const { files, log, users, stipends, mailer } = adapters;
  const state = await chairLinkState(input.requestId, input.token, adapters);
  if (state.kind !== "ready") throw new ChairError(chairStateMessage(state));
  const { row, link, stored } = state;
  const { request_id: requestId, event } = row;
  const version = versionOf(row);
  const signedAt = new Date();

  const packet = await countersignPacket({
    packet: await files.getFileBytes(row.pdf_file_id),
    requesterSha256: row.pdf_sha256,
    requestId,
    chairLine: stored.packet.chairLine,
    event,
    payeeName: row.payee_name,
    name: input.name,
    signature: toPacketSignature(input.signature),
    signedAt,
    chairEmail: link.email,
    linkSentAt: row.chair_sent_at ? new Date(row.chair_sent_at) : null,
    ip: input.ip,
    userAgent: input.userAgent,
    consentText: chairConsentText(event),
    note: input.note,
  });

  // A co-chair may have signed while this one was being built.
  const latest = await log.get(requestId);
  if (!latest || latest.chair_step === "Signed" || latest.status !== "Awaiting chair") {
    throw new ChairError(latest?.chair_step === "Signed" ? `Another ${event} chair signed this request a moment ago.` : "This request isn't waiting for a chair's signature any more.");
  }
  const submittedAt = new Date(row.submitted_at);
  const filename = cosignedName(requestId, version);
  const saved = await files.putFile({ name: filename, mimeType: "application/pdf", bytes: packet.bytes, folderPath: ["requests", fiscalYearLabel(submittedAt), requestId] });
  await log.update(requestId, {
    status: "Submitted",
    chair_step: "Signed",
    chair_signed_by: link.email,
    chair_name: input.name,
    chair_signed_at: signedAt.toISOString(),
    chair_note: input.note,
    chair_pdf_file_id: saved.id,
    chair_pdf_sha256: packet.sha256,
  });

  // From here on the signature is recorded; email trouble is noted on the row.
  const problems: string[] = [];
  const attachment = { filename, mimeType: "application/pdf", bytes: packet.bytes };
  try {
    const [user, stipendRows, rows] = await Promise.all([users.get(row.requester_email), stipends.list(), log.list()]);
    const emailInput: SubmissionEmailInput = {
      requestId,
      request: stored.request,
      requesterEmail: row.requester_email,
      submittedAt,
      sha256: packet.sha256,
      version,
      funding: fundingEmailShares(fundingOptions(user, stipendRows, rows, submittedAt), stored.request),
      linkBase: input.linkBase,
      chair: { event, name: input.name, email: link.email, signedAt, note: input.note, requesterSha256: row.pdf_sha256 },
    };
    if (config.sendPacketsTo === "ap") {
      const ap = apSubmissionEmail(emailInput);
      await mailer.send({ to: [config.apEmail], replyTo: row.requester_email, subject: ap.subject, text: ap.text, attachments: [attachment] });
      const copy = requesterCopyEmail(emailInput);
      await mailer.send({ to: [row.requester_email], subject: copy.subject, text: copy.text, attachments: [attachment] });
    } else {
      const mail = requesterPacketEmail(emailInput);
      await mailer.send({ to: [row.requester_email], subject: mail.subject, text: mail.text, attachments: [attachment] });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[chair] could not send ${requestId} on: ${message}`);
    problems.push(`Email failed after the chair signed: ${message}`);
  }
  try {
    const mail = chairSignedEmail({ requestId, event, payeeName: row.payee_name, sha256: packet.sha256 });
    await mailer.send({ to: [link.email], subject: mail.subject, text: mail.text, attachments: [attachment] });
  } catch (error) {
    console.error(`[chair] could not send the chair their copy of ${requestId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (problems.length > 0) await log.update(requestId, { notes: [row.notes, ...problems].filter(Boolean).join(" | ") }).catch(() => undefined);
  return { sha256: packet.sha256, emailed: problems.length === 0 };
}

export type ResendProblem = "not-found" | "closed" | "too-soon" | "no-chair" | "failed";

export class ResendError extends Error {
  constructor(
    readonly problem: ResendProblem,
    message: string,
  ) {
    super(message);
  }
}

/** When the requester may resend: `chairResendHours` after the last send, or now if none went out. */
export function nextResendAt(row: Pick<RequestRow, "chair_sent_at">): Date | null {
  return row.chair_sent_at ? new Date(new Date(row.chair_sent_at).getTime() + config.chairResendHours * 3_600_000) : null;
}

/**
 * The requester's "Resend to the chair": the signing email again, to whoever
 * the Events tab lists as the event's chairs now. At most once in
 * config.chairResendHours, unless the last send never went out.
 */
export async function resendToChair(
  input: { requestId: string; requesterEmail: string; linkBase: string; now?: Date },
  adapters: Pick<Adapters, "log" | "events" | "files" | "mailer">,
): Promise<{ sentTo: string[] }> {
  const { log, events, files, mailer } = adapters;
  const now = input.now ?? new Date();
  const row = await log.get(input.requestId);
  if (!row || row.requester_email.toLowerCase() !== input.requesterEmail.toLowerCase()) throw new ResendError("not-found", "That request wasn't found.");
  if (row.status !== "Awaiting chair") throw new ResendError("closed", "This request isn't waiting for a chair's signature any more.");
  const next = nextResendAt(row);
  if (next && next > now) throw new ResendError("too-soon", `The chair was emailed less than ${config.chairResendHours} hours ago. You can send it again after ${formatDateTime(next)}.`);
  const event = findEvent(parseEvents(await events.list()), row.event);
  const routing = chairRouting(event, row.requester_email);
  if (routing.step !== "Waiting") throw new ResendError("no-chair", `The PTA's list doesn't name a chair for ${row.event} right now. Ask the PTA at ${config.apEmail} what to do.`);

  const stored = await loadStoredRequest(files, row.request_file_id);
  const { sent, error } = await sendChairRequests(
    {
      requestId: row.request_id,
      version: versionOf(row),
      request: stored.request,
      requesterEmail: row.requester_email,
      submittedAt: new Date(row.submitted_at),
      sha256: row.pdf_sha256,
      chairs: routing.chairs,
      linkBase: input.linkBase,
      attachment: { filename: `${row.request_id}.pdf`, mimeType: "application/pdf", bytes: await files.getFileBytes(row.pdf_file_id) },
      reminder: true,
      budget: event ? eventBudget(event, await log.list(), { requestId: row.request_id, claimedCents: parseMoney(row.reimbursement_claimed) ?? 0 }) : null,
    },
    mailer,
  );
  if (sent.length === 0) {
    console.error(`[chair] resend of ${row.request_id} failed: ${error}`);
    throw new ResendError("failed", "The email didn't go through. Please try again in a few minutes.");
  }
  await log.update(row.request_id, { chair_sent_to: sent.join(", "), chair_sent_at: now.toISOString() });
  return { sentTo: sent };
}
