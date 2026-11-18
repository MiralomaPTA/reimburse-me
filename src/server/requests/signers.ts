import { createHash } from "node:crypto";
import type { Adapters, RequestRow, SignatureClaim } from "@/server/adapters/types";
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
import { claimSignature, stillHeld } from "@/server/requests/claims";
import { BusyError, withRequestLock } from "@/server/requests/lock";
import { signersFor } from "@/server/requests/mailing";
import { toPacketSignature } from "@/server/requests/signature";
import { fundingEmailShares, fundingLabel, fundingOptions, parseFundingChoice } from "@/server/requests/stipends";
import { authorizedName, cosignedName, fo10Name, loadStoredRequest, type StoredRequest } from "@/server/requests/stored";
import { formatDateTime, formatMonthDay, parseDate } from "@/lib/dates";
import { fiscalYearLabel } from "@/lib/fiscal-year";
import { budgetAccountProblem, formatAddress, oneLine, sameAddress, squash } from "@/lib/mailing";
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
 */

export const signerLinkPath = (requestId: string, token: string) => `/signers/${encodeURIComponent(requestId)}?t=${encodeURIComponent(token)}`;

const versionOf = (row: Pick<RequestRow, "version">) => Number(row.version) || 1;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const lower = (email: string) => String(email ?? "").trim().toLowerCase();

/** A comma-separated address cell as lower-case addresses. */
const addresses = (cell: string) =>
  String(cell ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

const folderOf = (row: Pick<RequestRow, "request_id" | "submitted_at">) => ["requests", fiscalYearLabel(new Date(row.submitted_at)), row.request_id];

/** The packet the check signers authorize: co-signed when the chair signed, otherwise as the requester signed it. */
export function signedPacket(row: RequestRow): { fileId: string; sha256: string; filename: string; kind: "co-signed" | "requester-signed" } {
  if (row.chair_pdf_file_id) return { fileId: row.chair_pdf_file_id, sha256: row.chair_pdf_sha256, filename: cosignedName(row.request_id, versionOf(row)), kind: "co-signed" };
  return { fileId: row.pdf_file_id, sha256: row.pdf_sha256, filename: `${row.request_id}.pdf`, kind: "requester-signed" };
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

const mismatch = () => new SignerError(`This request's signed files don't match the record of what was signed, so it can't be authorized. Please let the PTA know at ${config.apEmail}.`);

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
 * blank for the first signer to fill in.
 */
export function budgetAccountDefault(request: Pick<RequestInput, "items" | "donationCents" | "event">): string {
  const labels = fundingSplit(request)
    .map((share) => share.funding)
    .filter((choice) => choice && choice !== "none")
    .map((choice) => {
      const { key, grade } = parseFundingChoice(choice);
      return fundingLabel(key, grade);
    });
  if (labels.length > 0) return [...new Set(labels)].join("; ");
  return request.event || "";
}

/**
 * The signs of an account that's been taken over, which matter more once a
 * check can be mailed anywhere. `requesterRows` are the requester's requests;
 * only those submitted before this one count.
 */
export function signerFlags(row: Pick<RequestRow, "request_id" | "submitted_at">, request: Pick<RequestInput, "payeeName" | "address" | "cityStateZip">, requesterRows: RequestRow[]): string[] {
  const earlier = requesterRows.filter((r) => r.request_id !== row.request_id && r.submitted_at < row.submitted_at).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  const flags: string[] = [];
  const mailed = earlier.filter((r) => r.check_delivery === "mail" && String(r.address ?? "").trim());
  if (mailed.length === 0) flags.push("This is the first mailed request from this account.");
  else if (!sameAddress({ address: mailed[0].address, cityStateZip: mailed[0].city_zip }, request)) {
    flags.push(`The address differs from this account's last mailed request (${mailed[0].request_id}).`);
  }
  if (earlier.length > 0 && !earlier.some((r) => squash(r.payee_name) === squash(request.payeeName))) {
    flags.push(`The payee name differs from the one on this account's earlier requests ("${earlier[0].payee_name}").`);
  }
  return flags;
}

export interface Accounts {
  budgetAccount: string;
  paymentAccount: string;
  /** Set by the first signer: the second signs exactly what the first did. */
  locked: boolean;
}

/** The Budget Account and Payment Account as the next signer sees them. */
export function currentAccounts(row: RequestRow, request: RequestInput): Accounts {
  if (row.signers_step === "1 of 2 signed") return { budgetAccount: row.budget_account, paymentAccount: row.payment_account, locked: true };
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
    case "Timed out":
      return { skipped: `The ${row.event} chair didn't sign in time, so the form's VP/Chairman line is blank.` };
    default:
      return null;
  }
}

/** The FO10 as the next signer sees it: unsigned before the first signature, then the first-signature file. */
async function currentFo10(row: RequestRow, stored: StoredRequest, files: Adapters["files"]): Promise<Uint8Array> {
  if (row.signers_step === "1 of 2 signed" && row.fo10_file_id) return files.getFileBytes(row.fo10_file_id);
  return (await fillFo10(fo10Details(row, stored, currentAccounts(row, stored.request)))).bytes;
}

export interface SendToSignersInput {
  /** The row as it stands, awaiting the signers. */
  row: RequestRow;
  stored: StoredRequest;
  /** Who to email; every check signer who may sign next when left out. */
  to?: string[];
  linkBase: string;
  /** The packet's bytes, when the caller has them already. */
  packetBytes?: Uint8Array;
  reminder?: boolean;
}

/** The check signers who may sign `row` next: every one but the requester and whoever signed the first line. */
export function nextSigners(row: Pick<RequestRow, "requester_email" | "signer_1_email">): string[] {
  const first = lower(row.signer_1_email);
  return signersFor(row.requester_email).filter((signer) => signer !== first);
}

/**
 * Emails each check signer their own link, with the packet and the FO10 as
 * filled in so far. Replies go to AP, never the requester: a reply quotes the
 * link, and the link is all it takes to sign. Never throws: says who was
 * reached and why the others weren't.
 */
export async function sendToSigners(input: SendToSignersInput, adapters: Pick<Adapters, "files" | "log" | "mailer">): Promise<{ sent: string[]; failed: string[]; error?: string }> {
  const { row, stored } = input;
  const to = input.to ?? nextSigners(row);
  if (to.length === 0) return { sent: [], failed: [], error: "No check signers to email: CHECK_SIGNERS lists fewer than two besides the requester." };
  try {
    const packet = signedPacket(row);
    const [packetBytes, fo10, requesterRows] = await Promise.all([
      input.packetBytes ?? adapters.files.getFileBytes(packet.fileId),
      currentFo10(row, stored, adapters.files),
      adapters.log.listByEmail(row.requester_email),
    ]);
    const accounts = currentAccounts(row, stored.request);
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
      flags: signerFlags(row, stored.request, requesterRows),
      chair: chairFor(row),
      firstSigner: row.signers_step === "1 of 2 signed" && firstAt ? { name: row.signer_1_name, signedAt: firstAt } : null,
      packetSha256: packet.sha256,
      reminder: input.reminder,
    };
    const attachments = [
      { filename: packet.filename, mimeType: "application/pdf", bytes: packetBytes },
      { filename: `${row.request_id}-fo10.pdf`, mimeType: "application/pdf", bytes: fo10 },
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
  | {
      kind: "ready";
      row: RequestRow;
      link: SignerLink;
      stored: StoredRequest;
      /** Which Authorized By line this signer would sign. */
      slot: 1 | 2;
      accounts: Accounts;
      /** What the app fills the Budget Account with, before the first signer changes it. */
      budgetAccountFilled: string;
      flags: string[];
      chair: ReturnType<typeof chairFor>;
    };

type CheckedLink = Exclude<SignerLinkState, { kind: "ready" | "done" }> | { kind: "closed"; row: RequestRow } | { kind: "open"; row: RequestRow; link: SignerLink; slot: 1 | 2 };

/**
 * The checks every use of a link makes, against the row and CHECK_SIGNERS as
 * they are now, so removing a signer and redeploying stops their links at
 * once.
 */
async function checkLink(requestId: string, token: string, log: Adapters["log"]): Promise<CheckedLink> {
  const link = token ? await verifySignerToken(token) : null;
  if (!link || link.requestId !== requestId) return { kind: "invalid" };
  const row = await log.get(requestId);
  if (!row) return { kind: "invalid" };
  if (link.version !== versionOf(row)) return { kind: "stale", row };
  const email = lower(link.email);
  if (!config.checkSigners.includes(email) || email === lower(row.requester_email)) return { kind: "not-signer", row, link };
  // A status typed into the Sheet by hand has no stored request to fill the FO10 from.
  if (row.status !== "Awaiting signers" || row.check_delivery !== "mail" || !row.request_file_id) return { kind: "closed", row };
  if (row.signers_step === "1 of 2 signed") {
    if (email === lower(row.signer_1_email)) return { kind: "signed-first", row, link };
    return { kind: "open", row, link, slot: 2 };
  }
  return { kind: "open", row, link, slot: 1 };
}

/** Who sent a request back, from the Signatures tab. */
export async function sentBackBy(signatures: Adapters["signatures"], row: RequestRow): Promise<SignatureClaim | null> {
  const claims = await signatures.listFor(row.request_id);
  return claims.filter((c) => c.state === "sent back" && Number(c.version) === versionOf(row)).pop() ?? null;
}

/** All a link shows once the request has left the check signers: who authorized it or sent it back, and when. */
export function signersStatusLine(row: RequestRow, sentBack: Pick<SignatureClaim, "signer_name" | "signed_at"> | null): string {
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
  const checked = await checkLink(requestId, token, adapters.log);
  if (checked.kind === "closed") {
    const sentBack = checked.row.signers_step === "Sent back" ? await sentBackBy(adapters.signatures, checked.row) : null;
    return { kind: "done", row: checked.row, status: signersStatusLine(checked.row, sentBack) };
  }
  if (checked.kind !== "open") return checked;
  const { row, link, slot } = checked;
  const [stored, requesterRows] = await Promise.all([loadCheckedRequest(adapters.files, row), adapters.log.listByEmail(row.requester_email)]);
  return {
    kind: "ready",
    row,
    link,
    stored,
    slot,
    accounts: currentAccounts(row, stored.request),
    budgetAccountFilled: budgetAccountDefault(stored.request),
    flags: signerFlags(row, stored.request, requesterRows),
    chair: chairFor(row),
  };
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
    case "done":
      return state.status;
  }
}

/**
 * A file a signer's link serves, after the same checks as the page: the
 * packet they're asked to authorize, or the FO10 as it stands. Null once the
 * link can't open the request, including after it has left the signers.
 */
export async function signerPdf(requestId: string, token: string, which: "packet" | "fo10", adapters: Pick<Adapters, "log" | "files">): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const checked = await checkLink(requestId, token, adapters.log);
  if (checked.kind !== "open") return null;
  const { row } = checked;
  if (which === "packet") {
    const packet = signedPacket(row);
    return { bytes: await adapters.files.getFileBytes(packet.fileId), filename: packet.filename };
  }
  const stored = await loadCheckedRequest(adapters.files, row);
  return { bytes: await currentFo10(row, stored, adapters.files), filename: `${requestId}-fo10.pdf` };
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
  /** false when the signature was saved but an email onward (to the other signers, or to AP) didn't go. */
  emailed: boolean;
  /** false when the signer's own receipt didn't go. */
  receipted: boolean;
}

/** The page's view is out of date: someone else signed or sent it back since it loaded. */
function checkShown(state: Extract<SignerLinkState, { kind: "ready" }>, input: Pick<SignerAction, "slot" | "version">) {
  if (input.version === versionOf(state.row) && input.slot === state.slot) return;
  throw new SignerError(
    state.slot === 2 && input.slot === 1
      ? `${state.row.signer_1_name || "Another check signer"} signed the first line a moment ago. Reload the page to sign the second.`
      : "This request changed since you opened it. Reload the page to see where it stands.",
    true,
  );
}

/** Words for a claim lost to another signer's. */
function lostTo(winner: SignatureClaim): SignerError {
  if (winner.state === "sent back") return new SignerError(`${winner.signer_name || "Another check signer"} sent this request back a moment ago.`, true);
  if (winner.state === "signed") return new SignerError(`${winner.signer_name || "Another check signer"} signed this a moment ago. Reload the page to see where it stands.`, true);
  return new SignerError("Another check signer is signing this request right now. Reload the page in a minute to see whether it went through.", true);
}

/**
 * Signs one Authorized By line. The signature is claimed in the Signatures
 * tab first, and only the winning claim builds the files, records the
 * signature and sends the emails (see claims.ts). The first signature saves
 * the FO10 with it stamped on; the second adds its own to a copy, builds the
 * authorized packet and sends it to AP. Email trouble after the row is
 * written is noted on the row, never retried.
 */
export async function signAsSigner(input: SignerSignInput, adapters: Adapters): Promise<SignerSignResult> {
  const { files, log, signatures, mailer } = adapters;
  const state = await signerLinkState(input.requestId, input.token, adapters);
  if (state.kind !== "ready") throw new SignerError(signerStateMessage(state), state.kind === "done" || state.kind === "signed-first");
  checkShown(state, input);
  const { row, link, stored, slot } = state;
  const { request } = stored;
  const requestId = row.request_id;
  const version = versionOf(row);

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
    accounts = { budgetAccount: row.budget_account, paymentAccount: row.payment_account };
  }

  const packet = signedPacket(row);
  const signedAt = new Date();
  const outcome = await claimSignature(
    signatures,
    {
      request_id: requestId,
      version,
      slot,
      signer_email: lower(link.email),
      signer_name: name,
      method: signature.type,
      ip: input.ip,
      browser: input.userAgent,
      link_sent_at: link.issuedAt.toISOString(),
      budget_account: accounts.budgetAccount,
      payment_account: accounts.paymentAccount,
    },
    signedAt,
  );
  if (!outcome.won) throw lostTo(outcome.winner);
  const { claim } = outcome;

  let made: { fo10: Uint8Array; fo10Sha256: string; authorized: { bytes: Uint8Array; sha256: string } | null; packetBytes: Uint8Array };
  try {
    // Sign only the exact files that were signed before.
    const packetBytes = await files.getFileBytes(packet.fileId);
    if (sha256(packetBytes) !== packet.sha256) {
      console.error(`[signers] not signing ${requestId}: the ${packet.kind} packet is ${sha256(packetBytes)}, the row says ${packet.sha256}`);
      throw mismatch();
    }
    // Building takes seconds; make sure the claim still holds before writing anything.
    const stillOurs = async () => {
      if (!(await stillHeld(signatures, claim))) throw new SignerError("This took too long, and another check signer may be signing now. Reload the page to see where it stands.", true);
    };
    let patch: Partial<RequestRow>;
    if (slot === 1) {
      const fo10 = await fillFo10(fo10Details(row, stored, accounts), [{ slot: 1, name, signature, signedAt }]);
      await stillOurs();
      const saved = await files.putFile({ name: fo10Name(requestId, version), mimeType: "application/pdf", bytes: fo10.bytes, folderPath: folderOf(row) });
      made = { fo10: fo10.bytes, fo10Sha256: fo10.sha256, authorized: null, packetBytes };
      patch = {
        signers_step: "1 of 2 signed",
        signer_1_email: lower(link.email),
        signer_1_name: name,
        signer_1_signed_at: signedAt.toISOString(),
        signer_1_note: input.note,
        budget_account: accounts.budgetAccount,
        payment_account: accounts.paymentAccount,
        fo10_file_id: saved.id,
        fo10_sha256: fo10.sha256,
        // Narrowed below to who the "one more signature" email reaches.
        signers_sent_to: nextSigners({ requester_email: row.requester_email, signer_1_email: link.email }).join(", "),
        signers_sent_at: signedAt.toISOString(),
      };
    } else {
      const fo10One = await files.getFileBytes(row.fo10_file_id);
      if (sha256(fo10One) !== row.fo10_sha256) {
        console.error(`[signers] not signing ${requestId}: the first-signature FO10 is ${sha256(fo10One)}, the row says ${row.fo10_sha256}`);
        throw mismatch();
      }
      const first = outcome.all.find((c) => c.state === "signed" && Number(c.slot) === 1 && Number(c.version) === version);
      const fo10 = await addSecondSignature(fo10One, { name, signature, signedAt });
      const firstSignedAt = parseDate(row.signer_1_signed_at) ?? signedAt;
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
              name: row.signer_1_name,
              email: row.signer_1_email,
              linkSentAt: parseDate(first?.link_sent_at),
              signedAt: firstSignedAt,
              signature: first?.method === "drawn" ? { type: "drawn" } : { type: "typed", name: row.signer_1_name },
              note: row.signer_1_note,
            },
            { slot: 2, name, email: lower(link.email), linkSentAt: link.issuedAt, signedAt, signature: signature.type === "typed" ? { type: "typed", name } : { type: "drawn" }, note: input.note },
          ],
          consentText: SIGNER_CONSENT_TEXT,
          packetSha256: packet.sha256,
          packetKind: packet.kind,
          fo10Sha256: row.fo10_sha256,
          flags: state.flags,
        },
      });
      await stillOurs();
      const saved = await files.putFile({ name: authorizedName(requestId, version), mimeType: "application/pdf", bytes: authorized.bytes, folderPath: folderOf(row) });
      made = { fo10, fo10Sha256: sha256(fo10), authorized: { bytes: authorized.bytes, sha256: authorized.sha256 }, packetBytes };
      patch = {
        status: "Submitted",
        signers_step: "Signed",
        signer_2_email: lower(link.email),
        signer_2_name: name,
        signer_2_signed_at: signedAt.toISOString(),
        signer_2_note: input.note,
        authorized_pdf_file_id: saved.id,
        authorized_pdf_sha256: authorized.sha256,
      };
    }
    const expected = slot === 1 ? "Waiting" : "1 of 2 signed";
    const wrote = await log.updateIf(requestId, (r) => r.status === "Awaiting signers" && versionOf(r) === version && r.signers_step === expected, patch);
    if (!wrote) throw new SignerError("This request isn't waiting for the check signers any more.", true);
  } catch (error) {
    // Frees the signature at once rather than after the time-out.
    await signatures.update(claim.claim_id, { state: "abandoned" }).catch(() => undefined);
    throw error;
  }
  await signatures
    .update(claim.claim_id, { state: "signed", signed_at: signedAt.toISOString(), packet_sha256: packet.sha256, fo10_sha256: made.fo10Sha256 })
    .catch((error: unknown) => console.error(`[signers] signed ${requestId} line ${slot}, but couldn't mark the claim signed: ${error instanceof Error ? error.message : error}`));

  // From here on the signature is recorded; email trouble is noted on the row.
  const problems: string[] = [];
  let emailed = true;
  const after = await log.get(requestId);
  if (slot === 1) {
    const result = after ? await sendToSigners({ row: after, stored, linkBase: input.linkBase, packetBytes: made.packetBytes }, adapters) : { sent: [], failed: [], error: "the row vanished" };
    if (result.error) {
      emailed = false;
      console.error(`[signers] "one more signature" for ${requestId} failed: ${result.error}`);
      problems.push(`The "one more signature" email${result.failed.length ? ` to ${result.failed.join(", ")}` : ""} failed: ${result.error}`);
      await log.update(requestId, { signers_sent_to: result.sent.join(", "), ...(result.sent.length === 0 ? { signers_sent_at: "" } : {}) }).catch(() => undefined);
    }
  } else if (after?.authorized_pdf_sha256 === made.authorized!.sha256) {
    // Sent only if the authorized packet the row records is the one made here.
    try {
      await sendAuthorizedPacket({ row: after, stored, authorized: made.authorized!.bytes, linkBase: input.linkBase, flags: state.flags }, adapters);
    } catch (error) {
      emailed = false;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[signers] could not send ${requestId} to AP: ${message}`);
      problems.push(`Email of the authorized packet failed: ${message}`);
    }
  } else {
    emailed = false;
    console.error(`[signers] not emailing AP for ${requestId}: the row records ${after?.authorized_pdf_sha256}, this signing made ${made.authorized!.sha256}`);
    problems.push("The authorized packet wasn't emailed: the row records a different one.");
  }

  let receipted = true;
  try {
    const mail = signerReceiptEmail({ requestId, slot, name, payeeName: request.payeeName, amountCents: totals(request).reimbursementCents, mailingAddress: formatAddress(request) });
    await mailer.send({ to: [lower(link.email)], subject: mail.subject, text: mail.text, attachments: [{ filename: `${requestId}-fo10.pdf`, mimeType: "application/pdf", bytes: made.fo10 }] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[signers] could not send ${link.email} their receipt for ${requestId}: ${message}`);
    problems.push(`The signer's receipt (to ${link.email}) failed: ${message}`);
    receipted = false;
  }
  if (problems.length > 0) await log.update(requestId, { notes: [after?.notes ?? row.notes, ...problems].filter(Boolean).join(" | ") }).catch(() => undefined);
  return { slot, sha256: made.authorized?.sha256 ?? made.fo10Sha256, emailed, receipted };
}

/**
 * Sends the authorized packet to AP, always, with a copy to the requester.
 * The one way a mailed check reaches AP: refuses a row whose authorized
 * packet isn't the one given, for its current version.
 */
export async function sendAuthorizedPacket(
  input: { row: RequestRow; stored: StoredRequest; authorized: Uint8Array; linkBase: string; flags: string[] },
  adapters: Pick<Adapters, "users" | "stipends" | "log" | "mailer">,
): Promise<void> {
  const { row, stored } = input;
  const sha = sha256(input.authorized);
  if (row.check_delivery !== "mail" || row.signers_step !== "Signed" || !row.authorized_pdf_file_id || row.authorized_pdf_sha256 !== sha || stored.version !== versionOf(row)) {
    throw new Error(`Refusing to send ${row.request_id} to AP: it has no authorized packet for version ${versionOf(row)} matching ${sha}`);
  }
  const submittedAt = new Date(stored.submittedAt);
  const [user, stipendRows, rows] = await Promise.all([adapters.users.get(row.requester_email), adapters.stipends.list(), adapters.log.list()]);
  const chair = chairFor(row);
  const signers: SignersAuthorization = {
    signers: [
      { name: row.signer_1_name, email: row.signer_1_email, signedAt: parseDate(row.signer_1_signed_at) ?? submittedAt, note: row.signer_1_note },
      { name: row.signer_2_name, email: row.signer_2_email, signedAt: parseDate(row.signer_2_signed_at) ?? submittedAt, note: row.signer_2_note },
    ],
    budgetAccount: row.budget_account,
    paymentAccount: row.payment_account,
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
    funding: fundingEmailShares(fundingOptions(user, stipendRows, rows, submittedAt), stored.request),
    linkBase: input.linkBase,
    chair: chair && !("skipped" in chair) ? chair : undefined,
    signers,
  };
  const attachment = { filename: authorizedName(row.request_id, versionOf(row)), mimeType: "application/pdf", bytes: input.authorized };
  const ap = apAuthorizedEmail(email);
  await adapters.mailer.send({ to: [config.apEmail], replyTo: row.requester_email, subject: ap.subject, text: ap.text, attachments: [attachment] });
  const copy = requesterAuthorizedEmail(email);
  await adapters.mailer.send({ to: [row.requester_email], subject: copy.subject, text: copy.text, attachments: [attachment] });
}

export interface SignerSendBackInput extends SignerAction {
  /** Required: what needs to change. */
  note: string;
}

/**
 * Sends the request back instead of signing: it becomes Returned, every
 * signer link stops working, and the requester and AP get the note. Claims
 * the signature it replaces, so a signature at the same moment can't also go
 * through.
 */
export async function sendBackAsSigner(input: SignerSendBackInput, adapters: Adapters): Promise<{ emailed: boolean }> {
  const { log, signatures, mailer } = adapters;
  const state = await signerLinkState(input.requestId, input.token, adapters);
  if (state.kind !== "ready") throw new SignerError(signerStateMessage(state), state.kind === "done" || state.kind === "signed-first");
  checkShown(state, input);
  const { row, link, stored, slot } = state;
  const name = oneLine(input.name);
  const note = input.note.trim();
  if (name.length < 2) throw new SignerError("Enter your full name.");
  if (!note) throw new SignerError("Say what needs to change, so the requester can fix it.");
  const version = versionOf(row);
  const now = new Date();
  const outcome = await claimSignature(
    signatures,
    {
      request_id: row.request_id,
      version,
      slot,
      signer_email: lower(link.email),
      signer_name: name,
      method: "send back",
      ip: input.ip,
      browser: input.userAgent,
      link_sent_at: link.issuedAt.toISOString(),
      budget_account: "",
      payment_account: "",
    },
    now,
  );
  if (!outcome.won) throw lostTo(outcome.winner);
  const expected = slot === 1 ? "Waiting" : "1 of 2 signed";
  const wrote = await log
    .updateIf(row.request_id, (r) => r.status === "Awaiting signers" && versionOf(r) === version && r.signers_step === expected, { status: "Returned", signers_step: "Sent back", returned_note: note })
    .catch(async (error: unknown) => {
      await signatures.update(outcome.claim.claim_id, { state: "abandoned" }).catch(() => undefined);
      throw error;
    });
  if (!wrote) {
    await signatures.update(outcome.claim.claim_id, { state: "abandoned" }).catch(() => undefined);
    throw new SignerError("This request isn't waiting for the check signers any more.", true);
  }
  await signatures.update(outcome.claim.claim_id, { state: "sent back", signed_at: now.toISOString() }).catch(() => undefined);

  try {
    const mail = signerSentBackEmail({
      requestId: row.request_id,
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
    await log.update(row.request_id, { notes: [row.notes, `Email that a check signer sent it back failed: ${message}`].filter(Boolean).join(" | ") }).catch(() => undefined);
    return { emailed: false };
  }
}

export type SignerResendProblem = "not-found" | "closed" | "too-soon" | "no-signers" | "busy" | "failed";

export class SignerResendError extends Error {
  constructor(
    readonly problem: SignerResendProblem,
    message: string,
  ) {
    super(message);
  }
}

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
  const reached = addresses(row.signers_sent_to).filter((a) => current.includes(a));
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
 * so a double click sends it once.
 */
export async function resendToSigners(
  input: { requestId: string; requesterEmail: string; linkBase: string; now?: Date },
  adapters: Pick<Adapters, "log" | "files" | "mailer">,
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
