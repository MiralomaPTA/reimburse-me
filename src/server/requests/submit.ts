import type { Adapters, RequestRow } from "@/server/adapters/types";
import type { ApprovedSession } from "@/server/auth/session";
import { config } from "@/server/config";
import { apSubmissionEmail, requesterCopyEmail, requesterPacketEmail } from "@/server/email/templates";
import { buildPacket } from "@/server/pdf/build-packet";
import { CONSENT_TEXT, type PacketSignature } from "@/server/pdf/types";
import { FundingError, fundingCell, fundingLabel, fundingOptions, parseFundingChoice, type FundingOptions } from "@/server/requests/stipends";
import { loadReceiptFiles } from "@/server/requests/receipts";
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
  /** false when the row was written but the email could not be sent. */
  emailed: boolean;
  emailError?: string;
}

function toPacketSignature(signature: SignatureInput): PacketSignature {
  if (signature.type === "typed") return { type: "typed", name: signature.name };
  const base64 = signature.pngDataUrl.slice("data:image/png;base64,".length);
  return { type: "drawn", png: new Uint8Array(Buffer.from(base64, "base64")) };
}

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
 * Where the packet goes depends on `config.sendPacketsTo`: to AP with a copy
 * to the requester, or only to the requester, who forwards it to AP by hand.
 *
 * The order decides what a failure leaves behind. The PDF is stored, then the
 * row is written, and only then are the receipts moved and the emails sent.
 * Failing in the first two steps leaves at most an orphan PDF in Drive and the
 * requester simply tries again. Trouble in the last two is noted on the row
 * and reported, never retried, so no request is ever logged twice.
 */
export async function submitRequest(input: SubmitInput, adapters: Adapters): Promise<SubmitResult> {
  const { request, session, ip, userAgent } = input;
  const { files, log, mailer, stipends } = adapters;
  const { user } = session;
  const submittedAt = new Date();
  const [receiptFiles, stipendRows, earlierRows] = await Promise.all([loadReceiptFiles(request, session.email, files), stipends.list(), log.list()]);
  const choices = fundingOptions(user, stipendRows, earlierRows, submittedAt).stipends;
  const shares = fundingSplit(request);
  for (const share of shares) {
    if (share.funding !== "none" && !choices.some((s) => s.id === share.funding)) {
      throw new FundingError("A line is charged to a stipend that isn't one of yours. Choose another, or \"Not from a stipend\".");
    }
  }
  // Blank when there was nothing to choose; AP can tell "chose none" from "wasn't asked".
  const funding = choices.length > 0 ? fundingCell(shares.map((share) => ({ ...parseFundingChoice(share.funding), cents: share.claimedCents }))) : "";

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

  const t = totals(request);
  const row: RequestRow = {
    request_id: requestId,
    status: "Submitted",
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
  };
  await log.append(row);
  const after = fundingOptions(user, stipendRows, [...earlierRows, row], submittedAt);

  // From here on the request exists; anything that goes wrong is noted on the row rather than failing the submission.
  const problems: string[] = [];
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
    funding:
      choices.length > 0
        ? shares.map((share) => {
            const { key, grade } = parseFundingChoice(share.funding);
            return { choice: share.funding, label: fundingLabel(key, grade), claimedCents: share.claimedCents, stipend: after.stipends.find((s) => s.id === share.funding) ?? null };
          })
        : [],
    linkBase: input.linkBase,
  };
  const attachment = { filename: pdfName, mimeType: "application/pdf", bytes: packet.bytes };
  let emailError: string | undefined;
  try {
    if (config.sendPacketsTo === "ap") {
      const ap = apSubmissionEmail(emailInput);
      await mailer.send({ to: [config.apEmail], replyTo: session.email, subject: ap.subject, text: ap.text, attachments: [attachment] });
      const copy = requesterCopyEmail(emailInput);
      await mailer.send({ to: [session.email], subject: copy.subject, text: copy.text, attachments: [attachment] });
    } else {
      const packet = requesterPacketEmail(emailInput);
      await mailer.send({ to: [session.email], subject: packet.subject, text: packet.text, attachments: [attachment] });
    }
  } catch (error) {
    emailError = error instanceof Error ? error.message : String(error);
    console.error(`[submit] email failed for ${requestId}: ${emailError}`);
    problems.push(`Email failed at submission: ${emailError}`);
  }
  if (problems.length > 0) await log.update(requestId, { notes: problems.join(" | ") }).catch(() => undefined);

  const result: SubmitResult = { requestId, pdfFileId: stored.id, sha256: packet.sha256, pageCount: packet.pageCount, funding: after, emailed: !emailError };
  return emailError ? { ...result, emailError } : result;
}
