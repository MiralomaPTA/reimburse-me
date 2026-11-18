import { config } from "@/server/config";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { EventBudget } from "@/lib/events";
import { formatAddress } from "@/lib/mailing";
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

/** One funding choice's part of a request, for the emails. */
export interface FundingShareInput {
  /** The choice as the form sends it: "classroom", "grade:2", "none". */
  choice: string;
  /** "Grade 2 stipend", "Not from a stipend". */
  label: string;
  /** Claimed from it by this request, after any donation. */
  claimedCents: number;
  /** Where the stipend stands with this request counted; null for "Not from a stipend". */
  stipend: StipendStatus | null;
}

export interface SubmissionEmailInput {
  requestId: string;
  request: RequestInput;
  requesterEmail: string;
  submittedAt: Date;
  sha256: string;
  version: number;
  /** Each choice the request is charged to, in the order its lines appear; empty when the requester had no stipend to choose. */
  funding: FundingShareInput[];
  /** Base URL for the links, the same one the sign-in emails use. */
  linkBase: string;
  /** Present once the event chair has signed; `sha256` is then the co-signed packet's. */
  chair?: ChairSignature;
  /** Present once two check signers have authorized a mailed check; `sha256` is then the authorized packet's. */
  signers?: SignersAuthorization;
}

/** Who authorized a mailed check, for the emails that carry the authorized packet. */
export interface SignersAuthorization {
  signers: { name: string; email: string; signedAt: Date; note: string }[];
  budgetAccount: string;
  paymentAccount: string;
  flags: string[];
  /** The packet the signers authorized (co-signed or requester-signed), which the authorized one holds after the FO10. */
  packetSha256: string;
}

/** Who signed the VP/Chairman line, for the emails that carry the co-signed packet. */
export interface ChairSignature {
  event: string;
  name: string;
  email: string;
  signedAt: Date;
  note: string;
  /** The packet as the requester signed it, kept beside the co-signed one. */
  requesterSha256: string;
}

function summary(input: SubmissionEmailInput): string[] {
  const { request, requestId, requesterEmail, submittedAt, sha256, chair } = input;
  const t = totals(request);
  const lines = [
    `Request: ${requestId}${input.version > 1 ? ` (version ${input.version})` : ""}`,
    `From: ${request.payeeName} <${requesterEmail}>, ${request.ptaPosition}`,
    `Submitted: ${formatDateTime(submittedAt)}`,
    `Purpose: ${request.purpose}`,
    ...(request.event ? [`Event: ${request.event}`] : []),
    ...(chair ? [`Signed by the ${chair.event} chair: ${chair.name} <${chair.email}>, ${formatDateTime(chair.signedAt)}`] : []),
    ...(chair?.note ? [`Chair's note: ${chair.note}`] : []),
    `Check: ${CHECK_DELIVERY_LABEL[request.checkDelivery]}`,
    `Phone: ${request.phone}`,
    "",
    "Line items:",
    ...request.items.map((item, i) => {
      const receipts = `${item.receipts.length} receipt${item.receipts.length === 1 ? "" : "s"}`;
      // The stipend is named per line only when the request is split between choices.
      const from = input.funding.length > 1 ? `, ${input.funding.find((f) => f.choice === item.funding)?.label ?? item.funding}` : "";
      return `  ${i + 1}. ${item.description} - ${formatMoney(item.amountCents)} (${receipts}${from})`;
    }),
    "",
    `Total expense: ${formatMoney(t.totalCents)}`,
  ];
  if (t.donationCents > 0) lines.push(`Donated to PTA: ${formatMoney(t.donationCents)}`);
  lines.push(`Reimbursement claimed: ${formatMoney(t.reimbursementCents)}`);
  lines.push(...fundingLines(input.funding));
  if (input.signers) {
    lines.push("", `Authorized PDF attached: the FO10 signed by two check signers, then the request and receipts they authorized. SHA-256: ${sha256}`);
    lines.push(`The packet they authorized, before the FO10 was added: SHA-256 ${input.signers.packetSha256}`);
  } else if (chair) {
    lines.push("", `Co-signed PDF attached, signed by the requester and the ${chair.event} chair. SHA-256: ${sha256}`);
    lines.push(`The packet as the requester signed it, before the chair's signature: SHA-256 ${chair.requesterSha256}`);
  } else {
    lines.push("", `Signed PDF attached. SHA-256: ${sha256}`);
  }
  return lines;
}

/**
 * One choice: "Paid from: Grade 2 stipend (shared by grade 2 teachers): $1,200.00, $846.55 claimed including this request, $353.45 left".
 * Split: "Paid from:" then one indented line per choice, each starting with its part of this request.
 */
function fundingLines(funding: SubmissionEmailInput["funding"]): string[] {
  if (funding.length === 0) return [];
  if (funding.length === 1) return [`Paid from: ${standing(funding[0])}`];
  return ["Paid from:", ...funding.map((share) => `  ${formatMoney(share.claimedCents)} from ${standing(share)}`)];
}

/** "Grade 2 stipend (shared by grade 2 teachers): $1,200.00, $846.55 claimed including this request, $353.45 left" */
function standing({ label, stipend }: FundingShareInput): string {
  if (!stipend) return label;
  const name = stipend.sharedWith ? `${stipend.label} (shared by ${stipend.sharedWith})` : stipend.label;
  const claimed = `${formatMoney(stipend.usedCents)} claimed including this request`;
  if (stipend.amountCents === null || stipend.remainingCents === null) return `${name}, no amount set, ${claimed}`;
  const left = stipend.remainingCents < 0 ? `${formatMoney(-stipend.remainingCents)} over` : `${formatMoney(stipend.remainingCents)} left`;
  return `${name}: ${formatMoney(stipend.amountCents)}, ${claimed}, ${left}`;
}

export function apSubmissionEmail(input: SubmissionEmailInput): { subject: string; text: string } {
  const t = totals(input.request);
  return {
    subject: `Reimbursement request ${input.requestId} - ${input.request.payeeName} - ${formatMoney(t.reimbursementCents)}`,
    text: [
      input.chair
        ? `A reimbursement request was submitted through the portal and signed by the ${input.chair.event} chair.`
        : `A reimbursement request was submitted through the portal.`,
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
      input.chair
        ? `${input.request.payeeName}, the ${input.chair.event} chair signed your request. The co-signed request is attached, but the portal has not sent it to the PTA.`
        : `Thanks, ${input.request.payeeName}. Your signed request is attached, but the portal has not sent it to the PTA.`,
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
      input.chair
        ? `${input.request.payeeName}, the ${input.chair.event} chair signed your request, and it was sent to the PTA's accounts payable team (${config.apEmail}).`
        : `Thanks, ${input.request.payeeName}. Your request was sent to the PTA's accounts payable team (${config.apEmail}).`,
      "They will review it and either pay it by check or send it back with a note.",
      "",
      ...summary(input),
      "",
      `See your requests: ${input.linkBase}/requests`,
    ].join("\n"),
  };
}

/** "the Fun Run chair (lillie@example.org)", or both co-chairs. */
function chairWho(event: string, chairs: string[]): string {
  return chairs.length === 1 ? `the ${event} chair (${chairs[0]})` : `the ${event} chairs (${chairs.join(", ")})`;
}

/** What happens once the chair signs, in the requester's terms. */
function afterChairSigns(request: RequestInput): string {
  if (request.checkDelivery === "mail") {
    return `Once they sign, it goes to two of the PTA's check signers to approve the payment, then to the PTA's accounts payable team by itself, and you'll get a copy. The PTA's bank then mails your check to ${formatAddress(request)}.`;
  }
  return config.sendPacketsTo === "ap"
    ? `Once they sign, it goes to the PTA's accounts payable team (${config.apEmail}) by itself; you don't need to do anything.`
    : "Once they sign, you'll get the co-signed PDF by email to forward to the PTA. Don't forward this copy: it doesn't have the chair's signature yet.";
}

/**
 * To the requester when their request goes to the event chair first, with the
 * packet as they signed it. `chairs` are the chairs the email reached;
 * `notReached`, the ones whose email failed.
 */
export function requesterSentToChairEmail(input: SubmissionEmailInput, chairs: string[], notReached: string[] = []): { subject: string; text: string } {
  const t = totals(input.request);
  const event = input.request.event;
  const page = `${input.linkBase}/requests/${input.requestId}`;
  const reached =
    chairs.length > 0
      ? `Thanks, ${input.request.payeeName}. Your signed request went to ${chairWho(event, chairs)} to sign on the form's VP/Chairman line.`
      : `Thanks, ${input.request.payeeName}. Your request is signed and waits for the ${event} chair to sign on the form's VP/Chairman line.`;
  const failed =
    notReached.length > 0 ? [`The email to ${notReached.join(", ")} didn't go through. Use "Resend to the chair" on your request page to try again: ${page}`] : [];
  return {
    subject: `Your PTA reimbursement request ${input.requestId} (${formatMoney(t.reimbursementCents)}) is with the ${event} chair`,
    text: [
      reached,
      ...failed,
      afterChairSigns(input.request),
      "",
      ...summary(input),
      "",
      `See your requests: ${input.linkBase}/requests/${input.requestId}`,
    ].join("\n"),
  };
}

export interface ChairRequestEmailInput {
  requestId: string;
  request: SubmissionEmailInput["request"];
  requesterEmail: string;
  submittedAt: Date;
  sha256: string;
  version: number;
  /** This chair's own signing link. */
  link: string;
  /** Base URL for the link to the chairs' guide. */
  linkBase: string;
  /** How many chairs were asked; any one may sign. */
  chairCount: number;
  /** True when the requester asked for it to be sent again. */
  reminder?: boolean;
  /** Where the event's budget stands around this request, when it has one. */
  budget: EventBudget | null;
}

/** "$380.00 left" or "$12.50 over". */
const budgetLeft = (cents: number) => (cents < 0 ? `${formatMoney(-cents)} over` : `${formatMoney(cents)} left`);

/** "Fun Run budget: $500.00. Before this request $120.00 was claimed, $380.00 left; after it, $337.50 left." */
export function budgetLine(event: string, budget: EventBudget): string {
  return (
    `${event} budget: ${formatMoney(budget.budgetCents)}. Before this request ${formatMoney(budget.usedBeforeCents)} was claimed, ` +
    `${budgetLeft(budget.leftBeforeCents)}; after it, ${budgetLeft(budget.leftAfterCents)}.`
  );
}

/** To one event chair: what the request is, and their link to review and sign it. Stipends are left out; they're between the requester and AP. */
export function chairRequestEmail(input: ChairRequestEmailInput): { subject: string; text: string } {
  const { request } = input;
  const t = totals(request);
  const event = request.event;
  return {
    subject: `${input.reminder ? "Reminder: please" : "Please"} sign: ${event} reimbursement for ${request.payeeName}, ${formatMoney(t.reimbursementCents)} (${input.requestId})`,
    text: [
      `${request.payeeName} asked the PTA to reimburse ${formatMoney(t.reimbursementCents)} of ${event} expenses. As ${event} chair, please check the request and sign it on the form's VP/Chairman line. It goes on to the PTA for payment once you sign.`,
      "",
      ...(input.budget ? [budgetLine(event, input.budget), ""] : []),
      `Review and sign: ${input.link}`,
      "",
      `The link works for ${config.chairLinkDays} days and only for you, so please don't forward it.` +
        (input.chairCount > 1 ? ` The other ${event} chairs got this email too; one signature is enough.` : ""),
      `If something isn't right, don't sign. Write to ${request.payeeName} at ${input.requesterEmail} in a new email rather than forwarding or replying to this one, which holds your link. A reply to this email goes to the PTA.`,
      `New to this? ${input.linkBase}/help/chairs explains it.`,
      "",
      ...summary({ ...input, funding: [] }),
    ].join("\n"),
  };
}

/** To the chair who signed: done, with the co-signed packet for their records. */
export function chairSignedEmail(input: { requestId: string; event: string; payeeName: string; sha256: string; mailed?: boolean }): { subject: string; text: string } {
  const next = input.mailed
    ? "It has gone to the PTA's check signers, who approve the payment before the PTA's bank mails the check."
    : config.sendPacketsTo === "ap"
      ? `It has gone to the PTA's accounts payable team (${config.apEmail}).`
      : `${input.payeeName} has been sent the co-signed PDF to send on to the PTA.`;
  return {
    subject: `Signed: ${input.event} reimbursement for ${input.payeeName} (${input.requestId})`,
    text: [
      `Thanks for signing request ${input.requestId} as ${input.event} chair. ${next}`,
      "",
      `The co-signed PDF is attached for your records. SHA-256: ${input.sha256}`,
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

/** "Lillie Coit (Nov 14) and Joshua Norton (Nov 15)" */
function signerNames(signers: { name: string; signedAt: Date }[]): string {
  const day = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: config.timeZone, month: "short", day: "numeric" }).format(d);
  return signers.map((s) => `${s.name} (${day(s.signedAt)})`).join(" and ");
}

/** The "worth a second look" lines, or nothing. */
function flagLines(flags: string[]): string[] {
  return flags.length > 0 ? ["Worth a second look:", ...flags.map((flag) => `  - ${flag}`), ""] : [];
}

/** What AP must keep to, in every email that can lead to a payment. */
export const PAY_ONLY_TO_FO10 = "Pay only to the address on the signed FO10. A change of address needs a new request.";

/**
 * To the requester when a mailed request goes to the check signers with no
 * chair step before it, with the packet they signed. `notReached` are
 * signers whose email failed.
 */
export function requesterSentToSignersEmail(input: SubmissionEmailInput, notReached: string[], nobody: boolean): { subject: string; text: string } {
  const t = totals(input.request);
  const page = `${input.linkBase}/requests/${input.requestId}`;
  const problem = nobody
    ? [`The email to the check signers didn't go through. Use "Resend to the check signers" on your request page to try again: ${page}`]
    : notReached.length > 0
      ? [`The email to ${notReached.length === 1 ? "one check signer" : `${notReached.length} check signers`} didn't go through; the others have it. If nobody signs in a few days, use "Resend to the check signers" on your request page: ${page}`]
      : [];
  return {
    subject: `Your PTA reimbursement request ${input.requestId} (${formatMoney(t.reimbursementCents)}) is with the PTA's check signers`,
    text: [
      `Thanks, ${input.request.payeeName}. Your signed request went to the PTA's check signers.`,
      ...problem,
      `Two of them approve the payment. Then it goes to the PTA's accounts payable team (${config.apEmail}) by itself, and you'll get a copy. The PTA's bank then mails your check to ${formatAddress(input.request)}.`,
      "Mailed checks take a few extra days.",
      "",
      ...summary(input),
      "",
      `See your request: ${page}`,
    ].join("\n"),
  };
}

export interface SignerRequestEmailInput {
  requestId: string;
  version: number;
  request: RequestInput;
  requesterEmail: string;
  submittedAt: Date;
  /** This signer's own link. */
  link: string;
  linkBase: string;
  budgetAccount: string;
  paymentAccount: string;
  flags: string[];
  /** The event chair who signed, for an event request; or why no chair signed. */
  chair: ChairSignature | { skipped: string } | null;
  /** Set once the first check signer has signed. */
  firstSigner: { name: string; signedAt: Date } | null;
  /** The packet attached: co-signed or requester-signed. */
  packetSha256: string;
  /** The requester asked for it to be sent again. */
  reminder?: boolean;
}

/** To one check signer: a mailed check to authorize, and their own link to review and sign the FO10. Says nothing about stipends beyond the Budget Account. */
export function signerRequestEmail(input: SignerRequestEmailInput): { subject: string; text: string } {
  const { request, firstSigner } = input;
  const t = totals(request);
  const what = `mailed check to ${request.payeeName}, ${formatMoney(t.reimbursementCents)} (${input.requestId})`;
  const ask = firstSigner ? "One more signature" : "Please authorize";
  const chair = input.chair && "skipped" in input.chair ? input.chair.skipped : null;
  return {
    subject: input.reminder ? `Reminder: ${ask.toLowerCase()}: ${what}` : `${ask}: ${what}`,
    text: [
      `${request.payeeName} (${request.ptaPosition}) asked the PTA to reimburse ${formatMoney(t.reimbursementCents)} and chose to have the check mailed. ` +
        "The PTA's bank mails it by bill pay, so two of the PTA's check signers authorize the payment first, by signing the Authorization for Payment via Electronic Services (FO10).",
      firstSigner
        ? `${firstSigner.name} signed the first Authorized By line on ${formatDateTime(firstSigner.signedAt)}. One more signature is needed, from a check signer other than ${firstSigner.name}.`
        : "Any two check signers may sign. The first to sign confirms the Budget Account and the Payment Account.",
      ...(chair ? [chair] : []),
      "",
      ...flagLines(input.flags),
      `Review and sign: ${input.link}`,
      "",
      `Mail the check to: ${formatAddress(request)}`,
      `Payment amount: ${formatMoney(t.reimbursementCents)}`,
      `Budget Account: ${input.budgetAccount || "(blank: the first signer fills it in)"}`,
      `Payment Account: ${input.paymentAccount}`,
      "",
      `The link works for ${config.signerLinkDays} days and only for you, so please don't forward it. A reply to this email goes to the PTA.`,
      `If something isn't right, don't sign. Send it back from the same page with a note; it goes to ${request.payeeName} and the PTA.`,
      `New to this? ${input.linkBase}/help/signers explains it.`,
      "",
      ...summary({ ...input, sha256: input.packetSha256, funding: [], chair: input.chair && !("skipped" in input.chair) ? input.chair : undefined }),
      `The FO10 as filled in so far is attached too.`,
    ].join("\n"),
  };
}

/** To a check signer just after they sign, at their own address: a receipt, so a signature made with a forwarded link doesn't go unnoticed. */
export function signerReceiptEmail(input: {
  requestId: string;
  slot: 1 | 2;
  name: string;
  payeeName: string;
  amountCents: number;
  mailingAddress: string;
}): { subject: string; text: string } {
  return {
    subject: `You signed: mailed check to ${input.payeeName}, ${formatMoney(input.amountCents)} (${input.requestId})`,
    text: [
      `You signed the ${input.slot === 1 ? "first" : "second"} Authorized By line of the FO10 for request ${input.requestId}, as ${input.name}.`,
      "",
      `Pay to: ${input.payeeName}`,
      `Amount: ${formatMoney(input.amountCents)}`,
      `Mail to: ${input.mailingAddress}`,
      "",
      input.slot === 1
        ? "One more check signer signs next. Then it goes to the PTA's accounts payable team, who set up the payment."
        : "That was the second signature. It has gone to the PTA's accounts payable team, who set up the payment.",
      `If this wasn't you, tell the PTA at ${config.apEmail} right away.`,
      "",
      "The FO10 as you signed it is attached for your records.",
    ].join("\n"),
  };
}

/** To AP once two check signers have authorized a mailed check, with the authorized packet. Always sent, whatever SEND_PACKETS_TO says. */
export function apAuthorizedEmail(input: SubmissionEmailInput & { signers: SignersAuthorization }): { subject: string; text: string } {
  const t = totals(input.request);
  const { signers } = input;
  return {
    subject: `Reimbursement request ${input.requestId} - ${input.request.payeeName} - ${formatMoney(t.reimbursementCents)} - mailed check`,
    text: [
      "A reimbursement request was submitted through the portal and authorized for payment by bank bill pay by two of the PTA's check signers.",
      "",
      `Mail the check to: ${formatAddress(input.request)}`,
      `Payment amount: ${formatMoney(t.reimbursementCents)}`,
      `Authorized by ${signerNames(signers.signers)}`,
      `Budget Account: ${signers.budgetAccount}`,
      `Payment Account: ${signers.paymentAccount}`,
      ...signers.signers.filter((s) => s.note).map((s) => `${s.name}'s note: ${s.note}`),
      "",
      ...flagLines(signers.flags),
      PAY_ONLY_TO_FO10,
      "",
      ...summary(input),
      "",
      `Open the portal: ${input.linkBase}/requests/${input.requestId}`,
    ].join("\n"),
  };
}

/** The requester's copy of the authorized packet. */
export function requesterAuthorizedEmail(input: SubmissionEmailInput & { signers: SignersAuthorization }): { subject: string; text: string } {
  const t = totals(input.request);
  return {
    subject: `Your PTA reimbursement request ${input.requestId} (${formatMoney(t.reimbursementCents)}) is approved for mailing`,
    text: [
      `${input.request.payeeName}, two of the PTA's check signers approved your payment, and it went to the PTA's accounts payable team (${config.apEmail}).`,
      `The PTA's bank will mail your check to ${formatAddress(input.request)}. The authorized request, with the signed FO10 in front, is attached for your records.`,
      "",
      ...summary(input),
      "",
      `See your requests: ${input.linkBase}/requests`,
    ].join("\n"),
  };
}

/** To the requester, with AP copied, when a check signer sends a mailed request back instead of signing it. */
export function signerSentBackEmail(input: { requestId: string; payeeName: string; amountCents: number; signerName: string; signerEmail: string; note: string; linkBase: string }): {
  subject: string;
  text: string;
} {
  return {
    subject: `Sent back: your PTA reimbursement request ${input.requestId} (${formatMoney(input.amountCents)})`,
    text: [
      `${input.payeeName}, ${input.signerName} (${input.signerEmail}), one of the PTA's check signers, sent your request ${input.requestId} back instead of authorizing the payment.`,
      "",
      "Their note:",
      input.note,
      "",
      "What to do next: start a new request with the change, from the portal. This one is closed and won't be paid.",
      `Questions? Reply to this email; it goes to the PTA's accounts payable team (${config.apEmail}), who are copied.`,
      "",
      `See your request: ${input.linkBase}/requests/${input.requestId}`,
    ].join("\n"),
  };
}
