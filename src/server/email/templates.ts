import { config } from "@/server/config";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { CHECK_DELIVERY_LABEL, totals, type RequestInput } from "@/lib/request-schema";
import type { StipendStatus } from "@/server/requests/stipends";

export function signInEmail(link: string): { subject: string; text: string } {
  return {
    subject: "Your Miraloma PTA reimbursement sign-in link",
    text: [
      "Use this link to sign in to the Miraloma PTA reimbursement portal:",
      "",
      link,
      "",
      `It works once, for ${config.magicLinkMinutes} minutes, and only on the device where you open it.`,
      "If you didn't ask for this, you can ignore this email.",
    ].join("\n"),
  };
}

export interface SubmissionEmailInput {
  requestId: string;
  request: RequestInput;
  requesterEmail: string;
  submittedAt: Date;
  sha256: string;
  version: number;
  /** The `funding` cell: the stipend chosen, "Not from a stipend", or "" when there was no choice. */
  funding: string;
  /** Where the chosen stipend stands with this request counted; null when none was chosen. */
  stipend: StipendStatus | null;
  /** Base URL for the links, the same one the sign-in emails use. */
  linkBase: string;
}

function summary(input: SubmissionEmailInput): string[] {
  const { request, requestId, requesterEmail, submittedAt, sha256 } = input;
  const t = totals(request);
  const lines = [
    `Request: ${requestId}${input.version > 1 ? ` (version ${input.version})` : ""}`,
    `From: ${request.payeeName} <${requesterEmail}>, ${request.ptaPosition}`,
    `Submitted: ${formatDateTime(submittedAt)}`,
    `Purpose: ${request.purpose}`,
    `Check: ${CHECK_DELIVERY_LABEL[request.checkDelivery]}`,
    ...(request.checkDelivery === "mail" ? [`Mail to: ${request.address}, ${request.cityZip}`] : []),
    `Phone: ${request.phone}`,
    "",
    "Line items:",
    ...request.items.map((item, i) => `  ${i + 1}. ${item.description} - ${formatMoney(item.amountCents)} (${item.receipts.length} receipt${item.receipts.length === 1 ? "" : "s"})`),
    "",
    `Total expense: ${formatMoney(t.totalCents)}`,
  ];
  if (t.donationCents > 0) lines.push(`Donated to PTA: ${formatMoney(t.donationCents)}`);
  lines.push(`Reimbursement claimed: ${formatMoney(t.reimbursementCents)}`);
  if (input.funding) lines.push(fundingLine(input.funding, input.stipend));
  lines.push("", `Signed PDF attached. SHA-256: ${sha256}`);
  return lines;
}

/** "Paid from: Grade 2 stipend (shared by grade 2 teachers): $1,200.00, $846.55 claimed including this request, $353.45 left" */
function fundingLine(funding: string, stipend: StipendStatus | null): string {
  if (!stipend) return `Paid from: ${funding}`;
  const name = stipend.sharedWith ? `${stipend.label} (shared by ${stipend.sharedWith})` : stipend.label;
  const claimed = `${formatMoney(stipend.usedCents)} claimed including this request`;
  if (stipend.amountCents === null || stipend.remainingCents === null) return `Paid from: ${name}, no amount set, ${claimed}`;
  const left = stipend.remainingCents < 0 ? `${formatMoney(-stipend.remainingCents)} over` : `${formatMoney(stipend.remainingCents)} left`;
  return `Paid from: ${name}: ${formatMoney(stipend.amountCents)}, ${claimed}, ${left}`;
}

export function apSubmissionEmail(input: SubmissionEmailInput): { subject: string; text: string } {
  const t = totals(input.request);
  return {
    subject: `Reimbursement request ${input.requestId} - ${input.request.payeeName} - ${formatMoney(t.reimbursementCents)}`,
    text: [
      `A reimbursement request was submitted through the portal.`,
      "",
      ...summary(input),
      "",
      `Open the portal: ${input.linkBase}/requests/${input.requestId}`,
    ].join("\n"),
  };
}

/**
 * The only email sent when packets go to the requester: the signed PDF with
 * instructions to forward it to AP. The subject is the one AP would have
 * received, so a plain "Forward" lands in their inbox looking the same.
 */
export function requesterPacketEmail(input: SubmissionEmailInput): { subject: string; text: string } {
  return {
    subject: apSubmissionEmail(input).subject,
    text: [
      `Thanks, ${input.request.payeeName}. Your signed request is attached, but the portal has not sent it to the PTA.`,
      `To be reimbursed, forward this email, with the PDF still attached, to the PTA's accounts payable team at ${config.apEmail}.`,
      "",
      ...summary(input),
      "",
      `See your requests: ${input.linkBase}/requests`,
    ].join("\n"),
  };
}

export function requesterCopyEmail(input: SubmissionEmailInput): { subject: string; text: string } {
  const t = totals(input.request);
  return {
    subject: `Your PTA reimbursement request ${input.requestId} (${formatMoney(t.reimbursementCents)})`,
    text: [
      `Thanks, ${input.request.payeeName}. Your request was sent to the PTA's accounts payable team (${config.apEmail}).`,
      "They will review it and either pay it by check or send it back with a note.",
      "",
      ...summary(input),
      "",
      `See your requests: ${input.linkBase}/requests`,
    ].join("\n"),
  };
}

export function approvalRequestEmail(input: { email: string; requestedAt: Date; approveUrl: string }): { subject: string; text: string } {
  return {
    subject: `Portal access request: ${input.email}`,
    text: [
      `${input.email} asked to use the Miraloma PTA reimbursement portal on ${formatDateTime(input.requestedAt)}.`,
      "",
      "If you know them as Miraloma staff or an approved volunteer, approve them here (you can also deny on that page):",
      "",
      input.approveUrl,
      "",
      `The link works for ${config.approvalLinkDays} days, until you approve or deny. Approving lets them sign in and submit reimbursement requests; it does not approve any payment.`,
      "If you don't recognize the address, deny it or just ignore this email.",
    ].join("\n"),
  };
}

export function approvedEmail(link: string): { subject: string; text: string } {
  return {
    subject: "You're approved to use the Miraloma PTA reimbursement portal",
    text: [
      "The PTA approved your email address for the reimbursement portal. Sign in here:",
      "",
      link,
      "",
      `This link works once, for ${config.magicLinkMinutes} minutes. After that, just request a new one from the sign-in page.`,
    ].join("\n"),
  };
}
