import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdapters } from "@/server/adapters";
import { requireApprovedSession } from "@/server/auth/session";
import { config } from "@/server/config";
import { chairSending, type ChairSending, type ResendProblem } from "@/server/requests/chair";
import { returnedBy } from "@/server/requests/resubmit";
import { versionOf } from "@/server/requests/rows";
import { authorizedSending, signerSending, type AuthorizedResendProblem, type SignerResendProblem, type SignerSending } from "@/server/requests/signers";
import { formatDateTime, formatMonthDay, parseDate } from "@/lib/dates";
import { parseEvents } from "@/lib/events";
import { formatAddress } from "@/lib/mailing";
import { formatMoney, parseMoney } from "@/lib/money";
import { MailtoLink } from "@/components/MailtoLink";
import { PostButton } from "@/components/PostButton";
import { StatusBadge } from "@/components/StatusBadge";
import type { RequestRow } from "@/server/adapters/types";

export default async function RequestPage(props: PageProps<"/requests/[id]">) {
  const { id } = await props.params;
  const query = await props.searchParams;
  const session = await requireApprovedSession(`/requests/${id}`);
  const { log, events, signatures } = await getAdapters();
  const row = await log.get(id);
  if (!row || row.requester_email.toLowerCase() !== session.email.toLowerCase()) notFound();
  // Who the chair email has reached, against who the Events tab lists now.
  const sending = row.status === "Awaiting chair" ? chairSending(row, parseEvents(await events.list())) : null;
  const resendProblem = typeof query.resend === "string" && Object.hasOwn(RESEND_PROBLEMS, query.resend) ? RESEND_PROBLEMS[query.resend as ResendProblem] : null;
  const toSigners = row.status === "Awaiting signers" ? signerSending(row) : null;
  const signerResend = query["resend-signers"];
  const signerProblem = typeof signerResend === "string" && Object.hasOwn(SIGNER_RESEND_PROBLEMS, signerResend) ? SIGNER_RESEND_PROBLEMS[signerResend as SignerResendProblem] : null;
  // Whoever sent it back: its chair, a check signer, or AP.
  const returnedWho = row.status === "Returned" ? await returnedBy(row, signatures) : null;
  // Only while it's with AP: a Returned or Paid request has its own box.
  const toAp = row.status === "Submitted" || row.status === "Approved" ? authorizedSending(row) : null;
  const sendAp = query["send-ap"];
  const sendApProblem = typeof sendAp === "string" && Object.hasOwn(SEND_AP_PROBLEMS, sendAp) ? SEND_AP_PROBLEMS[sendAp as AuthorizedResendProblem] : null;

  const money = (s: string) => formatMoney(parseMoney(s) ?? 0);
  const cosigned = Boolean(row.chair_pdf_file_id);
  const authorized = Boolean(row.authorized_pdf_file_id);
  // The PDF link serves the authorized packet only once AP has it (see the pdf route).
  const authorizedShown = authorizedSending(row) === "sent";
  const mailTo = row.check_delivery === "mail" ? rowAddress(row) : "";
  return (
    <div className="space-y-6">
      <div>
        <Link href="/requests" className="text-sm text-neutral-500 hover:underline">
          ← My requests
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{row.request_id}</h1>
          <StatusBadge status={row.status} />
        </div>
        <p className="text-neutral-600">{row.purpose}</p>
      </div>

      {sending && <AwaitingChair row={row} sending={sending} resent={query.resent === "1"} problem={resendProblem} />}
      {toSigners && <AwaitingSigners row={row} sending={toSigners} resent={query.resent === "signers"} problem={signerProblem} />}
      {toAp === "unsent" ? (
        <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-medium">Authorized by {signersWho(row)}, but not sent yet</div>
          <p>The email to the PTA&apos;s accounts payable team didn&apos;t go through, so they don&apos;t have it yet. Send it again here; it goes from the portal, so you don&apos;t need to forward anything.</p>
          {sendApProblem && <p className="font-medium text-amber-900">{sendApProblem}</p>}
          <PostButton action={`/api/requests/${encodeURIComponent(row.request_id)}/send-authorized`} busyLabel="Sending…">
            Send it to the PTA
          </PostButton>
        </div>
      ) : toAp ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          <div className="font-medium">Authorized by {signersWho(row)}</div>
          <p className="mt-1">
            {toAp === "sending"
              ? `It's on its way to the PTA's accounts payable team, and you'll get a copy by email once they have it. If it hasn't come by tomorrow, ask the PTA at ${config.apEmail}.`
              : "It went to the PTA's accounts payable team."}
            {query.sent === "ap" ? " Sent again just now, with a copy to you by email." : ""} The PTA&apos;s bank will mail your check to {mailTo}.
          </p>
        </div>
      ) : null}
      {row.status === "Submitted" && config.sendPacketsTo === "requester" && !authorized && (
        <div className="rounded-md border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900">
          The portal doesn&apos;t send requests to the PTA yet. If you haven&apos;t already, email the {cosigned ? "co-signed" : "signed"} PDF below to{" "}
          <MailtoLink email={config.apEmail} /> to be reimbursed.
        </div>
      )}
      {returnedWho && <Returned row={row} by={returnedWho} />}
      {row.status === "Paid" && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">
          Paid with check #{row.check_number || "?"} {row.paid_date ? `on ${row.paid_date}` : ""}.
        </div>
      )}

      <dl className="card grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Row label="Submitted" value={formatDateTime(new Date(row.submitted_at))} />
        {versionOf(row) > 1 ? <Row label="Version" value={`${versionOf(row)}, signed again after it was sent back`} /> : null}
        <Row label="Name" value={row.payee_name} />
        <Row label="PTA position" value={row.pta_position} />
        <Row label="Check" value={checkDelivery(row)} />
        <Row label="Line items" value={`${row.line_count}, ${row.receipt_count} receipt${row.receipt_count === 1 ? "" : "s"}`} />
        <Row label="Total expense" value={money(row.total_expense)} />
        {parseMoney(row.donation_to_pta) ? <Row label="Donated to PTA" value={money(row.donation_to_pta)} /> : null}
        <Row label="Reimbursement claimed" value={money(row.reimbursement_claimed)} />
        {row.funding ? <Row label="Paid from" value={row.funding} /> : null}
        {row.event ? <Row label="Event" value={row.event} /> : null}
        {chairLine(row) ? <Row label="Chair signature" value={chairLine(row)!} /> : null}
        {row.signers_step === "1 of 2 signed" || row.signers_step === "Signed" ? <Row label="Check signers" value={signersWho(row)} /> : null}
      </dl>

      <div className="flex flex-wrap gap-3">
        <a href={`/requests/${row.request_id}/pdf`} target="_blank" rel="noopener" className="btn-primary">
          {authorizedShown ? "Open authorized PDF" : cosigned ? "Open co-signed PDF" : "Open signed PDF"}
        </a>
      </div>
      <p className="break-all text-xs text-neutral-500">
        {authorizedShown && (
          <>
            SHA-256 of the authorized file: {row.authorized_pdf_sha256}
            <br />
          </>
        )}
        {cosigned ? (
          <>
            SHA-256 of the co-signed file: {row.chair_pdf_sha256}
            <br />
            SHA-256 of the file you signed: {row.pdf_sha256}
          </>
        ) : (
          <>SHA-256 of the signed file: {row.pdf_sha256}</>
        )}
      </p>
    </div>
  );
}

/** A returned request: who sent it back and why, and the way to fix it and sign it again as its next version. */
function Returned({ row, by }: { row: RequestRow; by: string }) {
  return (
    <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <div>
        <div className="font-medium">Sent back by {by}</div>
        {row.returned_note.trim() && <p className="mt-1 whitespace-pre-wrap text-sm">{row.returned_note}</p>}
      </div>
      {row.request_file_id ? (
        <>
          <p className="text-sm">
            It won&apos;t be paid as it stands. Tap <strong>Fix and re-sign</strong>: the form opens filled in as you signed it, receipts included. Make the
            change, check it over and sign again, and it goes on as version {versionOf(row) + 1}.
          </p>
          <Link href={`/requests/${encodeURIComponent(row.request_id)}/fix`} className="btn-primary inline-block">
            Fix and re-sign
          </Link>
        </>
      ) : (
        <p className="text-sm">This request is from before the portal could fill the form in again. Start a new request with the change.</p>
      )}
    </div>
  );
}

/** What happened on the VP/Chairman line, or null when the request isn't for an event or is still waiting. */
function chairLine(row: RequestRow): string | null {
  switch (row.chair_step) {
    case "Signed": {
      const at = parseDate(row.chair_signed_at);
      return [row.chair_name || row.chair_signed_by || "The chair", row.chair_signed_by && row.chair_name ? ` (${row.chair_signed_by})` : "", at ? `, ${formatDateTime(at)}` : ""].join("");
    }
    case "Skipped: requester is a chair":
      return "Not asked: you're a chair of this event";
    case "Skipped: no chair listed":
      return "Not asked: no chair was listed for this event";
    case "Timed out":
      return "Not signed in time; sent on without it";
    case "Sent back":
      return "Sent back by the chair";
    default:
      return null;
  }
}

const RESEND_PROBLEMS: Record<ResendProblem, string> = {
  "not-found": "That request wasn't found.",
  closed: "This request isn't waiting for a chair's signature any more.",
  "too-soon": `You can resend once every ${config.chairResendHours} hours.`,
  "no-chair": `The PTA's list doesn't name a chair for this event right now. Ask the PTA at ${config.apEmail} what to do.`,
  "requester-chair": `You're listed as a chair of this event now, so it can't be sent to the chairs again. Ask the PTA at ${config.apEmail} what to do.`,
  busy: "It was already being sent. Reload this page in a minute to see when it went.",
  failed: "The email didn't go through. Please try again in a few minutes.",
};

/** Who the request is waiting for, and the requester's "Resend to the chair". */
function AwaitingChair({ row, sending, resent, problem }: { row: RequestRow; sending: ChairSending; resent: boolean; problem: string | null }) {
  const sentAt = parseDate(row.chair_sent_at);
  const { reached, unreached, to, nextAt } = sending;
  return (
    <div className="space-y-3 rounded-md border border-violet-300 bg-violet-50 p-4 text-sm text-violet-950">
      <div className="font-medium">Waiting for the {row.event} chair to sign</div>
      {reached.length > 0 ? (
        <p>
          Sent to {reached.join(", ")}
          {sentAt ? ` on ${formatDateTime(sentAt)}` : ""}. Once they sign the form&apos;s VP/Chairman line,{" "}
          {config.sendPacketsTo === "ap" ? "it goes to the PTA by itself." : "you'll get the co-signed PDF by email to forward to the PTA."}
        </p>
      ) : (
        <p>The email to the chair{unreached.length > 0 ? ` (${unreached.join(", ")})` : ""} didn&apos;t go through.</p>
      )}
      {reached.length > 0 && unreached.length > 0 && <p>It hasn&apos;t reached {unreached.join(", ")} yet.</p>}
      {resent && <p className="font-medium">Sent again. The chair has a fresh link.</p>}
      {problem && <p className="font-medium text-amber-900">{problem}</p>}
      {sending.requesterIsChair ? (
        <p className="text-violet-900">{RESEND_PROBLEMS["requester-chair"]}</p>
      ) : to.length > 0 ? (
        <>
          {nextAt && <p className="text-violet-900">Resend goes to {to.join(", ")} now, and to every chair after {formatDateTime(nextAt)}.</p>}
          <PostButton action={`/api/requests/${encodeURIComponent(row.request_id)}/resend-chair`} busyLabel="Sending…">
            Resend to the chair
          </PostButton>
        </>
      ) : nextAt ? (
        <p className="text-violet-900">You can send it again after {formatDateTime(nextAt)} if they haven&apos;t signed by then.</p>
      ) : (
        <p className="text-violet-900">{RESEND_PROBLEMS["no-chair"]}</p>
      )}
    </div>
  );
}

const SIGNER_RESEND_PROBLEMS: Record<SignerResendProblem, string> = {
  "not-found": "That request wasn't found.",
  closed: "This request isn't waiting for the check signers any more.",
  "too-soon": `You can resend once every ${config.signerResendHours} hours.`,
  "no-signers": `The PTA hasn't listed enough check signers right now. Ask the PTA at ${config.apEmail} what to do.`,
  busy: "It was already being sent. Reload this page in a minute to see when it went.",
  failed: "The email didn't go through. Please try again in a few minutes.",
};

const SEND_AP_PROBLEMS: Record<AuthorizedResendProblem, string> = {
  "not-found": "That request wasn't found.",
  closed: "This request has no authorized packet to send.",
  "already-sent": "The PTA's accounts payable team already has it.",
  sending: "It's still on its way. You'll get a copy by email once the PTA has it.",
  mismatch: `This request's signed files don't match the record of what was signed. Please let the PTA know at ${config.apEmail}.`,
  busy: "It was already being sent. Reload this page in a minute to see whether it went.",
  failed: "The email didn't go through. Please try again in a few minutes.",
};

/** "Lillie Coit (Nov 14)", or both signers. */
function signersWho(row: RequestRow): string {
  const one = (name: string, at: string) => {
    const date = parseDate(at);
    return `${name || "A check signer"}${date ? ` (${formatMonthDay(date)})` : ""}`;
  };
  const first = one(row.signer_1_name, row.signer_1_signed_at);
  return row.signers_step === "Signed" ? `${first} and ${one(row.signer_2_name, row.signer_2_signed_at)}` : first;
}

/** Who the mailed check is waiting for, and the requester's "Resend to the check signers". */
function AwaitingSigners({ row, sending, resent, problem }: { row: RequestRow; sending: SignerSending; resent: boolean; problem: string | null }) {
  const sentAt = parseDate(row.signers_sent_at);
  const { reached, unreached, to, nextAt } = sending;
  const one = row.signers_step === "1 of 2 signed";
  return (
    <div className="space-y-3 rounded-md border border-teal-300 bg-teal-50 p-4 text-sm text-teal-950">
      <div className="font-medium">{one ? "One of two check signers has signed" : "Waiting for the PTA's check signers"}</div>
      {one && <p>{signersWho(row)} signed. One more check signer signs next.</p>}
      {reached.length > 0 ? (
        <p>
          The signing email went to {reached.length} check signer{reached.length === 1 ? "" : "s"}
          {sentAt ? ` on ${formatDateTime(sentAt)}` : ""}. Once {one ? "one more signs" : "two of them sign"}, it goes to the PTA by itself and the PTA&apos;s bank mails
          your check to {rowAddress(row)}.
        </p>
      ) : (
        <p>The email to the check signers didn&apos;t go through.</p>
      )}
      {reached.length > 0 && unreached.length > 0 && <p>It hasn&apos;t reached {unreached.length === 1 ? "one check signer" : `${unreached.length} check signers`} yet.</p>}
      {resent && <p className="font-medium">Sent again. The check signers have fresh links.</p>}
      {problem && <p className="font-medium text-amber-900">{problem}</p>}
      {to.length > 0 ? (
        <>
          {nextAt && <p className="text-teal-900">Resend goes to the check signers it hasn&apos;t reached now, and to all of them after {formatDateTime(nextAt)}.</p>}
          <PostButton action={`/api/requests/${encodeURIComponent(row.request_id)}/resend-signers`} busyLabel="Sending…">
            Resend to the check signers
          </PostButton>
        </>
      ) : nextAt ? (
        <p className="text-teal-900">You can send it again after {formatDateTime(nextAt)} if it hasn&apos;t been signed by then.</p>
      ) : (
        <p className="text-teal-900">{SIGNER_RESEND_PROBLEMS["no-signers"]}</p>
      )}
    </div>
  );
}

/** The mailing address as the emails and the FO10 print it. */
const rowAddress = (row: RequestRow) => formatAddress({ address: row.address, cityStateZip: row.city_zip });

/** Rows from before pickup replaced mailing still carry the address the check went to. */
function checkDelivery(row: RequestRow): string {
  if (row.check_delivery === "mail") return `Mail to ${rowAddress(row)}`;
  return row.check_delivery === "pickup" ? "Pickup from the PTA" : "Staff mailbox";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
