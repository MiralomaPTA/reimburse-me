import { randomUUID } from "node:crypto";
import type { Adapters, RequestRow, SignatureRecord } from "@/server/adapters/types";
import { config } from "@/server/config";
import { createSignerToken, verifySignerToken, type SignerLink } from "@/server/auth/tokens";
import {
  apAuthorizedEmail,
  requesterAuthorizedEmail,
  signerReceiptEmail,
  signerRequestEmail,
  signerSentBackEmail,
  type ChairSignature,
  type SignersAuthorization,
} from "@/server/email/templates";
import { addSecondSignature, buildAuthorizedPacket, fillFo10, type Fo10Details } from "@/server/pdf/fo10";
import { SIGNER_CONSENT_TEXT } from "@/server/pdf/types";
import { BusyError, withRequestLock } from "@/server/requests/lock";
import { signersFor } from "@/server/requests/mailing";
import { sha256 } from "@/server/hash";
import { addressList, appendNotes, lowerEmail as lower, ResendProblemError, versionOf } from "@/server/requests/rows";
import { toPacketSignature } from "@/server/requests/signature";
import { fundingAsOf, fundingEmailShares, fundingLabel, fundingOptions, parseFundingChoice } from "@/server/requests/stipends";
import { authorizedName, cosignedName, fo10AttachmentName, fo10Name, loadStoredRequest, packetName, requestFolder, type StoredRequest } from "@/server/requests/stored";
import { formatDateTime, formatMonthDay, parseDate } from "@/lib/dates";
import { budgetAccountProblem, formatAddress, oneLine, sameAddress, squash, toBudgetAccount } from "@/lib/mailing";
import { fundingSplit, totals, type RequestInput, type SignatureInput } from "@/lib/request-schema";

/**
 * The check signers' step, for a mailed check. The PTA's bank mails it by
 * bill pay, and CAPTA asks for an FO10 signed by two authorized check signers
 * before any such payment. Once the requester (and the event chair, for an
 * event) have signed, every address in CHECK_SIGNERS but the requester's gets
 * its own link. Two different signers sign the FO10's two Authorized By
 * lines; the first also confirms the Budget Account and picks the Payment
 * Account, which are then locked. The second signature puts the signed FO10
 * in front of the packet and sends it straight to AP, whatever
 * SEND_PACKETS_TO says. Either signer may send the request back instead.
 *
 * Signing and sending back run under the request's row lock (lock.ts), as
 * the chair's signature and every resend do, so two signers pressing Sign at
 * once can't both make the same signature, and a resend can't go out halfway
 * through one. Each signature and send-back is recorded in the Signatures
 * tab, with what the packet leaves out.
 */

export const signerLinkPath = (requestId: string, token: string) => `/signers/${encodeURIComponent(requestId)}?t=${encodeURIComponent(token)}`;

/** The packet the check signers authorize: co-signed when the chair signed, otherwise as the requester signed it. */
export function signedPacket(row: RequestRow): { fileId: string; sha256: string; filename: string; kind: "co-signed" | "requester-signed" } {
  if (row.chair_pdf_file_id) return { fileId: row.chair_pdf_file_id, sha256: row.chair_pdf_sha256, filename: cosignedName(row.request_id, versionOf(row)), kind: "co-signed" };
  return { fileId: row.pdf_file_id, sha256: row.pdf_sha256, filename: packetName(row.request_id, versionOf(row)), kind: "requester-signed" };
}

/** Something the check signer can act on: refused, or changed since the page loaded (`reload`). */
export class SignerError extends Error {
  constructor(
    message: string,
    readonly reload = false,
  ) {
    super(message);
  }
}

const mismatchMessage = () => `This request's signed files don't match the record of what was signed, so it can't be authorized. Please let the PTA know at ${config.apEmail}.`;
const mismatch = () => new SignerError(mismatchMessage());

/** A signed file from Drive, only if it's the one the row records: anything a signer is shown, emailed or signs. */
async function verifiedFile(files: Adapters["files"], requestId: string, what: string, fileId: string, expected: string): Promise<Uint8Array> {
  const bytes = await files.getFileBytes(fileId);
  if (!expected || sha256(bytes) !== expected) {
    console.error(`[signers] ${requestId}'s ${what} is ${sha256(bytes)}, the row says ${expected || "nothing"}`);
    throw mismatch();
  }
  return bytes;
}

/**
 * The request's JSON, which the FO10 is filled from, checked to belong to the
 * packet the row records: the address and amount AP pays come from here, and
 * the row can be edited in the Sheet.
 */
export async function loadCheckedRequest(files: Adapters["files"], row: RequestRow): Promise<StoredRequest> {
  const stored = await loadStoredRequest(files, row.request_file_id);
  if (stored.requestId !== row.request_id || stored.version !== versionOf(row) || stored.packet.sha256 !== row.pdf_sha256) {
    console.error(`[signers] the stored request for ${row.request_id} records packet ${stored.packet.sha256} (v${stored.version}); the row says ${row.pdf_sha256} (v${versionOf(row)})`);
    throw mismatch();
  }
  return stored;
}

/**
 * What the FO10's Budget Account starts as: the stipends the request is paid
 * from ("Classroom stipend; Grade 2 stipend"), else the event it's for, else
 * blank for the first signer to fill in. Made to fit the Budget Account's
 * rules, so a first signer who leaves it as it is can sign.
 */
export function budgetAccountDefault(request: Pick<RequestInput, "items" | "donationCents" | "event">): string {
  const labels = fundingSplit(request)
    .map((share) => share.funding)
    .filter((choice) => choice && choice !== "none")
    .map((choice) => {
      const { key, grade } = parseFundingChoice(choice);
      return fundingLabel(key, grade);
    });
  return toBudgetAccount(labels.length > 0 ? [...new Set(labels)].join("; ") : request.event || "");
}

/**
 * Whether a request went through: AP approved or paid it, or two check
 * signers authorized it. Only those count as an account's history, so a try
 * that was sent back, or one still waiting, can't make the next one look
 * like the account's usual.
 */
const wentThrough = (r: RequestRow) => r.status === "Approved" || r.status === "Check written" || r.status === "Paid" || (r.status === "Submitted" && r.signers_step === "Signed");

/**
 * The signs of an account that's been taken over, which matter more once a
 * check can be mailed anywhere. `rows` may be the whole log: only the
 * requester's requests that went through before this one count.
 */
export function signerFlags(
  row: Pick<RequestRow, "request_id" | "submitted_at" | "requester_email">,
  request: Pick<RequestInput, "payeeName" | "address" | "cityStateZip">,
  rows: RequestRow[],
): string[] {
  const earlier = rows
    .filter((r) => lower(r.requester_email) === lower(row.requester_email) && r.request_id !== row.request_id && r.submitted_at < row.submitted_at && wentThrough(r))
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  const flags: string[] = [];
  const mailed = earlier.filter((r) => r.check_delivery === "mail" && String(r.address ?? "").trim());
  if (mailed.length === 0) flags.push("No mailed check has gone through for this account before.");
  else if (!sameAddress({ address: mailed[0].address, cityStateZip: mailed[0].city_zip }, request)) {
    flags.push(`The address differs from the last mailed check that went through for this account (${mailed[0].request_id}).`);
  }
  if (earlier.length > 0 && !earlier.some((r) => squash(r.payee_name) === squash(request.payeeName))) {
    flags.push(`The payee name differs from the one on this account's earlier requests that went through ("${earlier[0].payee_name}").`);
  }
  return flags;
}

export interface Accounts {
  budgetAccount: string;
  paymentAccount: string;
  /** Set by the first signer: the second signs exactly what the first did. */
  locked: boolean;
}

/**
 * The record of the first signature: the one that made the FO10 the row points
 * to. The second signature, its emails and the authorization page take the
 * accounts from here rather than from the row, which can be edited in the
 * Sheet, since the FO10 was filled from them.
 */
export function firstSignature(row: RequestRow, records: SignatureRecord[]): SignatureRecord {
  const first = records.find((r) => r.state === "signed" && Number(r.slot) === 1 && Number(r.version) === versionOf(row) && r.fo10_sha256 === row.fo10_sha256);
  if (!first) {
    console.error(`[signers] no record of the first signature on ${row.request_id} that made FO10 ${row.fo10_sha256}`);
    throw mismatch();
  }
  if (first.budget_account !== row.budget_account || first.payment_account !== row.payment_account) {
    console.warn(`[signers] ${row.request_id}'s row shows other accounts than its first signature; going by the signature`);
  }
  return first;
}

/** The first signature's record while the request waits for the second; null before the first. */
async function firstIfSigned(signatures: Adapters["signatures"], row: RequestRow): Promise<SignatureRecord | null> {
  return row.signers_step === "1 of 2 signed" ? firstSignature(row, await signatures.listFor(row.request_id)) : null;
}

/** The Budget Account and Payment Account as the next signer sees them: as the first signer locked them, once they've signed. */
export function currentAccounts(request: RequestInput, first: SignatureRecord | null): Accounts {
  if (first) return { budgetAccount: first.budget_account, paymentAccount: first.payment_account, locked: true };
  return { budgetAccount: budgetAccountDefault(request), paymentAccount: config.billPayAccounts[0] ?? "", locked: false };
}

export function fo10Details(row: RequestRow, stored: StoredRequest, accounts: Pick<Accounts, "budgetAccount" | "paymentAccount">): Fo10Details {
  const { request } = stored;
  return {
    requestId: row.request_id,
    signedAt: new Date(stored.submittedAt),
    payeeName: request.payeeName,
    ptaPosition: request.ptaPosition,
    address: request.address,
    cityStateZip: request.cityStateZip,
    phone: request.phone,
    email: stored.requesterEmail,
    purpose: request.purpose,
    amountCents: totals(request).reimbursementCents,
    budgetAccount: accounts.budgetAccount,
    paymentAccount: accounts.paymentAccount,
  };
}

/** The event chair who signed, for an event request, or why none did. */
export function chairFor(row: RequestRow): ChairSignature | { skipped: string } | null {
  if (!row.event) return null;
  switch (row.chair_step) {
    case "Signed":
      return { event: row.event, name: row.chair_name, email: row.chair_signed_by, signedAt: parseDate(row.chair_signed_at) ?? new Date(row.submitted_at), note: row.chair_note, requesterSha256: row.pdf_sha256 };
    case "Skipped: requester is a chair":
      return { skipped: `The requester chairs ${row.event}, so no chair signed the form's VP/Chairman line.` };
    case "Skipped: no chair listed":
      return { skipped: `No chair was listed for ${row.event}, so no chair signed the form's VP/Chairman line.` };
    default:
      return null;
  }
}

/** The FO10 as the next signer sees it: unsigned before the first signature, then the first-signature file, checked against its hash. */
async function currentFo10(row: RequestRow, stored: StoredRequest, files: Adapters["files"]): Promise<Uint8Array> {
  if (row.signers_step === "1 of 2 signed") return verifiedFile(files, row.request_id, "first-signature FO10", row.fo10_file_id, row.fo10_sha256);
  return (await fillFo10(fo10Details(row, stored, currentAccounts(stored.request, null)))).bytes;
}

export interface SendToSignersInput {
  /** The row as it stands, awaiting the signers. */
  row: RequestRow;
  stored: StoredRequest;
  /** Who to email; every check signer who may sign next when left out. */
  to?: string[];
  linkBase: string;
  /** What the caller has already, so it isn't read again: the packet, the FO10 as it stands, the flags, and the first signature's record (null before it). */
  packetBytes?: Uint8Array;
  fo10Bytes?: Uint8Array;
  flags?: string[];
  first?: SignatureRecord | null;
  reminder?: boolean;
}

/**
 * The cells to write after a send to the signers that missed someone: only
 * who it reached, and no send time when it reached nobody, so the request
 * page offers to resend to the rest at once.
 */
export const reachedCells = (sent: string[]): Partial<RequestRow> => ({ signers_sent_to: sent.join(", "), ...(sent.length === 0 ? { signers_sent_at: "" } : {}) });

/** The check signers who may sign `row` next: every one but the requester and whoever signed the first line. */
export function nextSigners(row: Pick<RequestRow, "requester_email" | "signer_1_email">): string[] {
  const first = lower(row.signer_1_email);
  return signersFor(row.requester_email).filter((signer) => signer !== first);
}

/**
 * Emails each check signer their own link, with the packet and the FO10 as
 * filled in so far, each checked against the hash the row records. Replies go
 * to AP, never the requester: a reply quotes the link, and the link is all it
 * takes to sign. Never throws: says who was reached and why the others weren't.
 */
export async function sendToSigners(
  input: SendToSignersInput,
  adapters: Pick<Adapters, "files" | "log" | "mailer" | "signatures">,
): Promise<{ sent: string[]; failed: string[]; error?: string }> {
  const { row, stored } = input;
  const to = input.to ?? nextSigners(row);
  if (to.length === 0) return { sent: [], failed: [], error: "No check signers to email: CHECK_SIGNERS lists fewer than two besides the requester." };
  try {
    const packet = signedPacket(row);
    const [packetBytes, fo10, flags, first] = await Promise.all([
      input.packetBytes ?? verifiedFile(adapters.files, row.request_id, `${packet.kind} packet`, packet.fileId, packet.sha256),
      input.fo10Bytes ?? currentFo10(row, stored, adapters.files),
      input.flags ?? adapters.log.listByEmail(row.requester_email).then((rows) => signerFlags(row, stored.request, rows)),
      input.first !== undefined ? input.first : firstIfSigned(adapters.signatures, row),
    ]);
    const accounts = currentAccounts(stored.request, first);
    const firstAt = parseDate(row.signer_1_signed_at);
    const common = {
      requestId: row.request_id,
      version: versionOf(row),
      request: stored.request,
      requesterEmail: stored.requesterEmail,
      submittedAt: new Date(stored.submittedAt),
      linkBase: input.linkBase,
      budgetAccount: accounts.budgetAccount,
      paymentAccount: accounts.paymentAccount,
      flags,
      chair: chairFor(row),
      firstSigner: row.signers_step === "1 of 2 signed" && firstAt ? { name: row.signer_1_name, signedAt: firstAt } : null,
      packetSha256: packet.sha256,
      reminder: input.reminder,
      answers: stored.answers,
    };
    const attachments = [
      { filename: packet.filename, mimeType: "application/pdf", bytes: packetBytes },
      { filename: fo10AttachmentName(row.request_id, versionOf(row)), mimeType: "application/pdf", bytes: fo10 },
    ];
    const results = await Promise.allSettled(
      to.map(async (signer) => {
        const token = await createSignerToken(signer, row.request_id, versionOf(row));
        const mail = signerRequestEmail({ ...common, link: `${input.linkBase}${signerLinkPath(row.request_id, token)}` });
        await adapters.mailer.send({ to: [signer], replyTo: config.apEmail, subject: mail.subject, text: mail.text, attachments });
      }),
    );
    const sent = to.filter((_, i) => results[i].status === "fulfilled");
    const failed = to.filter((_, i) => results[i].status === "rejected");
    const firstError = results.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
    return firstError ? { sent, failed, error: firstError instanceof Error ? firstError.message : String(firstError) } : { sent, failed };
  } catch (error) {
    return { sent: [], failed: to, error: error instanceof Error ? error.message : String(error) };
  }
}

export type SignerLinkState =
  | { kind: "invalid" }
  /** The request was signed again since this link was sent. */
  | { kind: "stale"; row: RequestRow }
  /** The address is no longer in CHECK_SIGNERS, or is the requester's. */
  | { kind: "not-signer"; row: RequestRow; link: SignerLink }
  /** No longer waiting for the check signers: only a status line. */
  | { kind: "done"; row: RequestRow; status: string }
  /** This signer signed the first line; the second must come from someone else. */
  | { kind: "signed-first"; row: RequestRow; link: SignerLink }
  /** The files don't match the record of what was signed, so nothing can be signed until the PTA looks. */
  | { kind: "mismatch"; row: RequestRow }
  | {
      kind: "ready";
      row: RequestRow;
      link: SignerLink;
      stored: StoredRequest;
      /** Which Authorized By line this signer would sign. */
      slot: 1 | 2;
      accounts: Accounts;
      /** The first signature's record, for the second signer; null for the first. */
      first: SignatureRecord | null;
      flags: string[];
      chair: ReturnType<typeof chairFor>;
      /** The whole log as read, for the flags and the funding lines in AP's email, so signing doesn't read it again. */
      rows: RequestRow[];
    };

type CheckedLink =
  | Exclude<SignerLinkState, { kind: "ready" | "done" | "mismatch" }>
  | { kind: "closed"; row: RequestRow }
  | { kind: "open"; row: RequestRow; link: SignerLink; slot: 1 | 2; rows: RequestRow[] };

/**
 * The checks every use of a link makes, against the row and CHECK_SIGNERS as
 * they are now, so removing a signer and redeploying stops their links at
 * once. `wholeLog` reads every row (one read of the tab either way), which the
 * flags and AP's email need; otherwise `rows` is just this one.
 */
async function checkLink(requestId: string, token: string, log: Adapters["log"], wholeLog = false): Promise<CheckedLink> {
  const link = token ? await verifySignerToken(token) : null;
  if (!link || link.requestId !== requestId) return { kind: "invalid" };
  const rows = wholeLog ? await log.list() : await log.get(requestId).then((r) => (r ? [r] : []));
  const row = rows.find((r) => r.request_id === requestId);
  if (!row) return { kind: "invalid" };
  if (link.version !== versionOf(row)) return { kind: "stale", row };
  const email = lower(link.email);
  if (!config.checkSigners.includes(email) || email === lower(row.requester_email)) return { kind: "not-signer", row, link };
  // A status typed into the Sheet by hand has no stored request to fill the FO10 from.
  if (row.status !== "Awaiting signers" || row.check_delivery !== "mail" || !row.request_file_id) return { kind: "closed", row };
  if (row.signers_step === "1 of 2 signed") {
    if (email === lower(row.signer_1_email)) return { kind: "signed-first", row, link };
    return { kind: "open", row, link, slot: 2, rows };
  }
  return { kind: "open", row, link, slot: 1, rows };
}

/** Who sent a request back, from the Signatures tab. */
export async function sentBackBy(signatures: Adapters["signatures"], row: RequestRow): Promise<SignatureRecord | null> {
  const records = await signatures.listFor(row.request_id);
  return records.find((r) => r.state === "sent back" && Number(r.version) === versionOf(row)) ?? null;
}

/** All a link shows once the request has left the check signers: who authorized it or sent it back, and when. */
export function signersStatusLine(row: RequestRow, sentBack: Pick<SignatureRecord, "signer_name" | "signed_at"> | null): string {
  if (row.signers_step === "Signed") {
    const at = parseDate(row.signer_2_signed_at);
    return `Authorized by ${row.signer_1_name} and ${row.signer_2_name}${at ? ` on ${formatMonthDay(at)}` : ""}.`;
  }
  if (row.signers_step === "Sent back") {
    const at = parseDate(sentBack?.signed_at);
    return `Sent back by ${sentBack?.signer_name || "a check signer"}${at ? ` on ${formatMonthDay(at)}` : ""}.`;
  }
  return "This request isn't waiting for the check signers any more.";
}

/** What a signer's link can do right now, with what the page shows. */
export async function signerLinkState(requestId: string, token: string, adapters: Pick<Adapters, "log" | "files" | "signatures">): Promise<SignerLinkState> {
  const checked = await checkLink(requestId, token, adapters.log, true);
  if (checked.kind === "closed") {
    const sentBack = checked.row.signers_step === "Sent back" ? await sentBackBy(adapters.signatures, checked.row) : null;
    return { kind: "done", row: checked.row, status: signersStatusLine(checked.row, sentBack) };
  }
  if (checked.kind !== "open") return checked;
  const { row, link, slot, rows } = checked;
  try {
    const [stored, first] = await Promise.all([loadCheckedRequest(adapters.files, row), firstIfSigned(adapters.signatures, row)]);
    // The record says who signed first, whatever the row's signer_1_email says now.
    if (first && lower(first.signer_email) === lower(link.email)) return { kind: "signed-first", row, link };
    return {
      kind: "ready",
      row,
      link,
      stored,
      slot,
      accounts: currentAccounts(stored.request, first),
      first,
      flags: signerFlags(row, stored.request, rows),
      chair: chairFor(row),
      rows,
    };
  } catch (error) {
    // The only SignerError on this path: the stored request or the first signature doesn't match the row.
    if (error instanceof SignerError) return { kind: "mismatch", row };
    throw error;
  }
}

/** Why a link can't be used to sign, in the signer's terms. */
export function signerStateMessage(state: Exclude<SignerLinkState, { kind: "ready" }>): string {
  switch (state.kind) {
    case "invalid":
      return `This link isn't valid. It may have expired (links work for ${config.signerLinkDays} days) or been copied incompletely.`;
    case "stale":
      return "This request was signed again since this link was sent. Use the link in the newest email about it.";
    case "not-signer":
      return lower(state.link.email) === lower(state.row.requester_email)
        ? "You can't authorize a payment to yourself."
        : `${state.link.email} isn't listed as one of the PTA's check signers any more. If that's a mistake, ask the PTA at ${config.apEmail}.`;
    case "signed-first":
      return "You've already signed this one. The second signature has to come from a different check signer.";
    case "mismatch":
      return mismatchMessage();
    case "done":
      return state.status;
  }
}

/**
 * A file a signer's link serves, after the same checks as the page: the
 * packet they're asked to authorize, or the FO10 as it stands, each checked
 * against the hash the row records (a SignerError if it isn't). Null once the
 * link can't open the request, including after it has left the signers.
 */
export async function signerPdf(requestId: string, token: string, which: "packet" | "fo10", adapters: Pick<Adapters, "log" | "files">): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const checked = await checkLink(requestId, token, adapters.log);
  if (checked.kind !== "open") return null;
  const { row } = checked;
  if (which === "packet") {
    const packet = signedPacket(row);
    return { bytes: await verifiedFile(adapters.files, requestId, `${packet.kind} packet`, packet.fileId, packet.sha256), filename: packet.filename };
  }
  const stored = await loadCheckedRequest(adapters.files, row);
  return { bytes: await currentFo10(row, stored, adapters.files), filename: fo10AttachmentName(requestId, versionOf(row)) };
}

/** What the page sends back: what it showed, so a change since then is caught. */
interface SignerAction {
  requestId: string;
  token: string;
  /** The line the page offered. */
  slot: 1 | 2;
  version: number;
  /** The name the signer typed. */
  name: string;
  ip: string;
  userAgent: string;
  linkBase: string;
}

export interface SignerSignInput extends SignerAction {
  /** Typed (the name, as typed) or drawn. */
  signature: SignatureInput;
  /** Optional, for AP. */
  note: string;
  /** The first signer's: the Budget Account as confirmed, and the Payment Account picked. Ignored for the second. */
  budgetAccount?: string;
  paymentAccount?: string;
}

export interface SignerSignResult {
  slot: 1 | 2;
  /** Of the file the signature made: the first-signature FO10, or the authorized packet. */
  sha256: string;
  /** false when the signature was saved but didn't go onward: no other signer reached, or AP's email failed. */
  emailed: boolean;
  /** false when the signer's own receipt didn't go. */
  receipted: boolean;
}

/**
 * Why `row` no longer waits for the line the page offered (`slot`, of
 * `version`); null when it still does. Checked against the row as the page's
 * request read it, then again under the lock.
 */
function changedSince(row: RequestRow, slot: 1 | 2, version: number): SignerError | null {
  const expected = slot === 1 ? "Waiting" : "1 of 2 signed";
  if (row.status === "Awaiting signers" && versionOf(row) === version && row.signers_step === expected) return null;
  if (versionOf(row) !== version) return new SignerError("This request changed since you opened it. Reload the page to see where it stands.", true);
  if (row.signers_step === "Sent back") return new SignerError("Another check signer sent this request back a moment ago.", true);
  if (slot === 1 && row.signers_step === "1 of 2 signed") return new SignerError(`${row.signer_1_name || "Another check signer"} signed the first line a moment ago. Reload the page to sign the second.`, true);
  if (row.signers_step === "Signed") return new SignerError(`${row.signer_2_name || "Another check signer"} signed this a moment ago. Reload the page to see where it stands.`, true);
  return new SignerError("This request isn't waiting for the check signers any more. Reload the page to see where it stands.", true);
}

/** The lock is held: another signer is signing or sending it back right now, or the requester is resending. */
function busy(error: unknown): never {
  if (error instanceof BusyError) throw new SignerError("Another check signer is working on this request right now. Reload the page in a minute to see where it stands.", true);
  throw error;
}

/** What a signature made, under the lock. */
interface Signed {
  /** The row as written. */
  row: RequestRow;
  record: SignatureRecord;
  packetBytes: Uint8Array;
  /** The FO10 with this signature on it. */
  fo10: Uint8Array;
  fo10Sha256: string;
  /** The second signature's authorized packet; null after the first. */
  authorized: { bytes: Uint8Array; sha256: string } | null;
}

/**
 * Signs one Authorized By line. Under the row's lock, it checks the row
 * again, builds the files, records the signature in the Signatures tab and
 * marks the row, so a second signer pressing Sign at the same moment is
 * refused. The first signature saves the FO10 with it stamped on; the second
 * adds its own to a copy, builds the authorized packet and sends it to AP.
 * Email trouble after the row is written is noted on the row; the requester
 * can send the authorized packet to AP again from their request page.
 */
export async function signAsSigner(input: SignerSignInput, adapters: Adapters): Promise<SignerSignResult> {
  const { files, log, signatures, mailer } = adapters;
  const state = await signerLinkState(input.requestId, input.token, adapters);
  if (state.kind !== "ready") throw new SignerError(signerStateMessage(state), state.kind === "done" || state.kind === "signed-first");
  const shown = changedSince(state.row, input.slot, input.version);
  if (shown) throw shown;
  const { link, stored, slot, first } = state;
  const { request } = stored;
  const requestId = state.row.request_id;
  const version = versionOf(state.row);
  const email = lower(link.email);

  const name = oneLine(input.name);
  if (name.length < 2) throw new SignerError("Enter your full name.");
  // Typed means keeping the name as typed: there's no second text to differ from it.
  const signature = input.signature.type === "typed" ? toPacketSignature({ type: "typed", name }) : toPacketSignature(input.signature);
  if (squash(name) === squash(request.payeeName)) throw new SignerError("You can't authorize a payment to yourself.");

  let accounts: { budgetAccount: string; paymentAccount: string };
  if (slot === 1) {
    const budgetAccount = oneLine(input.budgetAccount ?? "");
    const problem = budgetAccountProblem(budgetAccount);
    if (problem) throw new SignerError(problem);
    const paymentAccount = config.billPayAccounts.length === 1 ? config.billPayAccounts[0] : (input.paymentAccount ?? "");
    if (!config.billPayAccounts.includes(paymentAccount)) throw new SignerError("Choose the Payment Account from the list.");
    accounts = { budgetAccount, paymentAccount };
  } else {
    // As the first signer locked them, which the FO10 was filled from.
    accounts = { budgetAccount: state.accounts.budgetAccount, paymentAccount: state.accounts.paymentAccount };
  }

  const signedAt = new Date();
  const made = await withRequestLock<Signed>(log, requestId, async (row) => {
    const changed = changedSince(row, slot, version);
    if (changed) throw changed;
    // Sign only the exact files that were signed before.
    const packet = signedPacket(row);
    const packetBytes = await verifiedFile(files, requestId, `${packet.kind} packet`, packet.fileId, packet.sha256);
    const record: SignatureRecord = {
      record_id: randomUUID(),
      request_id: requestId,
      version,
      slot,
      signer_email: email,
      signer_name: name,
      state: "signed",
      signed_at: signedAt.toISOString(),
      method: signature.type,
      ip: input.ip,
      browser: input.userAgent,
      link_sent_at: link.issuedAt.toISOString(),
      budget_account: accounts.budgetAccount,
      payment_account: accounts.paymentAccount,
      packet_sha256: packet.sha256,
      fo10_sha256: "",
    };

    if (slot === 1) {
      const fo10 = await fillFo10(fo10Details(row, stored, accounts), [{ slot: 1, name, signature, signedAt }]);
      const saved = await files.putFile({ name: fo10Name(requestId, version), mimeType: "application/pdf", bytes: fo10.bytes, folderPath: requestFolder(row) });
      const signed = { ...record, fo10_sha256: fo10.sha256 };
      // Recorded before the row, so a row marked signed always has its record. One left by a failure here matches no FO10 the row points to.
      await signatures.append(signed);
      const patch: Partial<RequestRow> = {
        signers_step: "1 of 2 signed",
        signer_1_email: email,
        signer_1_name: name,
        signer_1_signed_at: signedAt.toISOString(),
        signer_1_note: input.note,
        budget_account: accounts.budgetAccount,
        payment_account: accounts.paymentAccount,
        fo10_file_id: saved.id,
        fo10_sha256: fo10.sha256,
        // Narrowed below to who the "one more signature" email reaches.
        signers_sent_to: nextSigners({ requester_email: row.requester_email, signer_1_email: email }).join(", "),
        signers_sent_at: signedAt.toISOString(),
      };
      return { patch, result: { row: { ...row, ...patch }, record: signed, packetBytes, fo10: fo10.bytes, fo10Sha256: fo10.sha256, authorized: null } };
    }

    // The first signature as recorded, not the row's signer_1 cells, which can be edited.
    if (!first || row.fo10_sha256 !== first.fo10_sha256) {
      console.error(`[signers] not signing ${requestId}: the row's first-signature FO10 is ${row.fo10_sha256}, its record ${first?.fo10_sha256}`);
      throw mismatch();
    }
    if (lower(first.signer_email) === email) throw new SignerError("You've already signed this one. The second signature has to come from a different check signer.");
    const fo10One = await verifiedFile(files, requestId, "first-signature FO10", row.fo10_file_id, row.fo10_sha256);
    const fo10 = await addSecondSignature(fo10One, { name, signature, signedAt });
    const budgetAccountFilled = budgetAccountDefault(request);
    const authorized = await buildAuthorizedPacket({
      requestId,
      fo10,
      packet: packetBytes,
      authorizedAt: signedAt,
      page: {
        requestId,
        payeeName: request.payeeName,
        mailingAddress: formatAddress(request),
        amountCents: totals(request).reimbursementCents,
        budgetAccount: accounts.budgetAccount,
        paymentAccount: accounts.paymentAccount,
        budgetAccountFilled: budgetAccountFilled === accounts.budgetAccount ? null : budgetAccountFilled,
        signers: [
          {
            slot: 1,
            name: first.signer_name,
            email: first.signer_email,
            linkSentAt: parseDate(first.link_sent_at),
            signedAt: parseDate(first.signed_at) ?? parseDate(row.signer_1_signed_at) ?? signedAt,
            signature: first.method === "drawn" ? { type: "drawn" } : { type: "typed", name: first.signer_name },
          },
          { slot: 2, name, email, linkSentAt: link.issuedAt, signedAt, signature: signature.type === "typed" ? { type: "typed", name } : { type: "drawn" } },
        ],
        consentText: SIGNER_CONSENT_TEXT,
        packetSha256: packet.sha256,
        packetKind: packet.kind,
        fo10Sha256: row.fo10_sha256,
      },
    });
    const saved = await files.putFile({ name: authorizedName(requestId, version), mimeType: "application/pdf", bytes: authorized.bytes, folderPath: requestFolder(row) });
    const signed = { ...record, fo10_sha256: sha256(fo10) };
    await signatures.append(signed);
    const patch: Partial<RequestRow> = {
      status: "Submitted",
      signers_step: "Signed",
      signer_2_email: email,
      signer_2_name: name,
      signer_2_signed_at: signedAt.toISOString(),
      signer_2_note: input.note,
      authorized_pdf_file_id: saved.id,
      authorized_pdf_sha256: authorized.sha256,
    };
    return { patch, result: { row: { ...row, ...patch }, record: signed, packetBytes, fo10, fo10Sha256: signed.fo10_sha256, authorized: { bytes: authorized.bytes, sha256: authorized.sha256 } } };
  }).catch(busy);

  // From here on the signature is recorded; email trouble is noted on the row.
  const problems: string[] = [];
  let emailed = true;
  if (!made.authorized) {
    const result = await sendToSigners({ row: made.row, stored, linkBase: input.linkBase, packetBytes: made.packetBytes, fo10Bytes: made.fo10, flags: state.flags, first: made.record }, adapters);
    // Onward as long as someone who can sign next has a link; the rest are noted, and the requester can resend to them.
    emailed = result.sent.length > 0;
    if (result.error) {
      console.error(`[signers] "one more signature" for ${requestId} failed: ${result.error}`);
      problems.push(`The "one more signature" email${result.failed.length ? ` to ${result.failed.join(", ")}` : ""} failed: ${result.error}`);
      await log.update(requestId, reachedCells(result.sent)).catch(() => undefined);
    }
  } else {
    // The row as the lock wrote it, with this authorized packet: nothing is read between the signature and AP's email,
    // so anything that stops the email is caught here and recorded, and the requester can send it.
    let sent: Awaited<ReturnType<typeof sendAuthorizedPacket>> | null = null;
    try {
      sent = await sendAuthorizedPacket({ row: made.row, stored, authorized: made.authorized.bytes, linkBase: input.linkBase, flags: state.flags, first: first!, rows: state.rows }, adapters);
    } catch (error) {
      emailed = false;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[signers] could not send ${requestId} to AP: ${message}`);
      problems.push(`The authorized packet's email to AP failed: ${message}`);
      // Recorded only when it's known to have failed, so the requester is never offered a second send of a packet AP may have.
      await log
        .update(requestId, { authorized_send_error: message || "failed" })
        .catch((e: unknown) => problems.push(`Couldn't record that AP's email failed: ${e instanceof Error ? e.message : e}`));
    }
    if (sent) {
      await log
        .update(requestId, { authorized_sent_at: sent.sentAt.toISOString() })
        .catch((error: unknown) => problems.push(`Sent to AP, but couldn't record when: ${error instanceof Error ? error.message : error}`));
      if (sent.copyError) problems.push(`The requester's copy of the authorized packet failed: ${sent.copyError}`);
    }
  }

  let receipted = true;
  try {
    const mail = signerReceiptEmail({ requestId, version, slot, name, payeeName: request.payeeName, amountCents: totals(request).reimbursementCents, mailingAddress: formatAddress(request), onward: emailed });
    await mailer.send({ to: [email], subject: mail.subject, text: mail.text, attachments: [{ filename: fo10AttachmentName(requestId, version), mimeType: "application/pdf", bytes: made.fo10 }] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[signers] could not send ${email} their receipt for ${requestId}: ${message}`);
    problems.push(`The signer's receipt (to ${email}) failed: ${message}`);
    receipted = false;
  }
  await appendNotes(log, requestId, problems);
  return { slot, sha256: made.authorized?.sha256 ?? made.fo10Sha256, emailed, receipted };
}

/**
 * Sends the authorized packet to AP, always, then a copy to the requester:
 * the copy only once AP has it, so a requester never holds a packet AP
 * doesn't. The one way a mailed check reaches AP: refuses a row whose
 * authorized packet isn't the one given, for its current version. The
 * accounts come from the first signature's record, which the FO10 was filled
 * from. `rows`, the log as the caller read it, is for the funding lines.
 * Throws if anything stops AP's email; the requester's copy failing only
 * comes back as `copyError`.
 */
export async function sendAuthorizedPacket(
  input: { row: RequestRow; stored: StoredRequest; authorized: Uint8Array; linkBase: string; flags: string[]; first: SignatureRecord; rows?: RequestRow[] },
  adapters: Pick<Adapters, "users" | "stipends" | "log" | "mailer">,
): Promise<{ sentAt: Date; copyError?: string }> {
  const { row, stored, first } = input;
  const sha = sha256(input.authorized);
  if (row.check_delivery !== "mail" || row.signers_step !== "Signed" || !row.authorized_pdf_file_id || row.authorized_pdf_sha256 !== sha || stored.version !== versionOf(row)) {
    throw new Error(`Refusing to send ${row.request_id} to AP: it has no authorized packet for version ${versionOf(row)} matching ${sha}`);
  }
  const submittedAt = new Date(stored.submittedAt);
  // A request awaiting the signers counts against its stipend the same as a submitted one, so the log as read before signing gives the same lines.
  const [user, stipendRows, rows] = await Promise.all([adapters.users.get(row.requester_email), adapters.stipends.list(), input.rows ?? adapters.log.list()]);
  const chair = chairFor(row);
  const signers: SignersAuthorization = {
    signers: [
      { name: first.signer_name, email: first.signer_email, signedAt: parseDate(first.signed_at) ?? submittedAt, note: row.signer_1_note },
      { name: row.signer_2_name, email: row.signer_2_email, signedAt: parseDate(row.signer_2_signed_at) ?? submittedAt, note: row.signer_2_note },
    ],
    budgetAccount: first.budget_account,
    paymentAccount: first.payment_account,
    flags: input.flags,
    packetSha256: signedPacket(row).sha256,
  };
  const email = {
    requestId: row.request_id,
    request: stored.request,
    requesterEmail: row.requester_email,
    submittedAt,
    sha256: sha,
    version: versionOf(row),
    funding: fundingEmailShares(fundingOptions(user, stipendRows, rows, fundingAsOf(row.request_id, submittedAt)), stored.request),
    linkBase: input.linkBase,
    chair: chair && !("skipped" in chair) ? chair : undefined,
    signers,
    answers: stored.answers,
  };
  const attachment = { filename: authorizedName(row.request_id, versionOf(row)), mimeType: "application/pdf", bytes: input.authorized };
  const ap = apAuthorizedEmail(email);
  await adapters.mailer.send({ to: [config.apEmail], replyTo: row.requester_email, subject: ap.subject, text: ap.text, attachments: [attachment] });
  const sentAt = new Date();
  try {
    const copy = requesterAuthorizedEmail(email);
    await adapters.mailer.send({ to: [row.requester_email], subject: copy.subject, text: copy.text, attachments: [attachment] });
    return { sentAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[signers] AP has ${row.request_id}, but the requester's copy failed: ${message}`);
    return { sentAt, copyError: message };
  }
}

export interface SignerSendBackInput extends SignerAction {
  /** Required: what needs to change. */
  note: string;
}

/**
 * Sends the request back instead of signing: it becomes Returned, every
 * signer link stops working, and the requester and AP get the note. Runs
 * under the row's lock, like a signature, so the two can't both go through.
 */
export async function sendBackAsSigner(input: SignerSendBackInput, adapters: Adapters): Promise<{ emailed: boolean }> {
  const { log, signatures, mailer } = adapters;
  const state = await signerLinkState(input.requestId, input.token, adapters);
  if (state.kind !== "ready") throw new SignerError(signerStateMessage(state), state.kind === "done" || state.kind === "signed-first");
  const shown = changedSince(state.row, input.slot, input.version);
  if (shown) throw shown;
  const { link, stored, slot } = state;
  const name = oneLine(input.name);
  const note = input.note.trim();
  if (name.length < 2) throw new SignerError("Enter your full name.");
  if (!note) throw new SignerError("Say what needs to change, so the requester can fix it.");
  const version = versionOf(state.row);
  const now = new Date();
  const row = await withRequestLock(log, state.row.request_id, async (current) => {
    const changed = changedSince(current, slot, version);
    if (changed) throw changed;
    await signatures.append({
      record_id: randomUUID(),
      request_id: current.request_id,
      version,
      slot,
      signer_email: lower(link.email),
      signer_name: name,
      state: "sent back",
      signed_at: now.toISOString(),
      method: "send back",
      ip: input.ip,
      browser: input.userAgent,
      link_sent_at: link.issuedAt.toISOString(),
      budget_account: "",
      payment_account: "",
      packet_sha256: signedPacket(current).sha256,
      fo10_sha256: "",
    });
    const patch: Partial<RequestRow> = { status: "Returned", signers_step: "Sent back", returned_note: note, returned_by: lower(link.email), returned_at: now.toISOString() };
    return { patch, result: current };
  }).catch(busy);

  try {
    const mail = signerSentBackEmail({
      requestId: row.request_id,
      version,
      // The chair signs the new version again when they signed this one.
      event: row.chair_step === "Signed" ? row.event : "",
      payeeName: stored.request.payeeName,
      amountCents: totals(stored.request).reimbursementCents,
      signerName: name,
      signerEmail: lower(link.email),
      note,
      linkBase: input.linkBase,
    });
    await mailer.send({ to: [row.requester_email], cc: [config.apEmail], replyTo: config.apEmail, subject: mail.subject, text: mail.text });
    return { emailed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[signers] the sent-back email for ${row.request_id} failed: ${message}`);
    await appendNotes(log, row.request_id, [`Email that a check signer sent it back failed: ${message}`]);
    return { emailed: false };
  }
}

export type SignerResendProblem = "not-found" | "closed" | "too-soon" | "no-signers" | "busy" | "failed";

export class SignerResendError extends ResendProblemError<SignerResendProblem> {}

/** Where the signer emails stand for a request awaiting the signers, and who a resend now would go to. */
export interface SignerSending {
  /** Who holds a link from the latest send. */
  reached: string[];
  /** Signers who may sign next but haven't been reached: their email failed, or they were added since. */
  unreached: string[];
  /** Who a resend now goes to: every signer who may sign next once the wait is over, else only the unreached. */
  to: string[];
  everyone: boolean;
  /** When it can go to everyone again; null once it can. */
  nextAt: Date | null;
}

export function signerSending(row: Pick<RequestRow, "requester_email" | "signer_1_email" | "signers_sent_to" | "signers_sent_at">, now = new Date()): SignerSending {
  const current = nextSigners(row);
  const reached = addressList(row.signers_sent_to).filter((a) => current.includes(a));
  const unreached = current.filter((signer) => !reached.includes(signer));
  const sentAt = parseDate(row.signers_sent_at);
  const next = sentAt ? new Date(sentAt.getTime() + config.signerResendHours * 3_600_000) : null;
  const everyone = !next || next <= now;
  return { reached, unreached, to: everyone ? current : unreached, everyone, nextAt: everyone ? null : next };
}

function resendProblem(row: RequestRow, sending: SignerSending): SignerResendError | null {
  if (row.status !== "Awaiting signers") return new SignerResendError("closed", "This request isn't waiting for the check signers any more.");
  if (sending.to.length > 0) return null;
  if (sending.nextAt) return new SignerResendError("too-soon", `The check signers were emailed less than ${config.signerResendHours} hours ago. You can send it again after ${formatDateTime(sending.nextAt)}.`);
  return new SignerResendError("no-signers", `The PTA hasn't listed enough check signers right now. Ask the PTA at ${config.apEmail} what to do.`);
}

/**
 * The requester's "Resend to the check signers": the signing email again,
 * with fresh links. Once a day it goes to every signer who may sign next;
 * before that, only to those it hasn't reached. Runs under the row's lock,
 * so a double click sends it once, and it can't go out halfway through a
 * signature.
 */
export async function resendToSigners(
  input: { requestId: string; requesterEmail: string; linkBase: string; now?: Date },
  adapters: Pick<Adapters, "log" | "files" | "mailer" | "signatures">,
): Promise<{ sentTo: string[] }> {
  const { log } = adapters;
  const now = input.now ?? new Date();
  const first = await log.get(input.requestId);
  if (!first || lower(first.requester_email) !== lower(input.requesterEmail)) throw new SignerResendError("not-found", "That request wasn't found.");
  const early = resendProblem(first, signerSending(first, now));
  if (early) throw early;
  try {
    return await withRequestLock(log, input.requestId, async (row) => {
      const sending = signerSending(row, now);
      const problem = resendProblem(row, sending);
      if (problem) throw problem;
      const stored = await loadCheckedRequest(adapters.files, row);
      const { sent, error } = await sendToSigners({ row, stored, to: sending.to, linkBase: input.linkBase, reminder: true }, adapters);
      if (sent.length === 0) {
        console.error(`[signers] resend of ${row.request_id} failed: ${error}`);
        throw new SignerResendError("failed", "The email didn't go through. Please try again in a few minutes.");
      }
      const patch: Partial<RequestRow> = sending.everyone
        ? { signers_sent_to: sent.join(", "), signers_sent_at: now.toISOString() }
        : { signers_sent_to: [...new Set([...sending.reached, ...sent])].join(", ") };
      return { patch, result: { sentTo: sent } };
    });
  } catch (error) {
    if (error instanceof BusyError) throw new SignerResendError("busy", "It's being sent right now. Reload the page in a minute to see when it went.");
    throw error;
  }
}

/**
 * Whether AP has the authorized packet: "sent" once its email went (or AP has
 * moved the request on, so they have it), "unsent" once a try to email it is
 * known to have failed, and "sending" otherwise, while the second signer's
 * request is still sending it. Never guessed from the time: a send that went
 * through but couldn't be recorded stays "sending", so the requester isn't
 * offered a second send of a packet AP may have. Null with no authorized packet.
 */
export function authorizedSending(
  row: Pick<RequestRow, "check_delivery" | "status" | "signers_step" | "authorized_pdf_file_id" | "authorized_sent_at" | "authorized_send_error">,
): "sent" | "sending" | "unsent" | null {
  if (row.check_delivery !== "mail" || row.signers_step !== "Signed" || !row.authorized_pdf_file_id) return null;
  if (row.authorized_sent_at || row.status !== "Submitted") return "sent";
  return row.authorized_send_error ? "unsent" : "sending";
}

export type AuthorizedResendProblem = "not-found" | "closed" | "already-sent" | "sending" | "mismatch" | "busy" | "failed";

export class AuthorizedResendError extends ResendProblemError<AuthorizedResendProblem> {}

function authorizedResendProblem(row: RequestRow): AuthorizedResendError | null {
  switch (authorizedSending(row)) {
    case null:
      return new AuthorizedResendError("closed", "This request has no authorized packet to send.");
    case "sent":
      return new AuthorizedResendError("already-sent", "The PTA's accounts payable team already has it.");
    case "sending":
      return new AuthorizedResendError("sending", "It's still on its way. You'll get a copy by email once the PTA has it.");
    case "unsent":
      return null;
  }
}

/**
 * The requester's "Send it to the PTA", offered only once the authorized
 * packet's email to AP is recorded as failed. Sends the saved packet from
 * Drive, checked against its hash, to AP, then the requester's copy, which
 * didn't go the first time because it only follows AP's. The requester never
 * carries the packet to AP. Runs under the row's lock, so a double click
 * sends it once, and clears the recorded failure before sending, so a send
 * whose success can't be written down is never offered again.
 */
export async function sendAuthorizedAgain(
  input: { requestId: string; requesterEmail: string; linkBase: string },
  adapters: Pick<Adapters, "log" | "files" | "signatures" | "users" | "stipends" | "mailer">,
): Promise<void> {
  const { log, files, signatures } = adapters;
  const first = await log.get(input.requestId);
  if (!first || lower(first.requester_email) !== lower(input.requesterEmail)) throw new AuthorizedResendError("not-found", "That request wasn't found.");
  const early = authorizedResendProblem(first);
  if (early) throw early;
  let copyError: string | undefined;
  try {
    copyError = await withRequestLock(log, input.requestId, async (row) => {
      const problem = authorizedResendProblem(row);
      if (problem) throw problem;
      let sending: Parameters<typeof sendAuthorizedPacket>[0];
      try {
        const [authorized, stored, records, rows] = await Promise.all([
          verifiedFile(files, row.request_id, "authorized packet", row.authorized_pdf_file_id, row.authorized_pdf_sha256),
          loadCheckedRequest(files, row),
          signatures.listFor(row.request_id),
          log.list(),
        ]);
        sending = { row, stored, authorized, linkBase: input.linkBase, flags: signerFlags(row, stored.request, rows), first: firstSignature(row, records), rows };
      } catch (error) {
        if (error instanceof SignerError) throw new AuthorizedResendError("mismatch", error.message);
        throw error;
      }
      // Cleared before the send, so the row says "sending" from here on. If the send can't be recorded after it
      // goes (the lock's release write failing), the button doesn't come back to send AP a second packet.
      await log.update(row.request_id, { authorized_send_error: "" });
      try {
        const sent = await sendAuthorizedPacket(sending, adapters);
        return { patch: { authorized_sent_at: sent.sentAt.toISOString() }, result: sent.copyError };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[signers] resend of ${row.request_id}'s authorized packet failed: ${message}`);
        // Known to have failed, so it's offered again.
        await log
          .update(row.request_id, { authorized_send_error: message || "failed" })
          .catch((e: unknown) => console.error(`[signers] couldn't record that ${row.request_id}'s resend failed: ${e instanceof Error ? e.message : e}`));
        throw new AuthorizedResendError("failed", "The email didn't go through. Please try again in a few minutes.");
      }
    });
  } catch (error) {
    if (error instanceof BusyError) throw new AuthorizedResendError("busy", "It's being sent right now. Reload the page in a minute to see whether it went.");
    throw error;
  }
  if (copyError) await appendNotes(log, input.requestId, [`Sent to AP again, but the requester's copy of the authorized packet failed: ${copyError}`]);
}
